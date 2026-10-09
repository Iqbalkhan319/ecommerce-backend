import { Global, Module } from '@nestjs/common';
import { AuthClient } from '../clients/auth.client';
import { AuthorizationService } from './authorization.service';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  providers: [AuthClient, AuthorizationService, PermissionsGuard],
  exports: [AuthClient, AuthorizationService, PermissionsGuard],
})
export class AuthzModule {}
