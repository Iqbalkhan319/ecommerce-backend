import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ErrorCode } from './error-codes';

const errorSchema: SchemaObject = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: ErrorCode.VALIDATION_ERROR },
        message: { type: 'string', example: 'Request validation failed' },
        requestId: { type: 'string', example: '7f1a0d0a-1c1e-4a5f-9a2f-3b6a0f5f0f11' },
        timestamp: { type: 'string', format: 'date-time' },
        details: { type: 'object', nullable: true },
      },
      required: ['code', 'message', 'requestId', 'timestamp'],
    },
  },
};

export function ApiEnvelope<TModel extends Type<unknown>>(
  model: TModel,
  options: { status?: number; description?: string; isArray?: boolean; paginated?: boolean } = {},
) {
  const dataSchema = options.isArray || options.paginated
    ? { type: 'array', items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: dataSchema,
          ...(options.paginated
            ? {
                meta: {
                  type: 'object',
                  properties: {
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 20 },
                    totalItems: { type: 'integer', example: 137 },
                    totalPages: { type: 'integer', example: 7 },
                    hasNextPage: { type: 'boolean', example: true },
                    hasPreviousPage: { type: 'boolean', example: false },
                  },
                },
              }
            : {}),
        },
      },
    }),
  );
}

export function ApiErrorResponses(...statuses: Array<{ status: number; description: string }>) {
  return applyDecorators(
    ...statuses.map((entry) =>
      ApiResponse({ status: entry.status, description: entry.description, schema: errorSchema }),
    ),
  );
}

export const ApiStandardErrors = () =>
  ApiErrorResponses(
    { status: 401, description: 'Missing or invalid access token' },
    { status: 403, description: 'Authenticated principal lacks the required permission' },
    { status: 422, description: 'Request validation failed' },
    { status: 429, description: 'Rate limit exceeded' },
    { status: 500, description: 'Unexpected server error' },
  );
