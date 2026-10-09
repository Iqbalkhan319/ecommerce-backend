import { Global, Module, type DynamicModule } from '@nestjs/common';
import { JWT_VERIFIER_OPTIONS, JwtVerifierService, type JwtVerifierOptions } from './jwt-verifier.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Global()
@Module({})
export class JwtVerifierModule {
  static forRootAsync(options: {
    imports?: DynamicModule['imports'];
    inject?: unknown[];
    useFactory: (...args: never[]) => JwtVerifierOptions | Promise<JwtVerifierOptions>;
  }): DynamicModule {
    return {
      module: JwtVerifierModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: JWT_VERIFIER_OPTIONS,
          useFactory: options.useFactory,
          inject: (options.inject ?? []) as never[],
        },
        JwtVerifierService,
        JwtAuthGuard,
      ],
      exports: [JwtVerifierService, JwtAuthGuard],
    };
  }
}
