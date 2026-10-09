import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { AppException, ErrorCode, ROUTING_KEYS } from '@ecom/platform';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { findOrderAggregate } from '../orders/order.repository';

export interface InvoiceDownload {
  file: StreamableFile;
  filename: string;
  sizeBytes: number;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly pdf: InvoicePdfService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async generateForOrder(orderId: string): Promise<{ invoiceNumber: string; regenerated: boolean }> {
    const order = await findOrderAggregate(this.db.knex, { id: orderId });
    if (!order) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);
    if (!order.invoice) throw AppException.notFound('No invoice is due for this order', ErrorCode.INVOICE_NOT_FOUND);

    if (order.invoice.status === 'GENERATED' && order.invoice.storage_key) {
      const path = this.pdf.resolvePath(order.invoice.storage_key);
      const present = await access(path, constants.R_OK).then(
        () => true,
        () => false,
      );
      if (present) return { invoiceNumber: order.invoice.invoice_number, regenerated: false };
      this.logger.warn(
        `Invoice ${order.invoice.invoice_number} was marked generated but the file is missing; re-rendering`,
      );
    }

    try {
      const invoice = order.invoice;
      const rendered = await this.pdf.render(order, invoice.invoice_number);

      await this.db.transaction(async (trx) => {
        await trx('invoices').where({ id: invoice.id }).update({
          status: 'GENERATED',
          storage_key: rendered.storageKey,
          file_size_bytes: rendered.fileSizeBytes,
          checksum: rendered.checksum,
          generated_at: new Date(),
          last_error: null,
        });
        await this.outbox.enqueue(trx, {
          routingKey: ROUTING_KEYS.invoiceGenerated,
          eventType: ROUTING_KEYS.invoiceGenerated,
          payload: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_number,
            orderId: order.id,
            customerId: order.customer_id,
            generatedAt: new Date().toISOString(),
          },
        });
      });

      return { invoiceNumber: invoice.invoice_number, regenerated: true };
    } catch (error) {
      await this.db
        .knex('invoices')
        .where({ id: order.invoice.id })
        .update({ status: 'FAILED', last_error: (error as Error).message.slice(0, 500) });
      throw error;
    }
  }

  async download(orderId: string, options: { customerId?: string; actor?: AuditActor }): Promise<InvoiceDownload> {
    const order = await findOrderAggregate(this.db.knex, {
      id: orderId,
      ...(options.customerId ? { customer_id: options.customerId } : {}),
    });

    if (!order) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);
    if (!order.invoice) {
      throw AppException.notFound(
        'No invoice has been issued for this order yet. Invoices are issued once an order is confirmed.',
        ErrorCode.INVOICE_NOT_FOUND,
      );
    }
    if (order.invoice.status !== 'GENERATED' || !order.invoice.storage_key) {
      throw AppException.unprocessable(
        'The invoice is still being generated. Please try again shortly.',
        ErrorCode.INVOICE_NOT_READY,
      );
    }

    const path = this.pdf.resolvePath(order.invoice.storage_key);
    await access(path, constants.R_OK).catch(() => {
      throw AppException.notFound('The invoice document is not available', ErrorCode.INVOICE_NOT_FOUND);
    });

    if (options.actor) {
      await this.audit.record({
        actor: options.actor,
        action: AUDIT_ACTIONS.invoiceDownloaded,
        resource: 'invoice',
        resourceId: order.invoice.id,
        metadata: { orderNumber: order.order_number, invoiceNumber: order.invoice.invoice_number },
      });
    }

    return {
      file: new StreamableFile(createReadStream(path)),
      filename: `${order.invoice.invoice_number}.pdf`,
      sizeBytes: order.invoice.file_size_bytes ?? 0,
    };
  }

  async statusForOrder(orderId: string, customerId?: string) {
    const order = await findOrderAggregate(this.db.knex, {
      id: orderId,
      ...(customerId ? { customer_id: customerId } : {}),
    });
    if (!order) throw AppException.notFound('Order not found', ErrorCode.ORDER_NOT_FOUND);
    if (!order.invoice) return { available: false, status: 'NOT_ISSUED' as const, invoiceNumber: null };
    return {
      available: order.invoice.status === 'GENERATED' && Boolean(order.invoice.storage_key),
      status: order.invoice.status,
      invoiceNumber: order.invoice.invoice_number,
      generatedAt: order.invoice.generated_at,
    };
  }
}
