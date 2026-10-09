import { Logger } from '@nestjs/common';
import { AppException } from '../http/app-exception';
import { ErrorCode, type ErrorCodeValue } from '../http/error-codes';
import { CORRELATION_ID_HEADER, INTERNAL_KEY_HEADER, REQUEST_ID_HEADER } from '../http/constants';
import { RequestContext } from '../http/request-context';
import type { ApiErrorResponse, ApiSuccessResponse, PageMeta, Paginated } from '../http/api-response';

export interface InternalHttpClientOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  retries?: number;
}

export interface InternalRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

export class InternalHttpClient {
  private readonly logger: Logger;

  constructor(private readonly options: InternalHttpClientOptions) {
    this.logger = new Logger(`InternalHttpClient:${options.name}`);
  }

  get<T>(path: string, options?: InternalRequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  async getPage<T>(path: string, options?: InternalRequestOptions): Promise<Paginated<T>> {
    const envelope = await this.requestEnvelope<T[]>('GET', path, undefined, options);
    return {
      items: (envelope?.data ?? []) as T[],
      meta: (envelope?.meta ?? {
        page: 1,
        limit: 0,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      }) as PageMeta,
    };
  }

  post<T>(path: string, body?: unknown, options?: InternalRequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  patch<T>(path: string, body?: unknown, options?: InternalRequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  delete<T>(path: string, options?: InternalRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  private buildUrl(path: string, query?: InternalRequestOptions['query']): string {
    const url = new URL(path.replace(/^\//, ''), this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: InternalRequestOptions,
  ): Promise<T> {
    const envelope = await this.requestEnvelope<T>(method, path, body, options);
    return envelope?.data as T;
  }

  private async requestEnvelope<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: InternalRequestOptions,
  ): Promise<ApiSuccessResponse<T> | undefined> {
    const url = this.buildUrl(path, options?.query);
    const attempts = (this.options.retries ?? 2) + 1;
    const context = RequestContext.get();
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            [INTERNAL_KEY_HEADER]: this.options.apiKey,
            [REQUEST_ID_HEADER]: context?.requestId ?? '',
            [CORRELATION_ID_HEADER]: context?.correlationId ?? '',
            ...(options?.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
            ...(options?.headers ?? {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
        });

        if (RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
          lastError = new Error(`Upstream responded with ${response.status}`);
          await this.backoff(attempt);
          continue;
        }

        const text = await response.text();
        const payload = text ? (JSON.parse(text) as ApiSuccessResponse<T> | ApiErrorResponse) : undefined;

        if (!response.ok) {
          const error = (payload as ApiErrorResponse | undefined)?.error;
          throw new AppException(
            (error?.code as ErrorCodeValue) ?? ErrorCode.UPSTREAM_UNAVAILABLE,
            error?.message ?? `Upstream ${this.options.name} returned ${response.status}`,
            response.status,
            error?.details,
          );
        }

        return payload as ApiSuccessResponse<T> | undefined;
      } catch (error) {
        if (error instanceof AppException) throw error;
        lastError = error;
        if (attempt < attempts) {
          this.logger.warn(
            `Call to ${this.options.name} ${method} ${path} failed (attempt ${attempt}/${attempts}): ${(error as Error).message}`,
          );
          await this.backoff(attempt);
          continue;
        }
      }
    }

    this.logger.error(`Call to ${this.options.name} ${method} ${path} exhausted retries: ${(lastError as Error)?.message}`);
    throw AppException.upstreamUnavailable(`The ${this.options.name} service is currently unavailable`);
  }

  private backoff(attempt: number): Promise<void> {
    const delay = Math.min(1000, 100 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 50);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
