import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors, AppException, ErrorCode, PERMISSIONS } from '@ecom/platform';
import { AuthClient } from '../clients/auth.client';
import { AuthorizationService } from '../authz/authorization.service';
import { AUDIT_ACTIONS, AuditService, type AuditActor } from '../audit/audit.service';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentActor } from '../authz/actor.decorator';
import { AssignRolesDto, CreateAdminDto, ListAdminsQueryDto, UpdateAdminDto } from './dto/admin.dto';

@ApiTags('administrators')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('admins')
export class AdminsController {
  constructor(
    private readonly authClient: AuthClient,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.adminRead)
  @ApiOperation({ summary: 'List administrator accounts' })
  list(@Query() query: ListAdminsQueryDto) {
    return this.authClient.listUsers({
      page: query.page,
      limit: query.limit,
      order: query.order,
      search: query.search,
      type: 'ADMIN',
      status: query.status,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.adminRead)
  @ApiOperation({ summary: 'Fetch one administrator with their effective permissions' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const [user, authorization] = await Promise.all([
      this.authClient.getUser(id),
      this.authClient.getAuthorization(id),
    ]);
    if (user.type !== 'ADMIN') throw AppException.notFound('Administrator not found');
    return { ...user, permissions: authorization.permissions };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.adminCreate)
  @ApiOperation({
    summary: 'Create an administrator',
    description: 'The super administrator role can never be granted through this endpoint.',
  })
  async create(@Body() dto: CreateAdminDto, @CurrentActor() actor: AuditActor) {
    const created = await this.authClient.createAdmin({ ...dto, actorId: actor.id! });
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.adminCreated,
      resource: 'admin',
      resourceId: created.id,
      metadata: { email: created.email, roles: dto.roleCodes },
    });
    return created;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.adminUpdate)
  @ApiOperation({ summary: 'Update an administrator profile or account status' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDto,
    @CurrentActor() actor: AuditActor,
  ) {
    const updated = await this.authClient.updateUser(id, { ...dto, actorId: actor.id! });
    await this.authorization.invalidate(id);
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.adminUpdated,
      resource: 'admin',
      resourceId: id,
      metadata: { changes: Object.keys(dto), email: updated.email },
    });
    return updated;
  }

  @Post(':id/roles')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.adminUpdate)
  @ApiOperation({
    summary: 'Replace the roles assigned to an administrator',
    description: 'The cached authorisation for that account is invalidated immediately, so a removed permission stops working at once.',
  })
  async assignRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRolesDto,
    @CurrentActor() actor: AuditActor,
  ) {
    if (id === actor.id) {
      throw AppException.forbidden('You cannot change your own roles', ErrorCode.FORBIDDEN);
    }
    const result = await this.authClient.assignRoles(id, dto.roleCodes, actor.id!);
    await this.authorization.invalidate(id);
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.adminRolesChanged,
      resource: 'admin',
      resourceId: id,
      metadata: { roles: result.roles },
    });
    return result;
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.adminUpdate)
  @ApiOperation({ summary: 'Sign an administrator out of every device' })
  async revokeSessions(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: AuditActor) {
    const result = await this.authClient.revokeSessions(id);
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.adminSessionsRevoked,
      resource: 'admin',
      resourceId: id,
      metadata: { revokedSessions: result.revokedSessions },
    });
    return result;
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.adminDelete)
  @ApiOperation({
    summary: 'Deactivate an administrator',
    description: 'The protected super administrator account cannot be deactivated, and an administrator cannot deactivate themselves.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: AuditActor) {
    const user = await this.authClient.getUser(id);
    await this.authClient.deleteUser(id, actor.id!);
    await this.authorization.invalidate(id);
    await this.audit.record({
      actor,
      action: AUDIT_ACTIONS.adminDeleted,
      resource: 'admin',
      resourceId: id,
      metadata: { email: user.email },
    });
    return { deactivated: true };
  }
}
