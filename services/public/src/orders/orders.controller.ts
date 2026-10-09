import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorResponses,
  ApiStandardErrors,
  AppException,
  CurrentUser,
  IDEMPOTENCY_KEY_HEADER,
  PaginationQueryDto,
  RawResponse,
  RequirePrincipalType,
} from '@ecom/platform';
import { CheckoutService } from '../checkout/checkout.service';
import { CheckoutDto } from '../checkout/dto/checkout.dto';
import { CommerceClient } from '../clients/commerce.client';
import { IdentityService } from '../clients/identity.service';

@ApiTags('orders')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@RequirePrincipalType('CUSTOMER')
@Controller('orders')
export class CustomerOrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly commerce: CommerceClient,
    private readonly identity: IdentityService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Place an order from the current basket',
    description:
      'Totals are calculated by the backend from database prices. An Idempotency-Key header is honoured; when absent, the server derives one from the basket revision so a double-clicked button cannot create two orders.',
  })
  @ApiErrorResponses(
    { status: 409, description: 'The idempotency key was already used for a different basket' },
    { status: 422, description: 'The basket is empty, or a product ran out of stock' },
  )
  async place(
    @CurrentUser('id') customerId: string,
    @Body() dto: CheckoutDto,
    @Res({ passthrough: true }) response: Response,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey?: string,
  ) {
    const identity = await this.identity.resolve(customerId);
    if (identity.status !== 'ACTIVE') {
      throw AppException.forbidden('This account cannot place orders at the moment');
    }
    const result = await this.checkout.checkout(
      { customerId, email: identity.email, fullName: identity.fullName, phone: identity.phone },
      dto,
      idempotencyKey,
    );

    response.status(result.replay ? 200 : 201);
    return result.order;
  }

  @Get()
  @ApiOperation({ summary: 'List the orders belonging to the signed-in customer' })
  list(@CurrentUser('id') customerId: string, @Query() query: PaginationQueryDto) {
    return this.commerce.listOrders(customerId, {
      page: query.page,
      limit: query.limit,
      order: query.order,
      search: query.search,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one of the signed-in customer orders, with its status history' })
  get(@CurrentUser('id') customerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.getOrder(id, customerId);
  }

  @Get(':id/invoice/status')
  @ApiOperation({ summary: 'Check whether the invoice PDF is ready' })
  invoiceStatus(@CurrentUser('id') customerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.invoiceStatus(id, customerId);
  }

  @Get(':id/invoice')
  @RawResponse()
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Download the invoice for one of the signed-in customer orders',
    description: 'The document is streamed through from the commerce service; the storefront never learns a file path.',
  })
  async downloadInvoice(
    @CurrentUser('id') customerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    const identity = await this.identity.resolve(customerId);
    const target = this.commerce.invoiceUrl(id, customerId);
    const upstream = await fetch(target.url, {
      headers: { ...target.headers, 'x-actor-email': identity.email },
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      const body = (await upstream.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new AppException(
        (body?.error?.code as never) ?? 'INVOICE_NOT_FOUND',
        body?.error?.message ?? 'The invoice is not available',
        upstream.status,
      );
    }

    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment; filename="invoice.pdf"',
      'Cache-Control': 'private, no-store',
    });
    response.send(Buffer.from(await upstream.arrayBuffer()));
  }
}
