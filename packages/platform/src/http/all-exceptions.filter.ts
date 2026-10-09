import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AppException } from './app-exception';
import { ErrorCode, type ErrorCodeValue } from './error-codes';
import type { ApiErrorResponse } from './api-response';
import { RequestContext } from './request-context';

interface PostgresError {
  code: string;
  constraint?: string;
  detail?: string;
  column?: string;
  table?: string;
}

const SQLSTATE = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  notNullViolation: '23502',
  checkViolation: '23514',
  numericValueOutOfRange: '22003',
  stringDataRightTruncation: '22001',
  invalidTextRepresentation: '22P02',
  serializationFailure: '40001',
  deadlockDetected: '40P01',
  lockNotAvailable: '55P03',
  queryCanceled: '57014',
} as const;

function isPostgresError(error: unknown): error is PostgresError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

function constraintDetail(error: PostgresError): { constraint: string } | undefined {
  return error.constraint ? { constraint: error.constraint } : undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLogger,
    private readonly isProduction: boolean,
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = RequestContext.requestId();

    const resolved = this.resolve(exception);

    if (resolved.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          err: exception,
          requestId,
          method: request.method,
          path: request.originalUrl ?? request.url,
          code: resolved.code,
        },
        resolved.logMessage,
      );
    } else {
      this.logger.warn(
        {
          requestId,
          method: request.method,
          path: request.originalUrl ?? request.url,
          code: resolved.code,
          status: resolved.status,
        },
        resolved.logMessage,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: resolved.code,
        message: resolved.message,
        requestId,
        timestamp: new Date().toISOString(),
        ...(resolved.details !== undefined ? { details: resolved.details } : {}),
      },
    };

    if (response.headersSent) return;
    response.status(resolved.status).json(body);
  }

  resolve(exception: unknown): {
    status: number;
    code: ErrorCodeValue;
    message: string;
    details?: unknown;
    logMessage: string;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        logMessage: `Handled application exception: ${exception.code}`,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);
      const normalisedMessage = Array.isArray(message) ? message.join(', ') : message;
      const name = exception.constructor.name;

      let code: ErrorCodeValue = ErrorCode.BAD_REQUEST;
      if (name === 'ThrottlerException') code = ErrorCode.RATE_LIMIT_EXCEEDED;
      else if (status === HttpStatus.UNAUTHORIZED) code = ErrorCode.UNAUTHENTICATED;
      else if (status === HttpStatus.FORBIDDEN) code = ErrorCode.FORBIDDEN;
      else if (status === HttpStatus.NOT_FOUND) code = ErrorCode.NOT_FOUND;
      else if (status === HttpStatus.CONFLICT) code = ErrorCode.CONFLICT;
      else if (status === HttpStatus.PAYLOAD_TOO_LARGE) code = ErrorCode.PAYLOAD_TOO_LARGE;
      else if (status === HttpStatus.UNPROCESSABLE_ENTITY) code = ErrorCode.VALIDATION_ERROR;
      else if (status >= 500) code = ErrorCode.INTERNAL_ERROR;

      return {
        status,
        code,
        message: status >= 500 && this.isProduction ? 'An unexpected error occurred' : normalisedMessage,
        logMessage: `HTTP exception: ${code}`,
      };
    }

    if (isPostgresError(exception)) {
      const details = constraintDetail(exception);
      switch (exception.code) {
        case SQLSTATE.uniqueViolation:
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'A record with the same unique value already exists',
            details,
            logMessage: 'PostgreSQL unique constraint violation',
          };
        case SQLSTATE.foreignKeyViolation:
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The operation conflicts with a related record',
            details,
            logMessage: 'PostgreSQL foreign key violation',
          };
        case SQLSTATE.checkViolation:

          return {
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            code: ErrorCode.VALIDATION_ERROR,
            message: 'The operation would leave the data in an invalid state',
            details,
            logMessage: 'PostgreSQL check constraint violation',
          };
        case SQLSTATE.notNullViolation:
          return {
            status: HttpStatus.BAD_REQUEST,
            code: ErrorCode.VALIDATION_ERROR,
            message: 'A required value was missing',
            details: exception.column ? { column: exception.column } : undefined,
            logMessage: 'PostgreSQL not-null violation',
          };
        case SQLSTATE.stringDataRightTruncation:
        case SQLSTATE.numericValueOutOfRange:
          return {
            status: HttpStatus.BAD_REQUEST,
            code: ErrorCode.BAD_REQUEST,
            message: 'A provided value is out of range for its field',
            logMessage: 'PostgreSQL value out of range',
          };
        case SQLSTATE.invalidTextRepresentation:
          return {
            status: HttpStatus.BAD_REQUEST,
            code: ErrorCode.BAD_REQUEST,
            message: 'A provided value is not in the expected format',
            logMessage: 'PostgreSQL invalid text representation',
          };

        case SQLSTATE.serializationFailure:
        case SQLSTATE.deadlockDetected:
        case SQLSTATE.lockNotAvailable:
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The request conflicted with another in-flight change. Please retry.',
            logMessage: `PostgreSQL contention ${exception.code}`,
          };
        case SQLSTATE.queryCanceled:
          return {
            status: HttpStatus.SERVICE_UNAVAILABLE,
            code: ErrorCode.DEPENDENCY_UNAVAILABLE,
            message: 'The database took too long to respond. Please try again.',
            logMessage: 'PostgreSQL statement timeout',
          };
        default:
          return {
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            code: ErrorCode.INTERNAL_ERROR,
            message: 'An unexpected database error occurred',
            logMessage: `Unhandled PostgreSQL error ${exception.code}`,
          };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      logMessage: 'Unhandled exception',
    };
  }
}
