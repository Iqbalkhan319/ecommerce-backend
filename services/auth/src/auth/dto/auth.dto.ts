import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const PASSWORD_POLICY =
  'At least 10 characters and must contain an upper case letter, a lower case letter and a digit';

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

export enum LoginScope {
  ADMIN = 'ADMIN',
  CUSTOMER = 'CUSTOMER',
}

export class RegisterDto {
  @ApiProperty({ example: 'ada@example.com' })
  @Transform(normaliseEmail)
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Str0ngPassphrase', description: PASSWORD_POLICY })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY })
  password!: string;

  @ApiProperty({ example: 'Ada Akter' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName!: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ada@example.com' })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Str0ngPassphrase' })
  @IsString()
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    enum: LoginScope,
    default: LoginScope.CUSTOMER,
    description: 'The portal the caller is signing in to. A token is only issued if the account type matches.',
  })
  @IsOptional()
  @IsEnum(LoginScope)
  scope: LoginScope = LoginScope.CUSTOMER;
}

export class RefreshDto {
  @ApiProperty({ description: 'The opaque refresh token returned by login or a previous refresh' })
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Session to revoke. Omit to revoke every session for the account.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ description: PASSWORD_POLICY })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ada@example.com' })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  token!: string;

  @ApiProperty({ description: PASSWORD_POLICY })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY })
  newPassword!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ada Akter' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName?: string;

  @ApiPropertyOptional({ example: '+8801700000000' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}
