import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthContext } from './auth.service';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  return context.switchToHttp().getRequest<{ user: AuthContext }>().user;
});
