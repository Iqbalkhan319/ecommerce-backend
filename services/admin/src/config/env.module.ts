import { Global, Module } from '@nestjs/common';
import { ADMIN_ENV, loadEnv } from './env';

@Global()
@Module({
  providers: [{ provide: ADMIN_ENV, useFactory: () => loadEnv() }],
  exports: [ADMIN_ENV],
})
export class EnvModule {}
