import { Global, Module } from '@nestjs/common';
import { PUBLIC_ENV, loadEnv } from './env';

@Global()
@Module({
  providers: [{ provide: PUBLIC_ENV, useFactory: () => loadEnv() }],
  exports: [PUBLIC_ENV],
})
export class EnvModule {}
