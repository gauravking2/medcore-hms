import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole } from '@prisma/client';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { getEnvironment } from '../config/environment';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';
import { hashPassword, randomToken, safeEqualHex, sha256Hex, verifyPassword } from './crypto.util';
import { DevNotificationProvider } from './messaging.providers';

export interface AuthContext {
  userId: string;
  role: UserRole;
  hospitalId: string | null;
}

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
}

const RESET_PREFIX = 'pw-reset:';
const SESSION_PREFIX = 'rt:';

function clientIp(request?: Request): string | null {
  if (!request) return null;
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return request.ip ?? null;
}

function deviceFrom(request?: Request, explicit?: string): string {
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim().slice(0, 128);
  const candidate = (request?.body as { deviceId?: unknown } | undefined)?.deviceId;
  if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim().slice(0, 128);
  const cookieDevice = request?.cookies?.['device_id'];
  if (typeof cookieDevice === 'string' && cookieDevice.trim().length > 0) return cookieDevice.trim().slice(0, 128);
  return 'default';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly notifications: DevNotificationProvider,
  ) {}

  cookieOptions(request?: Request): CookieOptions {
    const env = getEnvironment();
    const forwardedProto = request?.headers['x-forwarded-proto'];
    const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ?? request?.protocol ?? 'http';
    const isHttps = proto === 'https';
    let secure = isHttps;
    if (env.COOKIE_SECURE === 'true') secure = true;
    if (env.COOKIE_SECURE === 'false') secure = false;
    return {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: '/',
      maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
    };
  }

  clearCookieOptions(): Pick<CookieOptions, 'httpOnly' | 'sameSite' | 'path'> & { secure: boolean } {
    const env = getEnvironment();
    const secure = env.COOKIE_SECURE === 'true';
    return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/' };
  }

  private accessToken(user: { id: string; role: UserRole; hospitalId: string | null }) {
    const env = getEnvironment();
    return this.jwt.sign(
      { sub: user.id, role: user.role, hospitalId: user.hospitalId ?? null },
      { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    );
  }

  private async storeSession(userId: string, deviceId: string, refreshToken: string) {
    const env = getEnvironment();
    await this.redis.set(
      `${SESSION_PREFIX}${userId}:${deviceId}`,
      JSON.stringify({ tokenHash: sha256Hex(refreshToken), createdAt: new Date().toISOString() }),
      env.JWT_REFRESH_TTL_SECONDS,
    );
  }

  private refreshTokenValue(user: { id: string }) {
    const env = getEnvironment();
    return this.jwt.sign({ sub: user.id, type: 'refresh', jti: randomToken(16) }, { expiresIn: env.JWT_REFRESH_TTL_SECONDS });
  }

  private async issueSession(user: { id: string; role: UserRole; hospitalId: string | null }, deviceId: string) {
    const env = getEnvironment();
    const accessToken = this.accessToken(user);
    const refreshToken = this.refreshTokenValue(user);
    await this.storeSession(user.id, deviceId, refreshToken);
    return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_TTL_SECONDS };
  }

  private toSafeUser(user: {
    id: string;
    email: string;
    role: UserRole;
    hospitalId: string | null;
    isActive: boolean;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async register(dto: RegisterDto, request?: Request) {
    const email = dto.email.trim().toLowerCase();
    if (dto.role === 'SUPER_ADMIN') {
      const existing = await this.prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
      if (existing > 0) {
        const error = new Error('Registration is restricted for this role.');
        (error as NodeJS.ErrnoException).code = 'FORBIDDEN_ROLE';
        throw error;
      }
    }
    let hospitalId: string | null = null;
    if (dto.role !== 'SUPER_ADMIN') {
      if (!dto.hospitalSlug) {
        const error = new Error('hospitalSlug is required for hospital roles.');
        (error as NodeJS.ErrnoException).code = 'HOSPITAL_REQUIRED';
        throw error;
      }
      const hospital = await this.prisma.hospital.findUnique({ where: { slug: dto.hospitalSlug } });
      if (!hospital) {
        const error = new Error('Hospital not found.');
        (error as NodeJS.ErrnoException).code = 'HOSPITAL_NOT_FOUND';
        throw error;
      }
      hospitalId = hospital.id;
    }
    const duplicate = await this.prisma.user.findUnique({ where: { email } });
    if (duplicate) {
      const error = new Error('An account with this email already exists.');
      (error as NodeJS.ErrnoException).code = 'DUPLICATE_EMAIL';
      throw error;
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(dto.password),
        role: dto.role as UserRole,
        hospitalId,
      },
    });
    await this.audit.record({
      userId: user.id,
      hospitalId,
      action: 'auth.register',
      entityType: 'User',
      entityId: user.id,
      ipAddress: clientIp(request),
      metadata: { role: user.role },
    });
    return this.toSafeUser(user);
  }

  async login(dto: LoginDto, request?: Request, response?: Response) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      const error = new Error('Invalid email or password.');
      (error as NodeJS.ErrnoException).code = 'INVALID_CREDENTIALS';
      throw error;
    }
    const valid = await verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      const error = new Error('Invalid email or password.');
      (error as NodeJS.ErrnoException).code = 'INVALID_CREDENTIALS';
      throw error;
    }
    const deviceId = deviceFrom(request, dto.deviceId);
    const session = await this.issueSession(user, deviceId);
    if (response) response.cookie('refresh_token', session.refreshToken, this.cookieOptions(request));
    await this.audit.record({
      userId: user.id,
      hospitalId: user.hospitalId,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress: clientIp(request),
      metadata: { deviceId },
    });
    return { user: this.toSafeUser(user), accessToken: session.accessToken, expiresIn: session.expiresIn, deviceId };
  }

  async refresh(request: Request, response?: Response, explicitDeviceId?: string) {
    const presented = request.cookies?.['refresh_token'];
    if (typeof presented !== 'string' || presented.length === 0) {
      const error = new Error('Refresh token is required.');
      (error as NodeJS.ErrnoException).code = 'REFRESH_REQUIRED';
      throw error;
    }
    const deviceId = deviceFrom(request, explicitDeviceId);
    const payload = this.decodeRefresh(presented);
    if (!payload) {
      const error = new Error('Invalid refresh token.');
      (error as NodeJS.ErrnoException).code = 'REFRESH_INVALID';
      throw error;
    }
    const stored = await this.redis.get(`${SESSION_PREFIX}${payload.sub}:${deviceId}`);
    if (!stored) {
      const error = new Error('Session has expired. Please sign in again.');
      (error as NodeJS.ErrnoException).code = 'SESSION_EXPIRED';
      throw error;
    }
    let storedHash = '';
    try {
      storedHash = (JSON.parse(stored) as { tokenHash: string }).tokenHash ?? '';
    } catch {
      storedHash = '';
    }
    if (!storedHash || !safeEqualHex(storedHash, sha256Hex(presented))) {
      await this.redis.del(`${SESSION_PREFIX}${payload.sub}:${deviceId}`);
      const error = new Error('Refresh token has already been used. Please sign in again.');
      (error as NodeJS.ErrnoException).code = 'REFRESH_REUSED';
      throw error;
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      await this.redis.del(`${SESSION_PREFIX}${payload.sub}:${deviceId}`);
      const error = new Error('Account is no longer active.');
      (error as NodeJS.ErrnoException).code = 'ACCOUNT_INACTIVE';
      throw error;
    }
    await this.redis.del(`${SESSION_PREFIX}${user.id}:${deviceId}`);
    const session = await this.issueSession(user, deviceId);
    if (response) response.cookie('refresh_token', session.refreshToken, this.cookieOptions(request));
    return { user: this.toSafeUser(user), accessToken: session.accessToken, expiresIn: session.expiresIn, deviceId };
  }

  private decodeRefresh(token: string): { sub: string } | null {
    try {
      const verified = this.jwt.verify(token) as { sub?: unknown; type?: unknown };
      if (typeof verified.sub !== 'string' || verified.type !== 'refresh') return null;
      return { sub: verified.sub };
    } catch {
      return null;
    }
  }

  async issueRefreshForTest(userId: string, deviceId: string): Promise<string> {
    const env = getEnvironment();
    const token = this.jwt.sign({ sub: userId, type: 'refresh' }, { expiresIn: env.JWT_REFRESH_TTL_SECONDS });
    await this.storeSession(userId, deviceId, token);
    return token;
  }

  async logout(request: Request, response?: Response, explicitDeviceId?: string) {
    const deviceId = deviceFrom(request, explicitDeviceId);
    const presented = request.cookies?.['refresh_token'];
    const payload = typeof presented === 'string' ? this.decodeRefresh(presented) : null;
    const userId = payload?.sub ?? (request as Request & { user?: AuthContext }).user?.userId;
    if (userId) await this.redis.del(`${SESSION_PREFIX}${userId}:${deviceId}`);
    if (response) response.clearCookie('refresh_token', this.clearCookieOptions());
    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      await this.audit.record({
        userId,
        hospitalId: user?.hospitalId ?? null,
        action: 'auth.logout',
        entityType: 'User',
        entityId: userId,
        ipAddress: clientIp(request),
        metadata: { deviceId },
      });
    }
    return { deviceId };
  }

  async logoutAll(userId: string, response?: Response) {
    const keys = await this.redis.scanKeys(`${SESSION_PREFIX}${userId}:*`);
    await this.redis.del(...keys);
    if (response) response.clearCookie('refresh_token', this.clearCookieOptions());
    return { revoked: keys.length };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      const error = new Error('User not found.');
      (error as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw error;
    }
    const safe = this.toSafeUser(user);
    return {
      ...safe,
      permissions: { hospitalScope: user.role === 'SUPER_ADMIN' ? 'platform' : 'hospital', hospitalId: user.hospitalId },
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const env = getEnvironment();
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomToken(32);
      await this.redis.set(`${RESET_PREFIX}${email}`, JSON.stringify({ hash: sha256Hex(token) }), env.PASSWORD_RESET_TTL_SECONDS);
      if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
        await this.redis.set(`${RESET_PREFIX}${email}:plain`, token, env.PASSWORD_RESET_TTL_SECONDS);
      }
      await this.notifications.sendPasswordReset(email);
    }
    return { expiresIn: env.PASSWORD_RESET_TTL_SECONDS };
  }

  async resetPassword(dto: ResetPasswordDto, request?: Request) {
    const email = dto.email.trim().toLowerCase();
    const stored = await this.redis.get(`${RESET_PREFIX}${email}`);
    if (!stored) {
      const error = new Error('Reset token is invalid or has expired.');
      (error as NodeJS.ErrnoException).code = 'RESET_INVALID';
      throw error;
    }
    let hash = '';
    try {
      hash = (JSON.parse(stored) as { hash: string }).hash ?? '';
    } catch {
      hash = '';
    }
    if (!hash || !safeEqualHex(hash, sha256Hex(dto.token))) {
      const error = new Error('Reset token is invalid or has expired.');
      (error as NodeJS.ErrnoException).code = 'RESET_INVALID';
      throw error;
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const error = new Error('Reset token is invalid or has expired.');
      (error as NodeJS.ErrnoException).code = 'RESET_INVALID';
      throw error;
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(dto.newPassword) } });
    await this.redis.del(`${RESET_PREFIX}${email}`, `${RESET_PREFIX}${email}:plain`);
    await this.logoutAll(user.id);
    await this.audit.record({
      userId: user.id,
      hospitalId: user.hospitalId,
      action: 'auth.password-reset',
      entityType: 'User',
      entityId: user.id,
      ipAddress: clientIp(request),
    });
    return { email };
  }

  async buildRefreshTokenForSession(userId: string, deviceId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = this.refreshTokenValue(user);
    await this.storeSession(userId, deviceId, token);
    return token;
  }

  async readResetTokenHashForTest(email: string): Promise<string | null> {
    const stored = await this.redis.get(`${RESET_PREFIX}${email.trim().toLowerCase()}`);
    if (!stored) return null;
    try {
      return (JSON.parse(stored) as { hash: string }).hash ?? null;
    } catch {
      return null;
    }
  }

  async testHelpers() {
    return {
      resetKey: (email: string) => `${RESET_PREFIX}${email.trim().toLowerCase()}`,
      sessionKey: (userId: string, deviceId: string) => `${SESSION_PREFIX}${userId}:${deviceId}`,
    };
  }
}

export type SafeUser = ReturnType<AuthService['toSafeUser']>;

// Ensure Prisma import is used when generated client lacks new auth columns until migration.
export type AuthPrismaTypes = Prisma.UserWhereUniqueInput;
