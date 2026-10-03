import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    try {
      return (await super.canActivate(context)) as boolean;
    } catch {
      throw new UnauthorizedException({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
  }

  handleRequest<TUser = unknown>(error: unknown, user: unknown): TUser {
    if (error || !user) {
      throw new UnauthorizedException({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
    return user as TUser;
  }
}
