import { Module } from '@nestjs/common';
import { ConsumersService } from './consumers.service';
import { CatalogModule } from '../catalog/catalog.module';

@Module({ imports: [CatalogModule], providers: [ConsumersService] })
export class MessagingModule {}
