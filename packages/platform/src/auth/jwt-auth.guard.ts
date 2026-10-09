import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../http/app-exception';
import { ErrorCode } from '../http/error-codes';
import { RequestContext } from '../http/request-context';
import { PRINCIPAL_TYPE_KEY, PUBLIC_ROUTE_KEY } from './auth.decorators';
import { JwtVerifierService } from './jwt-verifier.service';
import type { Principal, PrincipalType } from './principal';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifierService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AppException.unauthorized('An access token is required for this endpoint');
    }

    const principal = await this.verifier.verify(header.slice(7).trim());
    const allowedTypes = this.reflector.getAllAndOverride<PrincipalType[]>(PRINCIPAL_TYPE_KEY, targets);
    if (allowedTypes?.length && !allowedTypes.includes(principal.type)) {
      throw AppException.forbidden('This endpoint is not available to your account type', ErrorCode.FORBIDDEN);
    }

    request.principal = principal;
    RequestContext.set({ userId: principal.id, userType: principal.type });
    return true;
  }
}
