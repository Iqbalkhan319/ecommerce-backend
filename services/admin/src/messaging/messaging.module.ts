import { Module } from '@nestjs/common';
import { ConsumersService } from './consumers.service';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({ imports: [InvoicesModule], providers: [ConsumersService] })
export class MessagingModule {}
