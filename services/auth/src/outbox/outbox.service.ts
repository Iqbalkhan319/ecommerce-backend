import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '@ecom/platform';
import type { Knex } from 'knex';

export interface OutboxInput {
  routingKey: string;
  eventType: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  async enqueue(trx: Knex.Transaction, input: OutboxInput): Promise<void> {
    await trx('outbox_messages').insert({
      id: randomUUID(),
      routing_key: input.routingKey,
      event_type: input.eventType,
      payload: input.payload as never,
      correlation_id: RequestContext.get()?.correlationId ?? null,
    });
  }
}
