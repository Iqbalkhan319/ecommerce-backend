import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, type ErrorCodeValue } from './error-codes';

export interface AppExceptionPayload {
  code: ErrorCodeValue;
  message: string;
  details?: unknown;
}

export class AppException extends HttpException {
  readonly code: ErrorCodeValue;
  readonly details?: unknown;

  constructor(code: ErrorCodeValue, message: string, status: HttpStatus, details?: unknown) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, code: ErrorCodeValue = ErrorCode.BAD_REQUEST, details?: unknown) {
    return new AppException(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static validation(message: string, details?: unknown) {
    return new AppException(ErrorCode.VALIDATION_ERROR, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }

  static unauthorized(message = 'Authentication required', code: ErrorCodeValue = ErrorCode.UNAUTHENTICATED) {
    return new AppException(code, message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message = 'You do not have access to this resource', code: ErrorCodeValue = ErrorCode.FORBIDDEN, details?: unknown) {
    return new AppException(code, message, HttpStatus.FORBIDDEN, details);
  }

  static notFound(message: string, code: ErrorCodeValue = ErrorCode.NOT_FOUND) {
    return new AppException(code, message, HttpStatus.NOT_FOUND);
  }

  static conflict(message: string, code: ErrorCodeValue = ErrorCode.CONFLICT, details?: unknown) {
    return new AppException(code, message, HttpStatus.CONFLICT, details);
  }

  static unprocessable(message: string, code: ErrorCodeValue, details?: unknown) {
    return new AppException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }

  static tooManyRequests(message = 'Too many requests') {
    return new AppException(ErrorCode.RATE_LIMIT_EXCEEDED, message, HttpStatus.TOO_MANY_REQUESTS);
  }

  static upstreamUnavailable(message = 'A required upstream service is unavailable') {
    return new AppException(ErrorCode.UPSTREAM_UNAVAILABLE, message, HttpStatus.SERVICE_UNAVAILABLE);
  }

  static internal(message = 'An unexpected error occurred') {
    return new AppException(ErrorCode.INTERNAL_ERROR, message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
