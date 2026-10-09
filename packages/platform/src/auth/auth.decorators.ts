import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { AppException } from '../http/app-exception';
import type { Principal, PrincipalType } from './principal';

export const PUBLIC_ROUTE_KEY = 'ecom:public-route';
export const PRINCIPAL_TYPE_KEY = 'ecom:principal-type';

export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
export const RequirePrincipalType = (...types: PrincipalType[]) => SetMetadata(PRINCIPAL_TYPE_KEY, types);

export const CurrentUser = createParamDecorator((field: keyof Principal | undefined, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<{ principal?: Principal }>();
  if (!request.principal) throw AppException.unauthorized();
  return field ? request.principal[field] : request.principal;
});
