import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CacheService, type Paginated } from '@ecom/platform';
import { CommerceClient, type StorefrontCategory, type StorefrontProduct } from '../clients/commerce.client';
import { PUBLIC_ENV, type PublicEnv } from '../config/env';

const NAMESPACE = 'catalog';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly commerce: CommerceClient,
    private readonly cache: CacheService,
    @Inject(PUBLIC_ENV) private readonly env: PublicEnv,
  ) {}

  private key(...parts: Array<string | number>): string {
    return CacheService.key(NAMESPACE, ...parts);
  }

  private queryKey(query: Record<string, unknown>): string {
    const canonical = JSON.stringify(
      Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== '')
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
  }

  listProducts(query: Record<string, string | number | boolean | undefined>): Promise<Paginated<StorefrontProduct>> {
    return this.cache.getOrSet(
      this.key('products', this.queryKey(query)),
      this.env.CATALOG_CACHE_TTL_SECONDS,
      () => this.commerce.listProducts(query),
    );
  }

  productBySlug(slug: string): Promise<StorefrontProduct> {
    return this.cache.getOrSet(this.key('product', 'slug', slug), this.env.CATALOG_CACHE_TTL_SECONDS, () =>
      this.commerce.productBySlug(slug),
    );
  }

  listCategories(): Promise<StorefrontCategory[]> {
    return this.cache.getOrSet(this.key('categories'), this.env.CATALOG_CACHE_TTL_SECONDS, () =>
      this.commerce.listCategories(),
    );
  }

  availability(productId: string) {
    return this.commerce.availability(productId);
  }

  async invalidate(): Promise<void> {
    const removed = await this.cache.delByPrefix(`${NAMESPACE}:`);
    this.logger.log(`Invalidated ${removed} cached catalogue entries`);
  }
}
