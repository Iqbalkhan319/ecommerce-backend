import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppException, ErrorCode } from '@ecom/platform';
import { CartService } from '../cart/cart.service';
import { CommerceClient, type OrderSummary } from '../clients/commerce.client';
import { ProfileService } from '../profile/profile.service';
import type { CheckoutAddressDto, CheckoutDto } from './dto/checkout.dto';

export interface CheckoutResult {
  order: OrderSummary;
  replay: boolean;
}

export interface CheckoutIdentity {
  customerId: string;
  email: string;
  fullName: string;
  phone?: string | null;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly cart: CartService,
    private readonly commerce: CommerceClient,
    private readonly profile: ProfileService,
  ) {}

  private deriveIdempotencyKey(customerId: string, cartId: string, revision: number): string {
    return createHash('sha256').update(`${customerId}:${cartId}:${revision}`).digest('hex');
  }

  async checkout(identity: CheckoutIdentity, dto: CheckoutDto, clientKey?: string): Promise<CheckoutResult> {
    if (clientKey?.trim()) {
      const existing = await this.commerce
        .orderByIdempotencyKey(clientKey.trim(), identity.customerId)
        .catch(() => null);
      if (existing) {
        this.logger.log(`Resolved a retried checkout for customer ${identity.customerId} to order ${existing.orderNumber}`);
        return { order: existing, replay: true };
      }
    }

    const snapshot = await this.cart.snapshotForCheckout(identity.customerId);

    const shippingAddress = dto.shippingAddressId
      ? await this.profile.addressById(identity.customerId, dto.shippingAddressId)
      : this.requireAddress(dto.shippingAddress);

    const idempotencyKey =
      clientKey?.trim() || this.deriveIdempotencyKey(identity.customerId, snapshot.cartId, snapshot.revision);

    const order = await this.commerce.placeOrder({
      customerId: identity.customerId,
      customerEmail: identity.email,
      customerName: identity.fullName,
      customerPhone: identity.phone ?? undefined,
      items: snapshot.items,
      shippingAddress,
      billingAddress: dto.billingAddress ?? shippingAddress,
      customerNote: dto.customerNote,
      idempotencyKey,
    });

    await this.cart.clearAfterCheckout(identity.customerId);
    this.logger.log(`Customer ${identity.customerId} placed order ${order.orderNumber}`);

    return { order, replay: false };
  }

  private requireAddress(address?: CheckoutAddressDto): CheckoutAddressDto {
    if (!address) {
      throw AppException.badRequest(
        'A delivery address is required. Supply one, or reference a saved address.',
        ErrorCode.BAD_REQUEST,
      );
    }
    return address;
  }
}
