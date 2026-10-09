import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalApiGuard, Public } from '@ecom/platform';
import { RbacService } from '../rbac/rbac.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/internal.dto';

@ApiExcludeController()
@Public()
@UseGuards(InternalApiGuard)
@Controller('internal/rbac')
export class InternalRbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('roles')
  listRoles() {
    return this.rbac.listRoles();
  }

  @Get('roles/:id')
  getRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.getRole(id);
  }

  @Post('roles')
  @HttpCode(201)
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbac.createRole(dto);
  }

  @Patch('roles/:id')
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.rbac.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @HttpCode(200)
  async deleteRole(@Param('id', ParseUUIDPipe) id: string) {
    await this.rbac.deleteRole(id);
    return { deleted: true };
  }

  @Get('permissions')
  listPermissions() {
    return this.rbac.listPermissions();
  }
}
