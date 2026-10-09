import { Inject, Injectable } from '@nestjs/common';
import { InternalHttpClient, type Paginated } from '@ecom/platform';
import { PUBLIC_ENV, type PublicEnv } from '../config/env';

export interface StorefrontProduct {
  id: string;
  sku: string;
  slug: string;
  name: string;
  description: string | null;
  shortDescription: string | null;
  price: string;
  compareAtPrice: string | null;
  currency: string;
  stockQuantity: number;
  inStock: boolean;
  status: string;
  category: { id: string; name: string; slug: string };
  images: Array<{ id: string; url: string; altText: string | null; position: number; isPrimary: boolean }>;
}

export interface StorefrontCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  imageUrl: string | null;
  productCount: number;
}

export interface ProductAvailability {
  id: string;
  name: string;
  slug: string;
  sku: string;
  price: string;
  currency: string;
  imageUrl: string | null;
  stockQuantity: number;
  purchasable: boolean;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  grandTotal: string;
  currency: string;
  itemCount: number;
  placedAt: string;
  items: Array<{ id: string; productId: string; name: string; sku: string; unitPrice: string; quantity: number; lineTotal: string; imageUrl: string | null }>;
}

@Injectable()
export class CommerceClient {
  private readonly http: InternalHttpClient;

  constructor(@Inject(PUBLIC_ENV) env: PublicEnv) {
    this.http = new InternalHttpClient({
      name: 'admin-service',
      baseUrl: `${env.ADMIN_SERVICE_URL}/api/${env.API_VERSION}/admin/internal/`,
      apiKey: env.INTERNAL_API_KEY,
      timeoutMs: env.INTERNAL_HTTP_TIMEOUT_MS,
      retries: env.INTERNAL_HTTP_RETRIES,
    });
  }

  listProducts(query: Record<string, string | number | boolean | undefined>): Promise<Paginated<StorefrontProduct>> {
    return this.http.getPage<StorefrontProduct>('catalog/products', { query });
  }

  productBySlug(slug: string): Promise<StorefrontProduct> {
    return this.http.get<StorefrontProduct>(`catalog/products/slug/${encodeURIComponent(slug)}`);
  }

  productById(id: string): Promise<StorefrontProduct> {
    return this.http.get<StorefrontProduct>(`catalog/products/${id}`);
  }

  availability(id: string): Promise<ProductAvailability> {
    return this.http.get<ProductAvailability>(`catalog/products/${id}/availability`);
  }

  listCategories(): Promise<StorefrontCategory[]> {
    return this.http.get<StorefrontCategory[]>('catalog/categories');
  }

  placeOrder(payload: Record<string, unknown>): Promise<OrderSummary> {
    return this.http.post<OrderSummary>('orders', payload);
  }

  orderByIdempotencyKey(key: string, customerId: string): Promise<OrderSummary> {
    return this.http.get<OrderSummary>(`orders/by-idempotency-key/${encodeURIComponent(key)}`, {
      query: { customerId },
    });
  }

  listOrders(customerId: string, query: Record<string, string | number | undefined>): Promise<Paginated<OrderSummary>> {
    return this.http.getPage<OrderSummary>('orders', { query: { ...query, customerId } });
  }

  getOrder(orderId: string, customerId: string): Promise<OrderSummary> {
    return this.http.get<OrderSummary>(`orders/${orderId}`, { query: { customerId } });
  }

  invoiceStatus(orderId: string, customerId: string) {
    return this.http.get<{ available: boolean; status: string; invoiceNumber: string | null }>(
      `orders/${orderId}/invoice/status`,
      { query: { customerId } },
    );
  }

  invoiceUrl(orderId: string, customerId: string): { url: string; headers: Record<string, string> } {
    return {
      url: `${this.baseUrl}orders/${orderId}/invoice?customerId=${encodeURIComponent(customerId)}`,
      headers: { 'x-internal-key': this.apiKey },
    };
  }

  private get baseUrl(): string {
    return (this.http as unknown as { options: { baseUrl: string } }).options.baseUrl;
  }

  private get apiKey(): string {
    return (this.http as unknown as { options: { apiKey: string } }).options.apiKey;
  }
}
