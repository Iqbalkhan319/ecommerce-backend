import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as NestPinoLogger, PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { AllExceptionsFilter } from '../http/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../http/response.interceptor';
import { buildValidationPipe } from '../http/validation';
import { setupSwagger, type SwaggerSetupOptions } from '../http/swagger';
import { parseOrigins } from '../config/env.schema';
import { RequestContextMiddleware } from '../http/request-context';

export interface BootstrapEnv {
  NODE_ENV: string;
  SERVICE_NAME: string;
  PORT: number;
  BODY_LIMIT: string;
  CORS_ORIGINS: string;
  TRUST_PROXY: boolean;
  SWAGGER_ENABLED: boolean;
}

export interface BootstrapOptions {
  module: unknown;
  globalPrefix: string;
  env: BootstrapEnv;
  swagger?: SwaggerSetupOptions;
}

export const HEALTH_ROUTES = ['health', 'health/live', 'health/ready'];

export async function applyGlobalRequestPipeline(
  app: INestApplication,
  options: { isProduction: boolean; bodyLimit?: string },
): Promise<void> {
  app.use(json({ limit: options.bodyLimit ?? '512kb' }));
  app.use(urlencoded({ limit: options.bodyLimit ?? '512kb', extended: true }));

  const requestContext = new RequestContextMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => requestContext.use(req, res, next));

  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
  const pinoLogger = await app.resolve(PinoLogger);
  app.useGlobalFilters(new AllExceptionsFilter(pinoLogger, options.isProduction));
}

export async function bootstrapService(options: BootstrapOptions): Promise<NestExpressApplication> {
  const isProduction = options.env.NODE_ENV === 'production';

  const app = await NestFactory.create<NestExpressApplication>(options.module as never, {
    bufferLogs: true,
    cors: false,

    bodyParser: false,
  });

  app.useLogger(app.get(NestPinoLogger));
  app.flushLogs();

  if (options.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  const origins = parseOrigins(options.env.CORS_ORIGINS);
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'x-request-id', 'x-correlation-id', 'idempotency-key'],
      exposedHeaders: ['x-request-id', 'x-correlation-id'],
      maxAge: 600,
    });
  }

  app.setGlobalPrefix(options.globalPrefix, { exclude: HEALTH_ROUTES });
  await applyGlobalRequestPipeline(app, { isProduction, bodyLimit: options.env.BODY_LIMIT });

  app.enableShutdownHooks();

  if (options.env.SWAGGER_ENABLED && options.swagger) setupSwagger(app, options.swagger);

  const server = await app.listen(options.env.PORT, '0.0.0.0');
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;

  return app;
}
