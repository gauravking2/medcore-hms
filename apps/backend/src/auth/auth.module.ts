import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getEnvironment } from '../config/environment';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { Phase3ProbeController } from './phase3-probe.controller';
import { DevNotificationProvider } from './messaging.providers';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: getEnvironment().JWT_SECRET,
      signOptions: { expiresIn: getEnvironment().JWT_ACCESS_TTL_SECONDS },
    }),
  ],
  // The probe controller exists only to assert guard behaviour in the
  // integration suite. Registering it outside tests published `__phase3-probes`
  // routes in the live API and in Swagger, so it is test-only on purpose.
  controllers: [
    AuthController,
    ...(process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined ? [Phase3ProbeController] : []),
  ],
  providers: [AuthService, JwtStrategy, DevNotificationProvider],
  exports: [AuthService],
})
export class AuthModule {}
