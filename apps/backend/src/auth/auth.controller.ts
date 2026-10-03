import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthContext, AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
} from './auth.dto';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { ok } from '../common/response';

@ApiTags('auth')
@Controller('auth')
// Rate limiting belongs here: it protects credential endpoints without
// throttling the read-heavy application routes.
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiResponse({ status: 201, description: 'Account created.' })
  async register(@Body() dto: RegisterDto, @Req() request: Request) {
    const user = await this.auth.register(dto, request);
    return ok(user, 'Registration successful.');
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto, request, response);
    return ok({ user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn, deviceId: result.deviceId }, 'Login successful.');
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and issue a new access token' })
  @ApiCookieAuth('refresh_token')
  async refresh(@Body() dto: RefreshDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.refresh(request, response, dto.deviceId);
    return ok({ user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn, deviceId: result.deviceId }, 'Token refreshed.');
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current refresh session and clear the cookie' })
  async logout(@Body() dto: LogoutDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.logout(request, response, dto.deviceId);
    return ok(result, 'Signed out.');
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user profile' })
  async me(@CurrentUser() user: AuthContext) {
    return ok(await this.auth.me(user.userId), 'OK');
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a password reset without revealing account existence' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return ok(await this.auth.forgotPassword(dto), 'If an account exists, a reset was initiated.');
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a password reset with a one-time token' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request) {
    return ok(await this.auth.resetPassword(dto, request), 'Password has been reset.');
  }
}
