import { Global, Module, type DynamicModule } from '@nestjs/common';
import { createHealthController } from './health.controller';
import { HEALTH_OPTIONS, HealthRegistry, type HealthOptions } from './health.registry';

@Global()
@Module({})
export class HealthModule {
  static forRootAsync(options: {
    imports?: DynamicModule['imports'];
    inject?: unknown[];
    useFactory: (...args: never[]) => HealthOptions | Promise<HealthOptions>;
  }): DynamicModule {
    return {
      module: HealthModule,
      imports: options.imports ?? [],
      controllers: [createHealthController()],
      providers: [
        { provide: HEALTH_OPTIONS, useFactory: options.useFactory, inject: (options.inject ?? []) as never[] },
        HealthRegistry,
      ],
      exports: [HealthRegistry],
    };
  }
}
