import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthenticatedUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() fullName!: string;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiProperty({ enum: ['ADMIN', 'CUSTOMER'] }) type!: string;
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'] }) status!: string;
  @ApiProperty() isSuperAdmin!: boolean;
  @ApiProperty({ type: [String], example: ['CUSTOMER'] }) roles!: string[];
  @ApiProperty({ type: [String], example: ['product:read'] }) permissions!: string[];
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) lastLoginAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class TokenPairDto {
  @ApiProperty({ description: 'Short-lived RS256 access token' }) accessToken!: string;
  @ApiProperty({ description: 'Opaque rotating refresh token' }) refreshToken!: string;
  @ApiProperty({ example: 600, description: 'Access token lifetime in seconds' }) expiresIn!: number;
  @ApiProperty({ example: 1209600, description: 'Refresh token lifetime in seconds' }) refreshExpiresIn!: number;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
}

export class AuthSessionDto {
  @ApiProperty({ type: AuthenticatedUserDto }) user!: AuthenticatedUserDto;
  @ApiProperty({ type: TokenPairDto }) tokens!: TokenPairDto;
}

export class ForgotPasswordResponseDto {
  @ApiProperty({ example: true }) accepted!: boolean;
  @ApiPropertyOptional({
    description: 'Present only outside production, where no email provider is configured.',
  })
  developmentToken?: string;
}

export class SessionSummaryDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) userAgent!: string | null;
  @ApiPropertyOptional({ nullable: true }) ipAddress!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastUsedAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
  @ApiProperty() current!: boolean;
}
