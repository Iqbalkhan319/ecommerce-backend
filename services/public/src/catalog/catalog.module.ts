import { Global, Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CommerceClient } from '../clients/commerce.client';
import { IdentityService } from '../clients/identity.service';

@Global()
@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CommerceClient, IdentityService],
  exports: [CatalogService, CommerceClient, IdentityService],
})
export class CatalogModule {}
