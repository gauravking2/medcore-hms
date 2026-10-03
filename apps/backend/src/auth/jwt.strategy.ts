import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthContext } from './auth.service';
import { getEnvironment } from '../config/environment';

interface AccessPayload {
  sub: string;
  role: UserRole;
  hospitalId: string | null;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getEnvironment().JWT_SECRET,
    });
  }

  validate(payload: AccessPayload): AuthContext {
    if (!payload?.sub || !payload?.role || payload.type === 'refresh') {
      throw new Error('Invalid token');
    }
    return { userId: payload.sub, role: payload.role, hospitalId: payload.hospitalId ?? null };
  }
}
