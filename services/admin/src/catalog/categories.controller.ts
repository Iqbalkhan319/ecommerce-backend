import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiStandardErrors, PERMISSIONS } from '@ecom/platform';
import { CategoriesService } from './categories.service';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentActor } from '../authz/actor.decorator';
import { CategoryResponseDto, CreateCategoryDto, ListCategoriesQueryDto, UpdateCategoryDto } from './dto/category.dto';
import type { AuditActor } from '../audit/audit.service';

@ApiTags('categories')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.categoryRead)
  @ApiOperation({ summary: 'List categories with product counts' })
  @ApiEnvelope(CategoryResponseDto, { paginated: true })
  list(@Query() query: ListCategoriesQueryDto) {
    return this.categories.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.categoryRead)
  @ApiOperation({ summary: 'Fetch one category' })
  @ApiEnvelope(CategoryResponseDto)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.findById(id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.categoryCreate)
  @ApiOperation({ summary: 'Create a category' })
  @ApiEnvelope(CategoryResponseDto, { status: 201 })
  create(@Body() dto: CreateCategoryDto, @CurrentActor() actor: AuditActor) {
    return this.categories.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.categoryUpdate)
  @ApiOperation({ summary: 'Update a category' })
  @ApiEnvelope(CategoryResponseDto)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @CurrentActor() actor: AuditActor) {
    return this.categories.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.categoryDelete)
  @ApiOperation({ summary: 'Delete an empty category' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: AuditActor) {
    await this.categories.remove(id, actor);
    return { deleted: true };
  }
}
