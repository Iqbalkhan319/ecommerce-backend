import { Global, Module } from '@nestjs/common';
import { AUTH_ENV, loadEnv } from './env';

@Global()
@Module({
  providers: [{ provide: AUTH_ENV, useFactory: () => loadEnv() }],
  exports: [AUTH_ENV],
})
export class EnvModule {}
