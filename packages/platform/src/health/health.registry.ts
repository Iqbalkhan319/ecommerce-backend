import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

export const HEALTH_OPTIONS = Symbol('HEALTH_OPTIONS');

export interface HealthOptions {
  serviceName: string;
  environment: string;
  version: string;
  shutdownDrainMs: number;
}

export type DependencyStatus = 'up' | 'down';

export interface DependencyProbeResult {
  status: DependencyStatus;
  latencyMs: number;
  critical: boolean;
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  environment: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  dependencies: Record<string, DependencyProbeResult>;
}

interface ProbeRegistration {
  probe: () => Promise<unknown>;
  critical: boolean;
  timeoutMs: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Probe timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

@Injectable()
export class HealthRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(HealthRegistry.name);
  private readonly probes = new Map<string, ProbeRegistration>();
  private readonly startedAt = Date.now();
  private shuttingDown = false;

  constructor(@Inject(HEALTH_OPTIONS) private readonly options: HealthOptions) {}

  register(
    name: string,
    probe: () => Promise<unknown>,
    options: { critical?: boolean; timeoutMs?: number } = {},
  ): void {
    this.probes.set(name, {
      probe,
      critical: options.critical ?? true,
      timeoutMs: options.timeoutMs ?? 3000,
    });
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  liveness(): { status: 'ok' | 'shutting_down'; service: string; uptimeSeconds: number; timestamp: string } {
    return {
      status: this.shuttingDown ? 'shutting_down' : 'ok',
      service: this.options.serviceName,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  async report(): Promise<HealthReport> {
    const dependencies: Record<string, DependencyProbeResult> = {};
    await Promise.all(
      [...this.probes.entries()].map(async ([name, registration]) => {
        const start = Date.now();
        try {
          const detail = await withTimeout(Promise.resolve(registration.probe()), registration.timeoutMs);
          dependencies[name] = {
            status: 'up',
            latencyMs: Date.now() - start,
            critical: registration.critical,
            ...(typeof detail === 'string' ? { detail } : {}),
          };
        } catch (error) {
          dependencies[name] = {
            status: 'down',
            latencyMs: Date.now() - start,
            critical: registration.critical,
            detail: (error as Error).message,
          };
        }
      }),
    );

    const entries = Object.values(dependencies);
    const criticalDown = entries.some((entry) => entry.critical && entry.status === 'down');
    const optionalDown = entries.some((entry) => !entry.critical && entry.status === 'down');

    return {
      status: this.shuttingDown || criticalDown ? 'error' : optionalDown ? 'degraded' : 'ok',
      service: this.options.serviceName,
      environment: this.options.environment,
      version: this.options.version,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.log(`Received ${signal ?? 'shutdown'}; readiness now reports error while connections drain`);
    if (this.options.shutdownDrainMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.shutdownDrainMs));
    }
  }
}
