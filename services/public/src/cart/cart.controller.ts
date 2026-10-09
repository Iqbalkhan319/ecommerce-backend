import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiStandardErrors, CurrentUser, RequirePrincipalType, type Principal } from '@ecom/platform';
import { CartService } from './cart.service';
import { AddCartItemDto, CartDto, UpdateCartItemDto } from './dto/cart.dto';

@ApiTags('basket')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@RequirePrincipalType('CUSTOMER')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the signed-in customer basket',
    description: 'Line prices are indicative. The order is priced again by the server when it is placed.',
  })
  @ApiEnvelope(CartDto)
  get(@CurrentUser('id') customerId: string) {
    return this.cart.get(customerId);
  }

  @Post('items')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add a product to the basket, or increase its quantity' })
  @ApiEnvelope(CartDto)
  addItem(@CurrentUser('id') customerId: string, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(customerId, dto.productId, dto.quantity);
  }

  @Patch('items/:productId')
  @ApiOperation({ summary: 'Set the quantity of a basket line; zero removes it' })
  @ApiEnvelope(CartDto)
  updateItem(
    @CurrentUser('id') customerId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(customerId, productId, dto.quantity);
  }

  @Delete('items/:productId')
  @ApiOperation({ summary: 'Remove a line from the basket' })
  @ApiEnvelope(CartDto)
  removeItem(@CurrentUser('id') customerId: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.cart.removeItem(customerId, productId);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the basket' })
  @ApiEnvelope(CartDto)
  clear(@CurrentUser('id') customerId: string) {
    return this.cart.clear(customerId);
  }

  @Get('principal')
  @ApiOperation({ summary: 'Echo the verified principal, for diagnostics' })
  principal(@CurrentUser() principal: Principal) {
    return { id: principal.id, type: principal.type, sessionId: principal.sessionId };
  }
}
