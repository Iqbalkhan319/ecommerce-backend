import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors, PERMISSIONS } from '@ecom/platform';
import { AuthClient } from '../clients/auth.client';
import { AuthorizationService } from '../authz/authorization.service';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentActor } from '../authz/actor.decorator';
import { CreateRoleDto, UpdateRoleDto } from './dto/admin.dto';

@ApiTags('roles and permissions')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller()
export class RolesController {
  constructor(
    private readonly authClient: AuthClient,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  @Get('roles')
  @RequirePermissions(PERMISSIONS.roleRead)
  @ApiOperation({ summary: 'List roles with their permissions and assignment counts' })
  listRoles() {
    return this.authClient.listRoles();
  }

  @Get('roles/:id')
  @RequirePermissions(PERMISSIONS.roleRead)
  @ApiOperation({ summary: 'Fetch one role' })
  getRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.authClient.getRole(id);
  }

  @Post('roles')
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.roleCreate)
  @ApiOperation({ summary: 'Create a role' })
  async createRole(@Body() dto: CreateRoleDto, @CurrentActor() actor: AuditActor) {
    const role = await this.authClient.createRole({ ...dto, actorId: actor.id! });
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.roleCreated,
      resource: 'role',
      resourceId: role.id,
      metadata: { code: role.code, permissions: dto.permissions },
    });
    return role;
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.roleUpdate)
  @ApiOperation({
    summary: 'Update a role',
    description: 'Changing a role invalidates every cached authorisation, so revoked permissions stop applying immediately.',
  })
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentActor() actor: AuditActor,
  ) {
    const role = await this.authClient.updateRole(id, { ...dto, actorId: actor.id! });
    await this.authorization.invalidateAll();
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.roleUpdated,
      resource: 'role',
      resourceId: id,
      metadata: { code: role.code, changes: Object.keys(dto) },
    });
    return role;
  }

  @Delete('roles/:id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.roleDelete)
  @ApiOperation({ summary: 'Delete a role that is not assigned to anyone' })
  async deleteRole(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: AuditActor) {
    const role = await this.authClient.getRole(id);
    await this.authClient.deleteRole(id);
    await this.authorization.invalidateAll();
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.roleDeleted,
      resource: 'role',
      resourceId: id,
      metadata: { code: role.code },
    });
    return { deleted: true };
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.permissionRead)
  @ApiOperation({ summary: 'List the permission catalogue' })
  listPermissions() {
    return this.authClient.listPermissions();
  }
}
