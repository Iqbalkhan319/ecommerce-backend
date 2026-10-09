import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalApiGuard, Public } from '@ecom/platform';
import { UsersService } from '../users/users.service';
import { RbacService } from '../rbac/rbac.service';
import { SessionService } from '../auth/session.service';
import { AssignRolesDto, CreateAdminDto, ListUsersQueryDto, UpdateUserDto, UserIdsDto } from './dto/internal.dto';

@ApiExcludeController()
@Public()
@UseGuards(InternalApiGuard)
@Controller('internal/users')
export class InternalUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly rbac: RbacService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list({
      page: query.page,
      limit: query.limit,
      order: query.order,
      sort: query.sort,
      search: query.search,
      type: query.type,
      status: query.status,
    });
  }

  @Post('batch')
  @HttpCode(200)
  batch(@Body() dto: UserIdsDto) {
    return this.users.findManyByIds(dto.ids);
  }

  @Get('counts')
  counts() {
    return this.users.countByType();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findById(id);
  }

  @Get(':id/authorization')
  authorization(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.resolveAuthorization(id);
  }

  @Post()
  @HttpCode(201)
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.users.createAdmin(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, { fullName: dto.fullName, phone: dto.phone, status: dto.status }, dto.actorId);
  }

  @Post(':id/roles')
  @HttpCode(200)
  async assignRoles(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRolesDto) {
    const roles = await this.rbac.assignRoles(id, dto.roleCodes, dto.actorId);
    return { userId: id, roles };
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  async revokeSessions(@Param('id', ParseUUIDPipe) id: string) {
    const revoked = await this.sessions.revokeAllForUser(id, 'revoked_by_administrator');
    return { userId: id, revokedSessions: revoked };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Query('actorId') actorId?: string) {
    await this.users.softDelete(id, actorId);
    return { deleted: true };
  }
}
