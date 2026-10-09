export interface ApiMeta {
  [key: string]: unknown;
}

export interface PageMeta extends ApiMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export function buildPageMeta(page: number, limit: number, totalItems: number): PageMeta {
  const totalPages = limit > 0 ? Math.ceil(totalItems / limit) : 0;
  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
}

export function paginated<T>(items: T[], page: number, limit: number, totalItems: number): Paginated<T> {
  return { items, meta: buildPageMeta(page, limit, totalItems) };
}

export function isEnvelope(value: unknown): value is ApiSuccessResponse<unknown> | ApiErrorResponse {
  return typeof value === 'object' && value !== null && 'success' in value;
}
