import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { bootstrapService } from '@ecom/platform';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadEnv();

  await bootstrapService({
    module: AppModule,
    globalPrefix: `${env.API_PREFIX}/${env.API_VERSION}/public`,
    env,
    swagger: {
      title: 'Storefront service',
      description:
        'Customer-facing API: catalogue browsing, basket, checkout, order history and invoice access. Browsing is anonymous; everything else requires a customer access token.',
      version: '1.0.0',
      path: 'docs/public',
      tags: [
        { name: 'catalogue', description: 'Anonymous product and category browsing' },
        { name: 'basket', description: 'Basket for the signed-in customer' },
        { name: 'orders', description: 'Checkout, order history and invoices' },
        { name: 'account', description: 'Profile and saved addresses' },
      ],
      servers: [
        { url: 'http://localhost:8000', description: 'Kong gateway' },
        { url: 'http://localhost:3003', description: 'Direct service access (development only)' },
      ],
    },
  });

  new Logger('Bootstrap').log(`public-service listening on port ${env.PORT}`);
}

main().catch((error) => {
  console.error('public-service failed to start', error);
  process.exit(1);
});
