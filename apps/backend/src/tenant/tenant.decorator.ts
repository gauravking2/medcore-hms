import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthContext } from '../auth/auth.service';

export const TenantHospitalId = createParamDecorator((_data: unknown, context: ExecutionContext): string | null => {
  const request = context.switchToHttp().getRequest<{ user?: AuthContext }>();
  return request.user?.hospitalId ?? null;
});

export function resolveHospitalScope(user: AuthContext, requestedHospitalId?: string): string | null {
  if (user.role === 'SUPER_ADMIN') return requestedHospitalId ?? null;
  if (!user.hospitalId) {
    throw new ForbiddenException({ success: false, error: { code: 'NO_HOSPITAL_SCOPE', message: 'Your account is not associated with a hospital.' } });
  }
  if (requestedHospitalId && requestedHospitalId !== user.hospitalId) {
    throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
  }
  return user.hospitalId;
}
