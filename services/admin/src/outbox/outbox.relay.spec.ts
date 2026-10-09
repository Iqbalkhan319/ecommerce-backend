import { OutboxRelay } from './outbox.relay';
import type { AdminEnv } from '../config/env';

describe('OutboxRelay', () => {
  const env = {
    SERVICE_NAME: 'admin-service',
    RABBITMQ_ENABLED: true,
    OUTBOX_POLL_INTERVAL_MS: 1000,
    OUTBOX_BATCH_SIZE: 50,
  } as unknown as AdminEnv;

  interface UpdateCall {
    where?: Record<string, unknown>;
    whereIn?: [string, unknown[]];
    data: Record<string, unknown>;
  }

  function harness(rows: Array<Record<string, unknown>>, publish: jest.Mock) {
    const updates: UpdateCall[] = [];
    const claim = { forUpdate: false, skipLocked: false, where: [] as unknown[][] };

    const builder = () => {
      const state: UpdateCall = { data: {} };
      const chain: Record<string, unknown> = {};

      const passthrough = (name: string) => (...args: unknown[]) => {
        if (name === 'where') {
          if (typeof args[0] === 'object') state.where = args[0] as Record<string, unknown>;
          claim.where.push(args);
        }
        if (name === 'whereIn') state.whereIn = args as [string, unknown[]];
        if (name === 'forUpdate') claim.forUpdate = true;
        if (name === 'skipLocked') claim.skipLocked = true;
        return chain;
      };

      for (const name of ['select', 'where', 'andWhere', 'whereIn', 'orderBy', 'limit', 'forUpdate', 'skipLocked']) {
        chain[name] = passthrough(name);
      }

      chain.update = (data: Record<string, unknown>) => {
        state.data = data;
        updates.push({ ...state });
        return Promise.resolve(1);
      };

      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);

      return chain;
    };

    const trx = Object.assign(jest.fn(() => builder()), { fn: { now: () => 'now()' } });
    const db = { transaction: jest.fn((callback: (t: unknown) => unknown) => callback(trx)) };
    const amqp = { publish } as never;
    const relay = new OutboxRelay(db as never, amqp, env);

    return { relay, updates, claim, trx };
  }

  const row = (id: string, routingKey = 'order.created', attempts = 0) => ({
    id,
    routing_key: routingKey,
    event_type: routingKey,
    payload: { orderId: 'order-1' },
    attempts,
    correlation_id: 'corr-1',
  });

  const published = (updates: UpdateCall[]) => updates.filter((call) => call.data.status === 'PUBLISHED');
  const failed = (updates: UpdateCall[]) => updates.filter((call) => call.data.status !== 'PUBLISHED');

  it('publishes pending messages and marks them published', async () => {
    const publish = jest.fn().mockResolvedValue(true);
    const { relay, updates } = harness([row('m1'), row('m2')], publish);

    const count = await relay.drain();

    expect(count).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0]).toBe('order.created');

    const marks = published(updates);
    expect(marks).toHaveLength(1);
    expect(marks[0].whereIn).toEqual(['id', ['m1', 'm2']]);
    expect(marks[0].data.published_at).toBeInstanceOf(Date);
  });

  it('carries the message id and correlation id into the envelope', async () => {
    const publish = jest.fn().mockResolvedValue(true);
    const { relay } = harness([row('m1')], publish);

    await relay.drain();

    const envelope = publish.mock.calls[0][1];
    expect(envelope.id).toBe('m1');
    expect(envelope.type).toBe('order.created');
    expect(envelope.correlationId).toBe('corr-1');
    expect(envelope.producer).toBe('admin-service');
    expect(envelope.payload).toEqual({ orderId: 'order-1' });
  });

  it('leaves a message pending with backoff when the broker rejects it', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('broker unavailable'));
    const { relay, updates } = harness([row('m1')], publish);

    const count = await relay.drain();

    expect(count).toBe(0);
    expect(published(updates)).toHaveLength(0);

    const retry = failed(updates)[0];
    expect(retry.where).toEqual({ id: 'm1' });
    expect(retry.data).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'broker unavailable' });

    expect((retry.data.available_at as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('gives up on a message only after the attempt ceiling', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('still down'));
    const { relay, updates } = harness([row('m1', 'order.created', 9)], publish);

    await relay.drain();

    expect(failed(updates)[0].data).toMatchObject({ status: 'FAILED', attempts: 10 });
  });

  it('publishes the healthy messages in a batch even when one fails', async () => {
    const publish = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(true);
    const { relay, updates } = harness([row('m1'), row('m2'), row('m3')], publish);

    const count = await relay.drain();

    expect(count).toBe(2);
    expect(published(updates)[0].whereIn).toEqual(['id', ['m1', 'm3']]);
  });

  it('does nothing when there is no pending work', async () => {
    const publish = jest.fn();
    const { relay, updates } = harness([], publish);

    expect(await relay.drain()).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('claims rows with FOR UPDATE SKIP LOCKED so replicas never publish the same row', async () => {
    const publish = jest.fn().mockResolvedValue(true);
    const { relay, claim, trx } = harness([row('m1')], publish);

    await relay.drain();

    expect(trx).toHaveBeenCalledWith('outbox_messages');
    expect(claim.forUpdate).toBe(true);
    expect(claim.skipLocked).toBe(true);

    expect(claim.where).toEqual(expect.arrayContaining([['status', 'PENDING']]));
  });
});
