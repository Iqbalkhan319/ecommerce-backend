import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@ecom/platform';

export const REQUIRED_PERMISSIONS_KEY = 'ecom:required-permissions';
export const REQUIRED_PERMISSIONS_MODE_KEY = 'ecom:required-permissions-mode';

export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

export const RequireAnyPermission = (...permissions: PermissionCode[]) => {
  const decorator = SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
  const mode = SetMetadata(REQUIRED_PERMISSIONS_MODE_KEY, 'any');
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    decorator(target as never, key as never, descriptor as never);
    mode(target as never, key as never, descriptor as never);
  };
};
