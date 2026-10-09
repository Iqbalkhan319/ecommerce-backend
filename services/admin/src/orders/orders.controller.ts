import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiEnvelope, ApiErrorResponses, ApiStandardErrors, PERMISSIONS, RawResponse } from '@ecom/platform';
import { OrdersService } from './orders.service';
import { InvoicesService } from '../invoices/invoices.service';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentActor } from '../authz/actor.decorator';
import {
  ConfirmOrderDto,
  ListOrdersQueryDto,
  RejectOrderDto,
  UpdateOrderNoteDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';
import { OrderResponseDto } from './order.mapper';
import type { AuditActor } from '../audit/audit.service';

@ApiTags('orders')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.orderRead)
  @ApiOperation({ summary: 'List orders with status, customer, date range and free-text filters' })
  @ApiEnvelope(OrderResponseDto, { paginated: true })
  list(@Query() query: ListOrdersQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.orderRead)
  @ApiOperation({ summary: 'Fetch one order with its items and full status history' })
  @ApiEnvelope(OrderResponseDto)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findById(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.orderConfirm)
  @ApiOperation({
    summary: 'Confirm a pending order',
    description: 'Only a PENDING order can be confirmed. Confirmation issues the invoice record and triggers asynchronous PDF generation.',
  })
  @ApiEnvelope(OrderResponseDto)
  @ApiErrorResponses({ status: 422, description: 'The order is not in a state that can be confirmed' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmOrderDto, @CurrentActor() actor: AuditActor) {
    return this.orders.confirm(id, actor, dto.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.orderReject)
  @ApiOperation({
    summary: 'Reject a pending order',
    description: 'Rejection returns every reserved unit to the catalogue.',
  })
  @ApiEnvelope(OrderResponseDto)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectOrderDto, @CurrentActor() actor: AuditActor) {
    return this.orders.reject(id, dto.reason, actor);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.orderUpdate)
  @ApiOperation({
    summary: 'Move an order to the next lifecycle state',
    description: 'Transitions are validated against the order state machine; invalid moves are rejected.',
  })
  @ApiEnvelope(OrderResponseDto)
  @ApiErrorResponses({ status: 422, description: 'The requested transition is not allowed' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentActor() actor: AuditActor,
  ) {
    return this.orders.updateStatus(id, dto.status, actor, dto.reason);
  }

  @Patch(':id/note')
  @RequirePermissions(PERMISSIONS.orderUpdate)
  @ApiOperation({ summary: 'Record an internal note against an order' })
  @ApiEnvelope(OrderResponseDto)
  updateNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderNoteDto,
    @CurrentActor() actor: AuditActor,
  ) {
    return this.orders.updateInternalNote(id, dto.internalNote, actor);
  }

  @Get(':id/invoice')
  @RawResponse()
  @RequirePermissions(PERMISSIONS.invoiceRead)
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Download the invoice PDF for an order',
    description: 'The file is streamed from a private volume. No filesystem path is ever exposed to the caller.',
  })
  @ApiErrorResponses(
    { status: 404, description: 'No invoice has been issued for this order' },
    { status: 422, description: 'The invoice is still being generated' },
  )
  async downloadInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuditActor,
    @Res({ passthrough: true }) response: Response,
  ) {
    const download = await this.invoices.download(id, { actor });
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${download.filename}"`,
      'Cache-Control': 'private, no-store',
    });
    return download.file;
  }

  @Post(':id/invoice/regenerate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.invoiceRead)
  @ApiOperation({ summary: 'Force a fresh render of the invoice PDF' })
  regenerateInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.generateForOrder(id);
  }
}
