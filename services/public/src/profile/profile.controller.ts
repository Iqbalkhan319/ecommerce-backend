import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors, CurrentUser, RequirePrincipalType } from '@ecom/platform';
import { ProfileService } from './profile.service';
import { IdentityService } from '../clients/identity.service';
import { UpdateProfileDto, UpsertAddressDto } from './dto/profile.dto';

@ApiTags('account')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@RequirePrincipalType('CUSTOMER')
@Controller('me')
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read the signed-in customer account and saved addresses' })
  async get(@CurrentUser('id') customerId: string) {
    const identity = await this.identity.resolve(customerId);
    return this.profile.get(identity);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update the customer profile',
    description: 'Name and phone are kept in step with the auth service, which owns the identity record.',
  })
  async update(@CurrentUser('id') customerId: string, @Body() dto: UpdateProfileDto) {
    const identity = await this.identity.resolve(customerId);
    if (dto.fullName !== undefined || dto.phone !== undefined) {
      await this.identity.updateName(customerId, { fullName: dto.fullName, phone: dto.phone });
      await this.identity.invalidate(customerId);
    }
    return this.profile.update({ ...identity, ...(dto.fullName ? { fullName: dto.fullName } : {}) }, dto);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'List saved delivery addresses' })
  async addresses(@CurrentUser('id') customerId: string) {
    return this.profile.listAddresses(await this.identity.resolve(customerId));
  }

  @Post('addresses')
  @HttpCode(201)
  @ApiOperation({ summary: 'Save a delivery address' })
  async addAddress(@CurrentUser('id') customerId: string, @Body() dto: UpsertAddressDto) {
    return this.profile.addAddress(await this.identity.resolve(customerId), dto);
  }

  @Put('addresses/:id')
  @ApiOperation({ summary: 'Replace a saved address' })
  async updateAddress(
    @CurrentUser('id') customerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertAddressDto,
  ) {
    return this.profile.updateAddress(await this.identity.resolve(customerId), id, dto);
  }

  @Delete('addresses/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a saved address' })
  async removeAddress(@CurrentUser('id') customerId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.profile.removeAddress(await this.identity.resolve(customerId), id);
    return { deleted: true };
  }
}
