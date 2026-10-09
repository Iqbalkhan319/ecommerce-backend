import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './constants';

export interface RequestStore {
  requestId: string;
  correlationId: string;
  userId?: string;
  userType?: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

export const RequestContext = {
  run<T>(store: RequestStore, callback: () => T): T {
    return storage.run(store, callback);
  },
  get(): RequestStore | undefined {
    return storage.getStore();
  },
  requestId(): string {
    return storage.getStore()?.requestId ?? 'unknown';
  },
  set(patch: Partial<RequestStore>): void {
    const store = storage.getStore();
    if (store) Object.assign(store, patch);
  },
};

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = headerValue(req.headers[REQUEST_ID_HEADER]) || (req as { id?: string }).id || randomUUID();
    const correlationId = headerValue(req.headers[CORRELATION_ID_HEADER]) || requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    (req as { id?: string }).id = requestId;
    RequestContext.run({ requestId, correlationId }, () => next());
  }
}
