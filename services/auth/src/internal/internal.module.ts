import { Module } from '@nestjs/common';
import { INTERNAL_API_KEY, InternalApiGuard } from '@ecom/platform';
import { InternalUsersController } from './internal-users.controller';
import { InternalRbacController } from './internal-rbac.controller';
import { UsersModule } from '../users/users.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_ENV, type AuthEnv } from '../config/env';

@Module({
  imports: [UsersModule, RbacModule, AuthModule],
  controllers: [InternalUsersController, InternalRbacController],
  providers: [
    InternalApiGuard,
    { provide: INTERNAL_API_KEY, useFactory: (env: AuthEnv) => env.INTERNAL_API_KEY, inject: [AUTH_ENV] },
  ],
})
export class InternalModule {}
