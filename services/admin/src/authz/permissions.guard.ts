import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException, ErrorCode, type Principal } from '@ecom/platform';
import type { PermissionCode } from '@ecom/platform';
import { AuthorizationService } from './authorization.service';
import { REQUIRED_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_MODE_KEY } from './permissions.decorator';

export interface AdminRequest {
  principal?: Principal;
  authorization?: {
    userId: string;
    email: string;
    fullName: string;
    roles: string[];
    permissions: string[];
    isSuperAdmin: boolean;
  };
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS_KEY, targets);
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const principal = request.principal;

    if (!principal) {
      if (!required?.length) return true;
      throw AppException.unauthorized();
    }

    const record = await this.authorization.resolve(principal.id);
    this.authorization.assertActiveAdministrator(record);
    request.authorization = {
      userId: record.userId,
      email: record.email,
      fullName: record.fullName,
      roles: record.roles,
      permissions: record.permissions,
      isSuperAdmin: record.isSuperAdmin,
    };

    if (!required?.length) return true;
    if (record.isSuperAdmin) return true;

    const mode = this.reflector.getAllAndOverride<'any' | 'all'>(REQUIRED_PERMISSIONS_MODE_KEY, targets) ?? 'all';
    const granted = new Set(record.permissions);
    const satisfied =
      mode === 'any'
        ? required.some((permission) => granted.has(permission))
        : required.every((permission) => granted.has(permission));

    if (!satisfied) {
      throw AppException.forbidden(
        'Your role does not include the permission required for this action',
        ErrorCode.PERMISSION_DENIED,
        { required, mode },
      );
    }

    return true;
  }
}
