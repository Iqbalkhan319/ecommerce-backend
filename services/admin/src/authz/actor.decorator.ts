import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { AppException } from '@ecom/platform';
import type { AuditActor } from '../audit/audit.service';
import type { AdminRequest } from './permissions.guard';

export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): AuditActor => {
  const request = context.switchToHttp().getRequest<AdminRequest>();
  if (!request.authorization) throw AppException.unauthorized();
  return { id: request.authorization.userId, email: request.authorization.email, type: 'ADMIN' };
});

export const CurrentAuthorization = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AdminRequest>();
  if (!request.authorization) throw AppException.unauthorized();
  return request.authorization;
});
