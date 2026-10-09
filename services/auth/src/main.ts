import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { bootstrapService } from '@ecom/platform';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadEnv();

  await bootstrapService({
    module: AppModule,
    globalPrefix: `${env.API_PREFIX}/${env.API_VERSION}/auth`,
    env,
    swagger: {
      title: 'Authentication service',
      description:
        'Issues and rotates credentials for the storefront and the admin portal. Owns identities, RBAC assignments and refresh sessions.',
      version: '1.0.0',
      path: 'docs/auth',
      tags: [{ name: 'authentication', description: 'Registration, sign-in, token rotation and password management' }],
      servers: [
        { url: 'http://localhost:8000', description: 'Kong gateway' },
        { url: 'http://localhost:3001', description: 'Direct service access (development only)' },
      ],
    },
  });

  new Logger('Bootstrap').log(
    `auth-service listening on port ${env.PORT} (prefix /${env.API_PREFIX}/${env.API_VERSION}/auth)`,
  );
}

main().catch((error) => {
  console.error('auth-service failed to start', error);
  process.exit(1);
});
