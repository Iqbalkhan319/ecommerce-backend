import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalApiGuard, Public, paginated } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { toProductDto } from '../catalog/products.service';
import { ListProductsQueryDto } from '../catalog/dto/product.dto';
import { money, toDecimal } from '../catalog/money';
import type { ProductImageRow, ProductRow } from '../database/tables';

const SORT_COLUMNS: Record<string, string> = {
  createdAt: 'created_at',
  price: 'price',
  name: 'name',
  stockQuantity: 'stock_quantity',
};

type ProductQueryRow = ProductRow & { category_name: string; category_slug: string };

@ApiExcludeController()
@Public()
@UseGuards(InternalApiGuard)
@Controller('internal/catalog')
export class InternalCatalogController {
  constructor(private readonly db: DatabaseService) {}

  private baseQuery() {
    return this.db
      .knex('products as p')
      .join('categories as c', 'c.id', 'p.category_id')
      .select('p.*', 'c.name as category_name', 'c.slug as category_slug')
      .whereNull('p.deleted_at')
      .where('p.status', 'ACTIVE');
  }

  private applyStorefrontFilters<T extends Knex.QueryBuilder>(builder: T, query: ListProductsQueryDto): T {
    builder.whereNull('p.deleted_at').where('p.status', 'ACTIVE');
    if (query.categoryId) builder.where('p.category_id', query.categoryId);
    if (query.inStock) builder.where('p.stock_quantity', '>', 0);
    if (query.minPrice !== undefined) builder.where('p.price', '>=', toDecimal(query.minPrice).toFixed(2));
    if (query.maxPrice !== undefined) builder.where('p.price', '<=', toDecimal(query.maxPrice).toFixed(2));
    if (query.search) {
      const term = `%${query.search}%`;
      builder.where((inner) =>
        inner.whereILike('p.name', term).orWhereILike('p.description', term).orWhereILike('p.sku', term),
      );
    }
    return builder;
  }

  private async withImages(rows: ProductQueryRow[]) {
    if (rows.length === 0) return [];

    const images = await this.db
      .knex('product_images')
      .whereIn(
        'product_id',
        rows.map((row) => row.id),
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

    return rows.map((row) => ({
      ...row,
      category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
      images: byProduct.get(row.id) ?? [],
    }));
  }

  @Get('products')
  async listProducts(@Query() query: ListProductsQueryDto) {
    const rows = (await this.applyStorefrontFilters(
      this.db
        .knex('products as p')
        .join('categories as c', 'c.id', 'p.category_id')
        .select('p.*', 'c.name as category_name', 'c.slug as category_slug'),
      query,
    )
      .orderBy(`p.${SORT_COLUMNS[query.sort ?? 'createdAt'] ?? 'created_at'}`, query.order)
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)) as unknown as ProductQueryRow[];

    const [{ count }] = await this.applyStorefrontFilters(this.db.knex('products as p'), query).count<
      Array<{ count: string }>
    >('* as count');

    const products = await this.withImages(rows);
    return paginated(products.map(toProductDto), query.page, query.limit, Number(count));
  }

  @Get('products/slug/:slug')
  async productBySlug(@Param('slug') slug: string) {
    const row = (await this.baseQuery().where('p.slug', slug).first()) as ProductQueryRow | undefined;
    if (!row) throw new NotFoundException('Product not found');
    const [product] = await this.withImages([row]);
    return toProductDto(product);
  }

  @Get('products/:id')
  async productById(@Param('id') id: string) {
    const row = (await this.baseQuery().where('p.id', id).first()) as ProductQueryRow | undefined;
    if (!row) throw new NotFoundException('Product not found');
    const [product] = await this.withImages([row]);
    return toProductDto(product);
  }

  @Get('products/:id/availability')
  async availability(@Param('id') id: string) {
    const product = await this.db
      .knex('products')
      .where({ id })
      .whereNull('deleted_at')
      .select('id', 'name', 'slug', 'sku', 'price', 'stock_quantity', 'status', 'currency')
      .first();

    if (!product) throw new NotFoundException('Product not found');

    const image = await this.db
      .knex('product_images')
      .where({ product_id: id, is_primary: true })
      .select('url')
      .first();

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      price: money(product.price)!,
      currency: product.currency,
      imageUrl: image?.url ?? null,
      stockQuantity: product.stock_quantity,
      purchasable: product.status === 'ACTIVE' && product.stock_quantity > 0,
    };
  }

  @Get('categories')
  async listCategories() {
    const categories = await this.db
      .knex('categories as c')
      .where('c.is_active', true)
      .orderBy([
        { column: 'c.position', order: 'asc' },
        { column: 'c.name', order: 'asc' },
      ])
      .select(
        'c.id',
        'c.name',
        'c.slug',
        'c.description',
        'c.parent_id',
        'c.image_url',
        this.db.knex.raw(
          `(SELECT count(*) FROM products p
            WHERE p.category_id = c.id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL) AS product_count`,
        ),
      );

    return (categories as unknown as Array<Record<string, string>>).map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      parentId: category.parent_id,
      imageUrl: category.image_url,
      productCount: Number(category.product_count),
    }));
  }
}
