import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export interface SwaggerSetupOptions {
  title: string;
  description: string;
  version: string;
  path: string;
  tags?: Array<{ name: string; description: string }>;
  servers?: Array<{ url: string; description: string }>;
}

export function setupSwagger(app: INestApplication, options: SwaggerSetupOptions): void {
  const builder = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setVersion(options.version)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token issued by the auth service' },
      'access-token',
    )
    .addApiKey(
      { type: 'apiKey', name: 'x-internal-key', in: 'header', description: 'Service-to-service key (never exposed through the gateway)' },
      'internal-key',
    );

  for (const tag of options.tags ?? []) builder.addTag(tag.name, tag.description);
  for (const server of options.servers ?? []) builder.addServer(server.url, server.description);

  const document = SwaggerModule.createDocument(app, builder.build(), { deepScanRoutes: true });
  SwaggerModule.setup(options.path, app, document, {
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, tagsSorter: 'alpha' },
    customSiteTitle: options.title,
    jsonDocumentUrl: `${options.path}/json`,
  });
}
