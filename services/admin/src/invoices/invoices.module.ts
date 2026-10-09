import { Module } from '@nestjs/common';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@Module({
  providers: [InvoicePdfService, InvoicesService],
  exports: [InvoicesService, InvoicePdfService],
})
export class InvoicesModule {}
