import { createHash } from 'node:crypto';
import { CheckoutService } from './checkout.service';
import { AppException } from '@ecom/platform';

describe('CheckoutService', () => {
  const identity = { customerId: 'cust-1', email: 'buyer@example.com', fullName: 'Buyer', phone: null };
  const address = { fullName: 'Buyer', line1: '1 High Street', city: 'Dhaka', postalCode: '1207', country: 'BD' };

  function build(overrides: Record<string, unknown> = {}) {
    const cart = {
      snapshotForCheckout: jest.fn().mockResolvedValue({
        cartId: 'cart-1',
        revision: 7,
        items: [{ productId: 'p1', quantity: 2 }],
      }),
      clearAfterCheckout: jest.fn().mockResolvedValue(undefined),
      ...(overrides.cart as object),
    };
    const commerce = {
      placeOrder: jest.fn().mockResolvedValue({ id: 'o1', orderNumber: 'AUR-2026-000001' }),
      orderByIdempotencyKey: jest.fn().mockRejectedValue(new Error('not found')),
      ...(overrides.commerce as object),
    };
    const profile = { addressById: jest.fn().mockResolvedValue(address) };
    return { service: new CheckoutService(cart as never, commerce as never, profile as never), cart, commerce, profile };
  }

  it('sends only product ids and quantities, never a price', async () => {
    const { service, commerce } = build();
    await service.checkout(identity, { shippingAddress: address });

    const payload = commerce.placeOrder.mock.calls[0][0];
    expect(payload.items).toEqual([{ productId: 'p1', quantity: 2 }]);
    expect(JSON.stringify(payload)).not.toMatch(/price|subtotal|grandTotal|total/i);
  });

  it('derives a stable idempotency key from the basket revision', async () => {
    const { service, commerce } = build();
    await service.checkout(identity, { shippingAddress: address });

    const expected = createHash('sha256').update('cust-1:cart-1:7').digest('hex');
    expect(commerce.placeOrder.mock.calls[0][0].idempotencyKey).toBe(expected);
  });

  it('produces the same key for a repeated submission of an unchanged basket', async () => {
    const { service, commerce } = build();
    await service.checkout(identity, { shippingAddress: address });
    await service.checkout(identity, { shippingAddress: address });

    const [first, second] = commerce.placeOrder.mock.calls.map((call: unknown[]) => (call[0] as { idempotencyKey: string }).idempotencyKey);
    expect(first).toBe(second);
  });

  it('prefers a client-supplied idempotency key when one is given', async () => {
    const { service, commerce } = build();
    await service.checkout(identity, { shippingAddress: address }, 'client-key-1');
    expect(commerce.placeOrder.mock.calls[0][0].idempotencyKey).toBe('client-key-1');
  });

  it('returns the original order for a retry whose basket was already cleared', async () => {
    const { service, commerce, cart } = build({
      commerce: { orderByIdempotencyKey: jest.fn().mockResolvedValue({ id: 'o1', orderNumber: 'AUR-2026-000001' }) },
    });

    const result = await service.checkout(identity, { shippingAddress: address }, 'client-key-1');

    expect(result.replay).toBe(true);
    expect(result.order.orderNumber).toBe('AUR-2026-000001');
    expect(commerce.placeOrder).not.toHaveBeenCalled();
    expect(cart.snapshotForCheckout).not.toHaveBeenCalled();
  });

  it('clears the basket only after the order is durably created', async () => {
    const { service, cart, commerce } = build();
    await service.checkout(identity, { shippingAddress: address });
    expect(commerce.placeOrder).toHaveBeenCalled();
    expect(cart.clearAfterCheckout).toHaveBeenCalledWith('cust-1');
  });

  it('leaves the basket intact when the order is rejected', async () => {
    const { service, cart } = build({
      commerce: { placeOrder: jest.fn().mockRejectedValue(new Error('INSUFFICIENT_STOCK')) },
    });

    await expect(service.checkout(identity, { shippingAddress: address })).rejects.toThrow();
    expect(cart.clearAfterCheckout).not.toHaveBeenCalled();
  });

  it('requires an address rather than silently ordering without one', async () => {
    const { service } = build();
    await expect(service.checkout(identity, {})).rejects.toBeInstanceOf(AppException);
  });

  it('resolves a saved address through the profile it belongs to', async () => {
    const { service, profile, commerce } = build();
    await service.checkout(identity, { shippingAddressId: 'addr-1' });

    expect(profile.addressById).toHaveBeenCalledWith('cust-1', 'addr-1');
    expect(commerce.placeOrder.mock.calls[0][0].shippingAddress).toEqual(address);
  });

  it('defaults the billing address to the delivery address', async () => {
    const { service, commerce } = build();
    await service.checkout(identity, { shippingAddress: address });
    expect(commerce.placeOrder.mock.calls[0][0].billingAddress).toEqual(address);
  });
});
