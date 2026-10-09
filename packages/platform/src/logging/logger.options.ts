import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from '../http/constants';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-key"]',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.refreshToken',
  'req.body.token',
  'password',
  'passwordHash',
  'refreshToken',
  'refreshTokenHash',
  'accessToken',
  'privateKey',
  'JWT_PRIVATE_KEY',
  'SUPER_ADMIN_PASSWORD',
  'INTERNAL_API_KEY',
];

export interface LoggerOptionsInput {
  serviceName: string;
  environment: string;
  level: string;
  pretty: boolean;
  ignorePaths?: string[];
}

function prettyTransportAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export function createLoggerOptions(input: LoggerOptionsInput): Params {
  const ignorePaths = new Set(input.ignorePaths ?? ['/health', '/health/live', '/health/ready', '/metrics']);
  const pretty = input.pretty && prettyTransportAvailable();
  if (input.pretty && !pretty) {
    process.stderr.write('LOG_PRETTY is set but pino-pretty is not installed; falling back to JSON logs.\n');
  }
  return {
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: input.level,
      base: { service: input.serviceName, environment: input.environment },
      transport: pretty
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } }
        : undefined,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const header = req.headers[REQUEST_ID_HEADER];
        const requestId = (Array.isArray(header) ? header[0] : header) || randomUUID();
        res.setHeader(REQUEST_ID_HEADER, requestId);
        return requestId;
      },
      customProps: (req: IncomingMessage) => ({ requestId: (req as { id?: string }).id }),
      autoLogging: {
        ignore: (req: IncomingMessage) => {
          const url = (req.url ?? '').split('?')[0];
          return ignorePaths.has(url);
        },
      },
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
        if (err) return 'error';
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
