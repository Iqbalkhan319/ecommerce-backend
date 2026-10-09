import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '@ecom/platform';
import type { Knex } from 'knex';
import { DatabaseService } from '../database/database.service';
import type { AuditLogInsert } from '../database/tables';

export interface AuditActor {
  id: string | null;
  email: string | null;
  type?: string;
}

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export const AUDIT_ACTIONS = {
  productCreated: 'product.created',
  productUpdated: 'product.updated',
  productDeleted: 'product.deleted',
  productStockAdjusted: 'product.stock_adjusted',
  inventoryMovementRecorded: 'inventory.movement_recorded',
  inventorySettingsUpdated: 'inventory.settings_updated',
  reportExported: 'report.exported',
  categoryCreated: 'category.created',
  categoryUpdated: 'category.updated',
  categoryDeleted: 'category.deleted',
  orderConfirmed: 'order.confirmed',
  orderRejected: 'order.rejected',
  orderStatusChanged: 'order.status_changed',
  orderNoteUpdated: 'order.note_updated',
  invoiceDownloaded: 'invoice.downloaded',
  adminCreated: 'admin.created',
  adminUpdated: 'admin.updated',
  adminDeleted: 'admin.deleted',
  adminRolesChanged: 'admin.roles_changed',
  adminSessionsRevoked: 'admin.sessions_revoked',
  customerUpdated: 'customer.updated',
  customerDeleted: 'customer.deleted',
  roleCreated: 'role.created',
  roleUpdated: 'role.updated',
  roleDeleted: 'role.deleted',
} as const;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  private toRow(entry: AuditEntry): AuditLogInsert {
    return {
      id: randomUUID(),
      actor_id: entry.actor.id,
      actor_email: entry.actor.email,
      actor_type: entry.actor.type ?? 'ADMIN',
      action: entry.action,
      resource: entry.resource,
      resource_id: entry.resourceId ?? null,
      request_id: RequestContext.get()?.requestId ?? null,
      ip_address: entry.ipAddress ?? null,
      metadata: (entry.metadata ?? {}) as Record<string, unknown>,
    };
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.knex('audit_logs').insert(this.toRow(entry));
    } catch (error) {
      this.logger.error(`Failed to write an audit entry for ${entry.action}: ${(error as Error).message}`);
    }
  }

  async recordTx(trx: Knex.Transaction, entry: AuditEntry): Promise<void> {
    await trx('audit_logs').insert(this.toRow(entry));
  }
}
