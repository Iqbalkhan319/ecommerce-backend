import {
  CallHandler,
  ExecutionContext,
  Injectable,
  StreamableFile,
  SetMetadata,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { isEnvelope, type ApiMeta } from './api-response';

export const RAW_RESPONSE_KEY = 'ecom:raw-response';
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

interface PaginatedShape {
  items: unknown[];
  meta: ApiMeta;
}

function isPaginatedShape(value: unknown): value is PaginatedShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PaginatedShape).items) &&
    typeof (value as PaginatedShape).meta === 'object' &&
    (value as PaginatedShape).meta !== null &&
    Object.keys(value as object).length === 2
  );
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((payload) => {
        if (raw || payload instanceof StreamableFile || Buffer.isBuffer(payload)) return payload;
        if (isEnvelope(payload)) return payload;
        if (isPaginatedShape(payload)) {
          return { success: true, data: payload.items, meta: payload.meta };
        }
        return { success: true, data: payload ?? null };
      }),
    );
  }
}
