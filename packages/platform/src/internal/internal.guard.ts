import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../http/app-exception';
import { ErrorCode } from '../http/error-codes';
import { INTERNAL_KEY_HEADER } from '../http/constants';

export const INTERNAL_API_KEY = Symbol('INTERNAL_API_KEY');

function safeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

@Injectable()
export class InternalApiGuard implements CanActivate {
  constructor(@Inject(INTERNAL_API_KEY) private readonly expectedKey: string) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[INTERNAL_KEY_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !safeEquals(provided, this.expectedKey)) {
      throw AppException.forbidden('This endpoint is restricted to internal service traffic', ErrorCode.FORBIDDEN);
    }
    return true;
  }
}
