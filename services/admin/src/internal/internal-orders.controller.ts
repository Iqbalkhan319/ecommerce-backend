import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { InternalApiGuard, Public, RawResponse } from '@ecom/platform';
import { OrderPlacementService } from '../orders/order-placement.service';
import { OrdersService } from '../orders/orders.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ListOrdersQueryDto, PlaceOrderInternalDto } from '../orders/dto/order.dto';

@ApiExcludeController()
@Public()
@UseGuards(InternalApiGuard)
@Controller('internal/orders')
export class InternalOrdersController {
  constructor(
    private readonly placement: OrderPlacementService,
    private readonly orders: OrdersService,
    private readonly invoices: InvoicesService,
  ) {}

  @Post()
  @HttpCode(201)
  async place(@Body() dto: PlaceOrderInternalDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.placement.place(dto);

    if (result.idempotentReplay) response.status(200);
    return result.order;
  }

  @Get('by-idempotency-key/:key')
  byIdempotencyKey(@Param('key') key: string, @Query('customerId', ParseUUIDPipe) customerId: string) {
    return this.placement.findByIdempotencyKey(key, customerId);
  }

  @Get()
  list(@Query('customerId', ParseUUIDPipe) customerId: string, @Query() query: ListOrdersQueryDto) {
    return this.orders.listForCustomer(customerId, query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Query('customerId', ParseUUIDPipe) customerId: string) {
    return this.orders.findByIdForCustomer(id, customerId);
  }

  @Get(':id/invoice/status')
  invoiceStatus(@Param('id', ParseUUIDPipe) id: string, @Query('customerId', ParseUUIDPipe) customerId: string) {
    return this.invoices.statusForOrder(id, customerId);
  }

  @Get(':id/invoice')
  @RawResponse()
  async downloadInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('customerId', ParseUUIDPipe) customerId: string,
    @Res({ passthrough: true }) response: Response,
    @Headers('x-actor-email') actorEmail?: string,
  ) {
    const download = await this.invoices.download(id, {
      customerId,
      actor: { id: customerId, email: actorEmail ?? null, type: 'CUSTOMER' },
    });
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${download.filename}"`,
      'Cache-Control': 'private, no-store',
    });
    return download.file;
  }
}
