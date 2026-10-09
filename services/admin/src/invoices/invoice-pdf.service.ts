import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { money } from '../catalog/money';
import { ADMIN_ENV, type AdminEnv } from '../config/env';
import type { OrderWithRelations } from '../orders/order.mapper';

export interface RenderedInvoice {
  storageKey: string;
  fileSizeBytes: number;
  checksum: string;
}

interface AddressShape {
  fullName?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  state?: string | null;
  postalCode?: string;
  country?: string;
  phone?: string | null;
}

const PAGE_MARGIN = 50;
const INK = '#1a1a2e';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(@Inject(ADMIN_ENV) private readonly env: AdminEnv) {}

  get storageDir(): string {
    return resolve(this.env.INVOICE_STORAGE_DIR);
  }

  storageKeyFor(invoiceNumber: string): string {
    return `${invoiceNumber.replace(/[^A-Za-z0-9-_]/g, '')}.pdf`;
  }

  resolvePath(storageKey: string): string {
    const safeKey = storageKey.replace(/[^A-Za-z0-9-_.]/g, '');
    const fullPath = resolve(join(this.storageDir, safeKey));
    if (!fullPath.startsWith(`${this.storageDir}/`) && fullPath !== this.storageDir) {
      throw new Error('Resolved invoice path escaped the storage directory');
    }
    return fullPath;
  }

  async render(order: OrderWithRelations, invoiceNumber: string): Promise<RenderedInvoice> {
    await mkdir(this.storageDir, { recursive: true });
    const storageKey = this.storageKeyFor(invoiceNumber);
    const fullPath = this.resolvePath(storageKey);

    const document = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      info: {
        Title: `Invoice ${invoiceNumber}`,
        Author: this.env.INVOICE_COMPANY_NAME,
        Subject: `Invoice for order ${order.order_number}`,
      },
    });

    const hash = createHash('sha256');
    document.on('data', (chunk: Buffer) => hash.update(chunk));

    const writeStream = createWriteStream(fullPath, { mode: 0o640 });
    const done = pipeline(document as unknown as NodeJS.ReadableStream, writeStream);

    this.compose(document, order, invoiceNumber);
    document.end();
    await done;

    const stats = await stat(fullPath);
    this.logger.log(`Rendered invoice ${invoiceNumber} (${stats.size} bytes)`);

    return { storageKey, fileSizeBytes: stats.size, checksum: hash.digest('hex') };
  }

  private compose(doc: PDFKit.PDFDocument, order: OrderWithRelations, invoiceNumber: string): void {
    const currency = order.currency;
    const shipping = (order.shipping_address ?? {}) as AddressShape;
    const billing = (order.billing_address ?? order.shipping_address ?? {}) as AddressShape;

    doc.fillColor(INK).fontSize(22).font('Helvetica-Bold').text(this.env.INVOICE_COMPANY_NAME, PAGE_MARGIN, PAGE_MARGIN);
    doc.fontSize(9).font('Helvetica').fillColor(MUTED);
    doc.text(this.env.INVOICE_COMPANY_ADDRESS);
    doc.text(this.env.INVOICE_COMPANY_EMAIL);
    doc.text(`Registration: ${this.env.INVOICE_COMPANY_REGISTRATION}`);

    doc.fontSize(20).font('Helvetica-Bold').fillColor(INK).text('INVOICE', 380, PAGE_MARGIN, { align: 'right' });
    doc.fontSize(9).font('Helvetica').fillColor(MUTED);
    doc.text(`Invoice number: ${invoiceNumber}`, { align: 'right' });
    doc.text(`Order number: ${order.order_number}`, { align: 'right' });
    doc.text(`Order date: ${order.placed_at.toISOString().slice(0, 10)}`, { align: 'right' });
    doc.text(`Order status: ${order.status}`, { align: 'right' });

    doc.moveTo(PAGE_MARGIN, 150).lineTo(545, 150).strokeColor(RULE).stroke();

    let cursor = 170;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text('Billed to', PAGE_MARGIN, cursor);
    doc.text('Shipped to', 320, cursor);
    cursor += 15;

    doc.fontSize(9).font('Helvetica').fillColor(MUTED);
    const billingLines = this.addressLines(billing, order.customer_email);
    const shippingLines = this.addressLines(shipping, null);
    const blockHeight = Math.max(billingLines.length, shippingLines.length) * 12;

    doc.text(billingLines.join('\n'), PAGE_MARGIN, cursor, { width: 240 });
    doc.text(shippingLines.join('\n'), 320, cursor, { width: 225 });
    cursor += blockHeight + 25;

    const columns = { name: PAGE_MARGIN, sku: 240, qty: 340, unit: 390, total: 470 };
    doc.fontSize(9).font('Helvetica-Bold').fillColor(INK);
    doc.text('Item', columns.name, cursor);
    doc.text('SKU', columns.sku, cursor);
    doc.text('Qty', columns.qty, cursor, { width: 30, align: 'right' });
    doc.text('Unit price', columns.unit, cursor, { width: 70, align: 'right' });
    doc.text('Amount', columns.total, cursor, { width: 75, align: 'right' });
    cursor += 14;
    doc.moveTo(PAGE_MARGIN, cursor).lineTo(545, cursor).strokeColor(RULE).stroke();
    cursor += 8;

    doc.font('Helvetica').fillColor(INK);
    for (const item of order.items) {
      if (cursor > 700) {
        doc.addPage();
        cursor = PAGE_MARGIN;
      }
      doc.text(item.name, columns.name, cursor, { width: 185 });
      doc.fillColor(MUTED).text(item.sku, columns.sku, cursor, { width: 95 });
      doc.fillColor(INK);
      doc.text(String(item.quantity), columns.qty, cursor, { width: 30, align: 'right' });
      doc.text(`${money(item.unit_price)}`, columns.unit, cursor, { width: 70, align: 'right' });
      doc.text(`${money(item.line_total)}`, columns.total, cursor, { width: 75, align: 'right' });
      cursor += Math.max(16, doc.heightOfString(item.name, { width: 185 }));
    }

    cursor += 6;
    doc.moveTo(320, cursor).lineTo(545, cursor).strokeColor(RULE).stroke();
    cursor += 10;

    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? INK : MUTED).fontSize(bold ? 11 : 9);
      doc.text(label, 320, cursor, { width: 140, align: 'right' });
      doc.text(value, 470, cursor, { width: 75, align: 'right' });
      cursor += bold ? 18 : 14;
    };

    totalRow('Subtotal', `${currency} ${money(order.subtotal)}`);
    totalRow('Discount', `- ${currency} ${money(order.discount_total)}`);
    totalRow('Shipping', `${currency} ${money(order.shipping_total)}`);
    totalRow('Tax', `${currency} ${money(order.tax_total)}`);
    cursor += 2;
    totalRow('Total due', `${currency} ${money(order.grand_total)}`, true);

    cursor += 20;
    doc.fontSize(8).font('Helvetica').fillColor(MUTED);
    doc.text(
      'This order was placed without an online payment. Settlement is arranged separately in line with the agreed terms. ' +
        'This document is issued electronically and is valid without a signature.',
      PAGE_MARGIN,
      cursor,
      { width: 495 },
    );

    if (order.customer_note) {
      cursor += 30;
      doc.font('Helvetica-Bold').fillColor(INK).text('Customer note', PAGE_MARGIN, cursor);
      doc.font('Helvetica').fillColor(MUTED).text(order.customer_note, PAGE_MARGIN, cursor + 12, { width: 495 });
    }

    doc.fontSize(8).fillColor(MUTED).text(
      `${this.env.INVOICE_COMPANY_NAME} · ${this.env.INVOICE_COMPANY_REGISTRATION} · ${this.env.INVOICE_COMPANY_EMAIL}`,
      PAGE_MARGIN,
      790,
      { width: 495, align: 'center' },
    );
  }

  private addressLines(address: AddressShape, email: string | null): string[] {
    return [
      address.fullName ?? '',
      address.line1 ?? '',
      address.line2 ?? '',
      [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
      address.country ?? '',
      address.phone ?? '',
      email ?? '',
    ].filter((line) => line.trim().length > 0);
  }
}
