import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { bootstrapService } from '@ecom/platform';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadEnv();

  await bootstrapService({
    module: AppModule,
    globalPrefix: `${env.API_PREFIX}/${env.API_VERSION}/admin`,
    env,
    swagger: {
      title: 'Admin service',
      description:
        'Commerce core: catalogue, inventory, orders, invoices and the audit trail. Every endpoint requires an administrator access token and an explicit permission.',
      version: '1.0.0',
      path: 'docs/admin',
      tags: [
        { name: 'dashboard', description: 'Operational summary' },
        { name: 'products', description: 'Catalogue and stock' },
        { name: 'categories', description: 'Catalogue structure' },
        { name: 'orders', description: 'Order pipeline and invoices' },
        { name: 'customers', description: 'Customer accounts and their order history' },
        { name: 'administrators', description: 'Administrator accounts' },
        { name: 'roles and permissions', description: 'Role based access control' },
        { name: 'audit', description: 'Audit trail' },
      ],
      servers: [
        { url: 'http://localhost:8000', description: 'Kong gateway' },
        { url: 'http://localhost:3002', description: 'Direct service access (development only)' },
      ],
    },
  });

  new Logger('Bootstrap').log(`admin-service listening on port ${env.PORT}`);
}

main().catch((error) => {
  console.error('admin-service failed to start', error);
  process.exit(1);
});
