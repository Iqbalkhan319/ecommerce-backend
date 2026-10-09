import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import { CatalogService } from '../catalog/catalog.service';
import { PUBLIC_ENV, type PublicEnv } from '../config/env';
import type { CartDto, CartLineDto } from './dto/cart.dto';
import type { CartItemRow, CartRow } from '../database/tables';

interface CartWithItems extends CartRow {
  items: CartItemRow[];
}

@Injectable()
export class CartService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: CatalogService,
    @Inject(PUBLIC_ENV) private readonly env: PublicEnv,
  ) {}

  private async itemsFor(db: Knex | Knex.Transaction, cartId: string): Promise<CartItemRow[]> {
    return db('cart_items').where({ cart_id: cartId }).orderBy('added_at', 'asc');
  }

  private async loadCart(customerId: string): Promise<CartWithItems> {
    const existing = await this.db.knex('carts').where({ customer_id: customerId }).first();
    if (existing) {
      return { ...existing, items: await this.itemsFor(this.db.knex, existing.id) };
    }

    const [created] = await this.db
      .knex('carts')
      .insert({ id: randomUUID(), customer_id: customerId })
      .onConflict('customer_id')
      .ignore()
      .returning('*');

    if (created) return { ...created, items: [] };

    const raced = await this.db.knex('carts').where({ customer_id: customerId }).first();
    if (!raced) throw AppException.internal('The basket could not be created');
    return { ...raced, items: await this.itemsFor(this.db.knex, raced.id) };
  }

  private async decorate(cart: CartWithItems): Promise<CartDto> {
    const lines: CartLineDto[] = [];
    let subtotal = 0;

    for (const item of cart.items) {
      try {
        const product = await this.catalog.availability(item.product_id);
        const unitPrice = Number(product.price);
        lines.push({
          productId: item.product_id,
          name: product.name,
          slug: product.slug,
          sku: product.sku,
          unitPrice: product.price,
          quantity: item.quantity,
          lineTotal: (unitPrice * item.quantity).toFixed(2),
          imageUrl: product.imageUrl,
          available: product.purchasable && product.stockQuantity >= item.quantity,
          stockQuantity: product.stockQuantity,
        });
        subtotal += unitPrice * item.quantity;
      } catch {
        lines.push({
          productId: item.product_id,
          name: 'This product is no longer available',
          slug: '',
          sku: '',
          unitPrice: '0.00',
          quantity: item.quantity,
          lineTotal: '0.00',
          imageUrl: null,
          available: false,
          stockQuantity: 0,
        });
      }
    }

    return {
      id: cart.id,
      revision: cart.revision,
      items: lines,
      itemCount: lines.reduce((count, line) => count + line.quantity, 0),
      estimatedSubtotal: subtotal.toFixed(2),
      currency: cart.currency,
      checkoutReady: lines.length > 0 && lines.every((line) => line.available),
    };
  }

  async get(customerId: string): Promise<CartDto> {
    return this.decorate(await this.loadCart(customerId));
  }

  private async touch(trx: Knex.Transaction, cartId: string): Promise<void> {
    await trx('carts').where({ id: cartId }).increment('revision', 1);
  }

  private async reload(trx: Knex.Transaction, cartId: string): Promise<CartWithItems> {
    const cart = await trx('carts').where({ id: cartId }).first();
    if (!cart) throw AppException.notFound('Basket not found');
    return { ...cart, items: await this.itemsFor(trx, cartId) };
  }

  async addItem(customerId: string, productId: string, quantity: number): Promise<CartDto> {
    const availability = await this.catalog.availability(productId).catch(() => null);
    if (!availability) throw AppException.notFound('Product not found', ErrorCode.PRODUCT_NOT_FOUND);
    if (!availability.purchasable) {
      throw AppException.unprocessable(
        `${availability.name} is not available to order at the moment`,
        ErrorCode.PRODUCT_UNAVAILABLE,
      );
    }

    const cart = await this.loadCart(customerId);
    const existing = cart.items.find((item) => item.product_id === productId);
    const desired = (existing?.quantity ?? 0) + quantity;

    if (!existing && cart.items.length >= this.env.CART_MAX_ITEMS) {
      throw AppException.unprocessable(
        `A basket may hold at most ${this.env.CART_MAX_ITEMS} different products`,
        ErrorCode.BAD_REQUEST,
      );
    }
    if (desired > this.env.CART_MAX_QUANTITY_PER_ITEM) {
      throw AppException.unprocessable(
        `At most ${this.env.CART_MAX_QUANTITY_PER_ITEM} units of one product can be ordered at a time`,
        ErrorCode.BAD_REQUEST,
      );
    }
    if (desired > availability.stockQuantity) {
      throw AppException.unprocessable(`Only ${availability.stockQuantity} left in stock`, ErrorCode.INSUFFICIENT_STOCK, {
        available: availability.stockQuantity,
        requested: desired,
      });
    }

    const updated = await this.db.transaction(async (trx) => {
      await trx('cart_items')
        .insert({ id: randomUUID(), cart_id: cart.id, product_id: productId, quantity: desired })
        .onConflict(['cart_id', 'product_id'])
        .merge(['quantity']);
      await this.touch(trx, cart.id);
      return this.reload(trx, cart.id);
    });

    return this.decorate(updated);
  }

  async updateItem(customerId: string, productId: string, quantity: number): Promise<CartDto> {
    const cart = await this.loadCart(customerId);
    const existing = cart.items.find((item) => item.product_id === productId);
    if (!existing) throw AppException.notFound('That product is not in your basket');

    if (quantity > 0) {
      const availability = await this.catalog.availability(productId).catch(() => null);
      if (!availability?.purchasable) {
        throw AppException.unprocessable('That product is no longer available', ErrorCode.PRODUCT_UNAVAILABLE);
      }
      if (quantity > availability.stockQuantity) {
        throw AppException.unprocessable(
          `Only ${availability.stockQuantity} left in stock`,
          ErrorCode.INSUFFICIENT_STOCK,
        );
      }
    }

    const updated = await this.db.transaction(async (trx) => {
      if (quantity === 0) {
        await trx('cart_items').where({ cart_id: cart.id, product_id: productId }).del();
      } else {
        await trx('cart_items').where({ cart_id: cart.id, product_id: productId }).update({ quantity });
      }
      await this.touch(trx, cart.id);
      return this.reload(trx, cart.id);
    });

    return this.decorate(updated);
  }

  async removeItem(customerId: string, productId: string): Promise<CartDto> {
    return this.updateItem(customerId, productId, 0);
  }

  async clear(customerId: string): Promise<CartDto> {
    const cart = await this.loadCart(customerId);
    const cleared = await this.db.transaction(async (trx) => {
      await trx('cart_items').where({ cart_id: cart.id }).del();
      await this.touch(trx, cart.id);
      return this.reload(trx, cart.id);
    });
    return this.decorate(cleared);
  }

  async snapshotForCheckout(
    customerId: string,
  ): Promise<{ cartId: string; revision: number; items: Array<{ productId: string; quantity: number }> }> {
    const cart = await this.loadCart(customerId);
    if (cart.items.length === 0) {
      throw AppException.unprocessable('Your basket is empty', ErrorCode.CART_EMPTY);
    }
    return {
      cartId: cart.id,
      revision: cart.revision,
      items: cart.items.map((item) => ({ productId: item.product_id, quantity: item.quantity })),
    };
  }

  async clearAfterCheckout(customerId: string): Promise<void> {
    const cart = await this.db.knex('carts').where({ customer_id: customerId }).first();
    if (!cart) return;
    await this.db.transaction(async (trx) => {
      await trx('cart_items').where({ cart_id: cart.id }).del();
      await this.touch(trx, cart.id);
    });
  }
}
