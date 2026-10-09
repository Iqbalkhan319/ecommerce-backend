import { Global, Module, type DynamicModule } from '@nestjs/common';
import { AMQP_OPTIONS, AmqpService, type AmqpModuleOptions } from './amqp.service';

@Global()
@Module({})
export class AmqpModule {
  static forRootAsync(options: {
    imports?: DynamicModule['imports'];
    inject?: unknown[];
    useFactory: (...args: never[]) => AmqpModuleOptions | Promise<AmqpModuleOptions>;
  }): DynamicModule {
    return {
      module: AmqpModule,
      imports: options.imports ?? [],
      providers: [
        { provide: AMQP_OPTIONS, useFactory: options.useFactory, inject: (options.inject ?? []) as never[] },
        AmqpService,
      ],
      exports: [AmqpService],
    };
  }
}
