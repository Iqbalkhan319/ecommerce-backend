import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode, ROUTING_KEYS, paginated, type Paginated } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import { money, toDecimal } from './money';
import { InventoryService } from '../inventory/inventory.service';
import type {
  AdjustStockDto,
  CreateProductDto,
  ListProductsQueryDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto';
import type { ProductImageRow, ProductRow } from '../database/tables';

interface ProductWithRelations extends ProductRow {
  category: { id: string; name: string; slug: string };
  images: ProductImageRow[];
}

const SORT_COLUMNS: Record<string, string> = {
  createdAt: 'created_at',
  price: 'price',
  name: 'name',
  stockQuantity: 'stock_quantity',
};

export function toProductDto(product: ProductWithRelations): ProductResponseDto {
  return {
    id: product.id,
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    description: product.description,
    shortDescription: product.short_description,
    price: money(product.price)!,
    compareAtPrice: money(product.compare_at_price),
    costPrice: money(product.cost_price),
    currency: product.currency,
    stockQuantity: product.stock_quantity,
    lowStockThreshold: product.low_stock_threshold,
    inStock: product.stock_quantity > 0,
    isLowStock: product.stock_quantity <= product.low_stock_threshold,
    status: product.status,
    weightGrams: product.weight_grams,
    category: product.category,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      altText: image.alt_text,
      position: image.position,
      isPrimary: image.is_primary,
    })),
    createdAt: product.created_at,
    updatedAt: product.updated_at,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
  ) {}

  private async attachRelations(
    db: Knex | Knex.Transaction,
    products: Array<ProductRow & { category_name: string; category_slug: string }>,
  ): Promise<ProductWithRelations[]> {
    if (products.length === 0) return [];

    const images = await db('product_images')
      .whereIn(
        'product_id',
        products.map((product) => product.id),
      )
      .orderBy([
        { column: 'is_primary', order: 'desc' },
        { column: 'position', order: 'asc' },
      ]);

    const byProduct = new Map<string, ProductImageRow[]>();
    for (const image of images) {
      const bucket = byProduct.get(image.product_id);
      if (bucket) bucket.push(image);
      else byProduct.set(image.product_id, [image]);
    }

    return products.map((product) => ({
      ...product,
      category: { id: product.category_id, name: product.category_name, slug: product.category_slug },
      images: byProduct.get(product.id) ?? [],
    }));
  }

  private baseQuery(db: Knex | Knex.Transaction = this.db.knex) {
    return db('products as p')
      .join('categories as c', 'c.id', 'p.category_id')
      .select('p.*', 'c.name as category_name', 'c.slug as category_slug');
  }

  private applyFilters<T extends Knex.QueryBuilder>(builder: T, query: ListProductsQueryDto): T {
    builder.whereNull('p.deleted_at');
    if (query.categoryId) builder.where('p.category_id', query.categoryId);
    if (query.status) builder.where('p.status', query.status);
    if (query.inStock) builder.where('p.stock_quantity', '>', 0);
    if (query.minPrice !== undefined) builder.where('p.price', '>=', toDecimal(query.minPrice).toFixed(2));
    if (query.maxPrice !== undefined) builder.where('p.price', '<=', toDecimal(query.maxPrice).toFixed(2));

    if (query.lowStock) builder.whereRaw('p.stock_quantity <= p.low_stock_threshold');
    if (query.search) {
      const term = `%${query.search}%`;
      builder.where((inner) =>
        inner.whereILike('p.name', term).orWhereILike('p.sku', term).orWhereILike('p.slug', term),
      );
    }
    return builder;
  }

  async list(query: ListProductsQueryDto): Promise<Paginated<ProductResponseDto>> {
    const rows = (await this.applyFilters(this.baseQuery(), query)
      .orderBy(`p.${SORT_COLUMNS[query.sort ?? 'createdAt'] ?? 'created_at'}`, query.order)
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)) as unknown as Array<ProductRow & { category_name: string; category_slug: string }>;

    const [{ count }] = await this.applyFilters(this.db.knex('products as p'), query).count<
      Array<{ count: string }>
    >('* as count');

    const products = await this.attachRelations(this.db.knex, rows);
    return paginated(products.map(toProductDto), query.page, query.limit, Number(count));
  }

  async findById(id: string): Promise<ProductResponseDto> {
    const row = (await this.baseQuery().where('p.id', id).whereNull('p.deleted_at').first()) as
      | (ProductRow & { category_name: string; category_slug: string })
      | undefined;
    if (!row) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);
    const [product] = await this.attachRelations(this.db.knex, [row]);
    return toProductDto(product);
  }

  private async replaceImages(
    trx: Knex.Transaction,
    productId: string,
    images: CreateProductDto['images'],
  ): Promise<void> {
    await trx('product_images').where({ product_id: productId }).del();
    if (!images || images.length === 0) return;

    await trx('product_images').insert(
      images.map((image, index) => ({
        id: randomUUID(),
        product_id: productId,
        url: image.url,
        alt_text: image.altText ?? null,
        position: image.position ?? index,
        is_primary: image.isPrimary ?? index === 0,
      })),
    );
  }

  async create(dto: CreateProductDto, actor: AuditActor): Promise<ProductResponseDto> {
    const clash = await this.db
      .knex('products')
      .where({ sku: dto.sku })
      .orWhere({ slug: dto.slug })
      .select('sku', 'slug')
      .first();

    if (clash?.sku === dto.sku) {
      throw AppException.conflict('That SKU is already in use', ErrorCode.SKU_ALREADY_EXISTS);
    }
    if (clash) throw AppException.conflict('That slug is already in use', ErrorCode.SLUG_ALREADY_EXISTS);

    const category = await this.db.knex('categories').where({ id: dto.categoryId }).first();
    if (!category) throw AppException.badRequest('The category does not exist', ErrorCode.CATEGORY_NOT_FOUND);

    const id = await this.db.transaction(async (trx) => {
      const [product] = await trx('products')
        .insert({
          id: randomUUID(),
          sku: dto.sku,
          slug: dto.slug,
          name: dto.name,
          description: dto.description ?? null,
          short_description: dto.shortDescription ?? null,
          category_id: dto.categoryId,
          price: toDecimal(dto.price).toFixed(2),
          compare_at_price: dto.compareAtPrice !== undefined ? toDecimal(dto.compareAtPrice).toFixed(2) : null,
          cost_price: dto.costPrice !== undefined ? toDecimal(dto.costPrice).toFixed(2) : null,
          stock_quantity: dto.stockQuantity ?? 0,
          low_stock_threshold: dto.lowStockThreshold ?? 5,
          status: dto.status ?? 'DRAFT',
          weight_grams: dto.weightGrams ?? null,
        })
        .returning('*');

      await this.replaceImages(trx, product.id, dto.images);

      if (product.stock_quantity > 0) {
        await this.inventory.appendTx(trx, [
          {
            productId: product.id,
            sku: product.sku,
            productName: product.name,
            reason: 'INITIAL',
            delta: product.stock_quantity,
            quantityBefore: 0,
            quantityAfter: product.stock_quantity,
            unitCost: product.cost_price,
            actorId: actor.id,
            actorEmail: actor.email,
            note: 'Opening stock recorded when the product was created',
          },
        ]);
      }

      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.productCreated,
        resource: 'product',
        resourceId: product.id,
        metadata: { sku: product.sku, name: product.name, price: money(product.price) },
      });
      await this.outbox.enqueue(trx, {
        routingKey: ROUTING_KEYS.catalogChanged,
        eventType: ROUTING_KEYS.catalogChanged,
        payload: { entity: 'product', id: product.id, action: 'created', slug: product.slug },
      });

      return product.id;
    });

    return this.findById(id);
  }

  async update(id: string, dto: UpdateProductDto, actor: AuditActor): Promise<ProductResponseDto> {
    const product = await this.db.knex('products').where({ id }).whereNull('deleted_at').first();
    if (!product) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);

    if (dto.slug && dto.slug !== product.slug) {
      const clash = await this.db.knex('products').where({ slug: dto.slug }).first();
      if (clash) throw AppException.conflict('That slug is already in use', ErrorCode.SLUG_ALREADY_EXISTS);
    }
    if (dto.categoryId) {
      const category = await this.db.knex('categories').where({ id: dto.categoryId }).first();
      if (!category) throw AppException.badRequest('The category does not exist', ErrorCode.CATEGORY_NOT_FOUND);
    }

    await this.db.transaction(async (trx) => {
      if (dto.images) await this.replaceImages(trx, id, dto.images);

      const patch = {
        ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.shortDescription !== undefined ? { short_description: dto.shortDescription } : {}),
        ...(dto.categoryId !== undefined ? { category_id: dto.categoryId } : {}),
        ...(dto.price !== undefined ? { price: toDecimal(dto.price).toFixed(2) } : {}),
        ...(dto.compareAtPrice !== undefined ? { compare_at_price: toDecimal(dto.compareAtPrice).toFixed(2) } : {}),
        ...(dto.costPrice !== undefined ? { cost_price: toDecimal(dto.costPrice).toFixed(2) } : {}),
        ...(dto.lowStockThreshold !== undefined ? { low_stock_threshold: dto.lowStockThreshold } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.weightGrams !== undefined ? { weight_grams: dto.weightGrams } : {}),
      };

      const [result] = Object.keys(patch).length > 0
        ? await trx('products').where({ id }).update(patch).returning('*')
        : [product];

      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.productUpdated,
        resource: 'product',
        resourceId: id,
        metadata: {
          sku: result.sku,
          changes: Object.keys(dto),
          ...(dto.price !== undefined ? { priceFrom: money(product.price), priceTo: money(result.price) } : {}),
        },
      });
      await this.outbox.enqueue(trx, {
        routingKey: ROUTING_KEYS.catalogChanged,
        eventType: ROUTING_KEYS.catalogChanged,
        payload: { entity: 'product', id, action: 'updated', slug: result.slug },
      });
    });

    return this.findById(id);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    const product = await this.db.knex('products').where({ id }).whereNull('deleted_at').first();
    if (!product) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);

    await this.db.transaction(async (trx) => {
      await trx('products')
        .where({ id })
        .update({
          deleted_at: new Date(),
          status: 'ARCHIVED',

          slug: `${product.slug}-archived-${Date.now()}`,
        });

      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.productDeleted,
        resource: 'product',
        resourceId: id,
        metadata: { sku: product.sku, name: product.name },
      });
      await this.outbox.enqueue(trx, {
        routingKey: ROUTING_KEYS.catalogChanged,
        eventType: ROUTING_KEYS.catalogChanged,
        payload: { entity: 'product', id, action: 'deleted', slug: product.slug },
      });
    });
  }

  async adjustStock(id: string, dto: AdjustStockDto, actor: AuditActor): Promise<ProductResponseDto> {
    if (dto.delta === 0) {
      throw AppException.unprocessable(
        'That adjustment would not change the stock level',
        ErrorCode.INVALID_STOCK_MOVEMENT,
      );
    }

    const product = await this.db.knex('products').where({ id }).whereNull('deleted_at').first();
    if (!product) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);

    await this.db.transaction(async (trx) => {
      const [updated] = await trx('products')
        .where({ id })
        .whereNull('deleted_at')
        .whereRaw('stock_quantity + ? >= 0', [dto.delta])
        .increment('stock_quantity', dto.delta)
        .returning('stock_quantity');

      if (!updated) {
        throw AppException.unprocessable(
          'That adjustment would take the stock level below zero',
          ErrorCode.INSUFFICIENT_STOCK,
          { currentStock: product.stock_quantity, delta: dto.delta },
        );
      }

      await this.inventory.appendTx(trx, [
        {
          productId: id,
          sku: product.sku,
          productName: product.name,
          reason: 'CORRECTION',
          delta: dto.delta,
          quantityBefore: updated.stock_quantity - dto.delta,
          quantityAfter: updated.stock_quantity,
          unitCost: product.cost_price,
          actorId: actor.id,
          actorEmail: actor.email,
          note: dto.reason ?? 'Adjusted from the product record',
        },
      ]);

      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.productStockAdjusted,
        resource: 'product',
        resourceId: id,
        metadata: {
          sku: product.sku,
          delta: dto.delta,
          from: product.stock_quantity,
          to: updated.stock_quantity,
          reason: dto.reason ?? null,
        },
      });
      await this.outbox.enqueue(trx, {
        routingKey: ROUTING_KEYS.catalogChanged,
        eventType: ROUTING_KEYS.catalogChanged,
        payload: { entity: 'product', id, action: 'stock_adjusted', slug: product.slug },
      });
    });

    return this.findById(id);
  }
}
