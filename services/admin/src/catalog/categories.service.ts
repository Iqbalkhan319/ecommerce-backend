import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode, ROUTING_KEYS, paginated, type Paginated } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import type {
  CategoryResponseDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';
import type { CategoryRow } from '../database/tables';

interface CategoryWithCounts extends CategoryRow {
  product_count: string;
  child_count: string;
}

function toDto(category: CategoryWithCounts): CategoryResponseDto {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    parentId: category.parent_id,
    position: category.position,
    isActive: category.is_active,
    imageUrl: category.image_url,
    productCount: Number(category.product_count),
    createdAt: category.created_at,
    updatedAt: category.updated_at,
  };
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private withCounts(db: Knex | Knex.Transaction = this.db.knex) {
    return db('categories as c')
      .select(
        'c.*',
        db.raw(
          '(SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count',
        ),
        db.raw('(SELECT count(*) FROM categories k WHERE k.parent_id = c.id) AS child_count'),
      );
  }

  private applyFilters<T extends Knex.QueryBuilder>(builder: T, query: ListCategoriesQueryDto): T {
    if (query.parentId) builder.where('c.parent_id', query.parentId);
    if (query.isActive !== undefined) builder.where('c.is_active', query.isActive);
    if (query.search) builder.whereILike('c.name', `%${query.search}%`);
    return builder;
  }

  async list(query: ListCategoriesQueryDto): Promise<Paginated<CategoryResponseDto>> {
    const rows = (await this.applyFilters(this.withCounts(), query)
      .orderBy([
        { column: 'c.position', order: 'asc' },
        { column: 'c.name', order: 'asc' },
      ])
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)) as unknown as CategoryWithCounts[];

    const [{ count }] = await this.applyFilters(this.db.knex('categories as c'), query).count<
      Array<{ count: string }>
    >('* as count');

    return paginated(rows.map(toDto), query.page, query.limit, Number(count));
  }

  async findById(id: string): Promise<CategoryResponseDto> {
    const category = (await this.withCounts().where('c.id', id).first()) as CategoryWithCounts | undefined;
    if (!category) throw AppException.notFound('Category not found', ErrorCode.CATEGORY_NOT_FOUND);
    return toDto(category);
  }

  private async assertParentIsValid(parentId: string): Promise<void> {
    const parent = await this.db.knex('categories').where({ id: parentId }).first();
    if (!parent) throw AppException.badRequest('The parent category does not exist');

    if (parent.parent_id) throw AppException.badRequest('Categories may only nest one level deep');
  }

  async create(dto: CreateCategoryDto, actor: AuditActor): Promise<CategoryResponseDto> {
    const existing = await this.db.knex('categories').where({ slug: dto.slug }).first();
    if (existing) throw AppException.conflict('That slug is already in use', ErrorCode.SLUG_ALREADY_EXISTS);

    if (dto.parentId) await this.assertParentIsValid(dto.parentId);

    const id = await this.db.transaction(async (trx) => {
      const [category] = await trx('categories')
        .insert({
          id: randomUUID(),
          name: dto.name,
          slug: dto.slug,
          description: dto.description ?? null,
          parent_id: dto.parentId ?? null,
          position: dto.position ?? 0,
          is_active: dto.isActive ?? true,
          image_url: dto.imageUrl ?? null,
        })
        .returning('*');

      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.categoryCreated,
        resource: 'category',
        resourceId: category.id,
        metadata: { slug: category.slug, name: category.name },
      });
      await this.outbox.enqueue(trx, {
        routingKey: ROUTING_KEYS.catalogChanged,
        eventType: ROUTING_KEYS.catalogChanged,
        payload: { entity: 'category', id: category.id, action: 'created', slug: category.slug },
      });

      return category.id;
    });

    return this.findById(id);
  }

  async update(id: string, dto: UpdateCategoryDto, actor: AuditActor): Promise<CategoryResponseDto> {
    const category = await this.db.knex('categories').where({ id }).first();
    if (!category) throw AppException.notFound('Category not found', ErrorCode.CATEGORY_NOT_FOUND);

    if (dto.slug && dto.slug !== category.slug) {
      const clash = await this.db.knex('categories').where({ slug: dto.slug }).first();
      if (clash) throw AppException.conflict('That slug is already in use', ErrorCode.SLUG_ALREADY_EXISTS);
    }

    if (dto.parentId) {
      if (dto.parentId === id) throw AppException.badRequest('A category cannot be its own parent');
      await this.assertParentIsValid(dto.parentId);

      const [{ count }] = await this.db
        .knex('categories')
        .where({ parent_id: id })
        .count<Array<{ count: string }>>('* as count');
      if (Number(count) > 0) {
        throw AppException.badRequest('A category with children cannot itself become a child');
      }
    }

    await this.db.transaction(async (trx) => {
      const patch = {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.parentId !== undefined ? { parent_id: dto.parentId } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        ...(dto.imageUrl !== undefined ? { image_url: dto.imageUrl } : {}),
      };

      const [result] = Object.keys(patch).length > 0
        ? await trx('categories').where({ id }).update(patch).returning('*')
        : [category];

      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.categoryUpdated,
        resource: 'category',
        resourceId: id,
        metadata: { changes: Object.keys(dto) },
      });
      await this.outbox.enqueue(trx, {
        routingKey: ROUTING_KEYS.catalogChanged,
        eventType: ROUTING_KEYS.catalogChanged,
        payload: { entity: 'category', id, action: 'updated', slug: result.slug },
      });
    });

    return this.findById(id);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    const category = (await this.withCounts().where('c.id', id).first()) as CategoryWithCounts | undefined;
    if (!category) throw AppException.notFound('Category not found', ErrorCode.CATEGORY_NOT_FOUND);

    const productCount = Number(category.product_count);
    if (productCount > 0) {
      throw AppException.conflict(
        `This category still contains ${productCount} product(s)`,
        ErrorCode.CATEGORY_IN_USE,
      );
    }
    if (Number(category.child_count) > 0) {
      throw AppException.conflict('Remove the sub-categories first', ErrorCode.CATEGORY_IN_USE);
    }

    await this.db.transaction(async (trx) => {
      await trx('categories').where({ id }).del();
      await this.audit.recordTx(trx, {
        actor,
        action: AUDIT_ACTIONS.categoryDeleted,
        resource: 'category',
        resourceId: id,
        metadata: { slug: category.slug },
      });
      await this.outbox.enqueue(trx, {
        routingKey: ROUTING_KEYS.catalogChanged,
        eventType: ROUTING_KEYS.catalogChanged,
        payload: { entity: 'category', id, action: 'deleted', slug: category.slug },
      });
    });
  }
}
