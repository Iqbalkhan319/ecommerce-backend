import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrorResponses,
  ApiStandardErrors,
  CurrentUser,
  Public,
  RawResponse,
  type Principal,
} from '@ecom/platform';
import { AUTH_THROTTLE } from './throttle.config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokenService } from '../crypto/token.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import {
  AuthSessionDto,
  AuthenticatedUserDto,
  ForgotPasswordResponseDto,
  SessionSummaryDto,
} from './dto/auth-response.dto';

@ApiTags('authentication')
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(201)
  @Throttle(AUTH_THROTTLE.register)
  @ApiOperation({ summary: 'Register a customer account and start a session' })
  @ApiEnvelope(AuthSessionDto, { status: 201, description: 'Account created and signed in' })
  @ApiErrorResponses(
    { status: 409, description: 'The email address is already registered' },
    { status: 422, description: 'The submitted details failed validation' },
  )
  register(@Body() dto: RegisterDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.register(dto, { ipAddress: ip, userAgent });
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE.login)
  @ApiOperation({ summary: 'Exchange credentials for an access and refresh token pair' })
  @ApiEnvelope(AuthSessionDto, { description: 'Authenticated' })
  @ApiErrorResponses(
    { status: 401, description: 'Email address or password is incorrect' },
    { status: 403, description: 'The account is locked, suspended, or not valid for this portal' },
  )
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.login(dto, { ipAddress: ip, userAgent });
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE.refresh)
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Refresh tokens are single use. Presenting a token that was already exchanged revokes every session created from that login.',
  })
  @ApiEnvelope(AuthSessionDto, { description: 'A new token pair' })
  @ApiErrorResponses({ status: 401, description: 'The refresh token is unknown, expired, or already used' })
  refresh(@Body() dto: RefreshDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.refresh(dto.refreshToken, { ipAddress: ip, userAgent });
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session, or every session when no token is supplied' })
  @ApiStandardErrors()
  logout(@CurrentUser() principal: Principal, @Body() dto: LogoutDto) {
    return this.auth.logout(principal.id, dto.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the authenticated account with its roles and effective permissions' })
  @ApiEnvelope(AuthenticatedUserDto)
  @ApiStandardErrors()
  me(@CurrentUser() principal: Principal) {
    return this.auth.profile(principal.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the authenticated account profile' })
  @ApiEnvelope(AuthenticatedUserDto)
  @ApiStandardErrors()
  async updateMe(@CurrentUser() principal: Principal, @Body() dto: UpdateProfileDto) {
    await this.users.updateProfile(principal.id, dto);
    return this.auth.profile(principal.id);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List the active sessions for the authenticated account' })
  @ApiEnvelope(SessionSummaryDto, { isArray: true })
  @ApiStandardErrors()
  sessions(@CurrentUser() principal: Principal) {
    return this.auth.listSessions(principal.id, principal.sessionId);
  }

  @Delete('sessions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke every session for the authenticated account' })
  @ApiStandardErrors()
  revokeSessions(@CurrentUser() principal: Principal) {
    return this.auth.logout(principal.id);
  }

  @Post('password/change')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE.password)
  @ApiOperation({
    summary: 'Change the password of the authenticated account',
    description: 'Every session is revoked afterwards, so the caller must sign in again.',
  })
  @ApiStandardErrors()
  changePassword(@CurrentUser() principal: Principal, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(principal.id, dto);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  @Throttle(AUTH_THROTTLE.forgotPassword)
  @ApiOperation({
    summary: 'Request a password reset token',
    description:
      'The response is identical whether or not the address is registered. No email provider is configured in this build, so the token is returned only outside production.',
  })
  @ApiEnvelope(ForgotPasswordResponseDto, { status: 202 })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('password/reset')
  @Public()
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE.password)
  @ApiOperation({ summary: 'Complete a password reset and revoke all existing sessions' })
  @ApiErrorResponses({ status: 400, description: 'The reset token is invalid, used, or expired' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { reset: true };
  }

  @Get('.well-known/jwks.json')
  @Public()
  @RawResponse()
  @ApiOperation({
    summary: 'Public JSON Web Key Set',
    description: 'Consumed by gateways and services that verify access tokens. The private key never leaves this service.',
  })
  jwks() {
    return this.tokens.jwks();
  }

  @Get('verify')
  @ApiOperation({
    summary: 'Echo the verified principal',
    description: 'Useful for gateway and integration diagnostics; the token is verified by this service, not trusted from the gateway.',
  })
  @ApiStandardErrors()
  verify(@CurrentUser() principal: Principal, @Query('detail') detail?: string) {
    if (detail === 'full') return this.auth.profile(principal.id);
    return { valid: true, principal };
  }
}
