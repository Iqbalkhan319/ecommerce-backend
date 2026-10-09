import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '@ecom/platform';

export enum UserTypeFilter {
  ADMIN = 'ADMIN',
  CUSTOMER = 'CUSTOMER',
}

export enum UserStatusFilter {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserTypeFilter })
  @IsOptional()
  @IsEnum(UserTypeFilter)
  type?: UserTypeFilter;

  @ApiPropertyOptional({ enum: UserStatusFilter })
  @IsOptional()
  @IsEnum(UserStatusFilter)
  status?: UserStatusFilter;

  @ApiPropertyOptional({ enum: ['createdAt', 'email', 'fullName', 'lastLoginAt'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'email', 'fullName', 'lastLoginAt'])
  sort?: 'createdAt' | 'email' | 'fullName' | 'lastLoginAt';
}

export class CreateAdminDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'At least 10 characters with upper case, lower case and a digit' })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiProperty({ type: [String], example: ['MANAGER'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  roleCodes!: string[];

  @ApiPropertyOptional({ description: 'Identifier of the administrator performing the action' })
  @IsOptional()
  @IsUUID()
  actorId?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ enum: UserStatusFilter })
  @IsOptional()
  @IsEnum(UserStatusFilter)
  status?: UserStatusFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;
}

export class AssignRolesDto {
  @ApiProperty({ type: [String], example: ['MANAGER'] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  roleCodes!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;
}

export class CreateRoleDto {
  @ApiProperty({ example: 'FULFILMENT' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/, { message: 'Use upper case letters, digits and underscores' })
  code!: string;

  @ApiProperty({ example: 'Fulfilment team' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @ApiProperty({ type: [String], example: ['order:read', 'order:update'] })
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  permissions!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;
}

export class UserIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  @Type(() => String)
  ids!: string[];
}
