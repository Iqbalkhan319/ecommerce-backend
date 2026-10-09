import { ValidationPipe, type ValidationError, type ValidationPipeOptions } from '@nestjs/common';
import { AppException } from './app-exception';

interface FieldError {
  field: string;
  constraints: string[];
}

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints
      ? [{ field: path, constraints: Object.values(error.constraints) }]
      : [];
    const children = error.children?.length ? flatten(error.children, path) : [];
    return [...own, ...children];
  });
}

export function buildValidationPipe(options: ValidationPipeOptions = {}): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    validateCustomDecorators: true,
    stopAtFirstError: false,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) =>
      AppException.validation('Request validation failed', flatten(errors)),
    ...options,
  });
}
