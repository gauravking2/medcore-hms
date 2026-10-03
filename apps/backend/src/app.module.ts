import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditSharedModule } from './audit/audit-shared.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { BillingModule } from './billing/billing.module';
import { CareModule } from './care/care.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { getEnvironment } from './config/environment';
import { DirectoryModule } from './directory/directory.module';
import { EmrModule } from './emr/emr.module';
import { HealthModule } from './health/health.module';
import { InsightsModule } from './insights/insights.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { StorageModule } from './storage/storage.module';
import {
  AnalyticsModule,
  AppointmentsModule,
  AuditModule,
  DepartmentsModule,
  DoctorsModule,
  HospitalsModule,
  LabModule,
  MedicalRecordsModule,
  PatientsModule,
  PharmacyModule,
  PrescriptionsModule,
  UsersModule,
} from './modules';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

const env = getEnvironment();

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuditSharedModule,
    ThrottlerModule.forRoot([
      {
        ttl: env.AUTH_RATE_LIMIT_WINDOW_MS,
        limit: env.AUTH_RATE_LIMIT_MAX,
      },
    ]),
    HealthModule,
    AuthModule,
    DirectoryModule,
    SchedulingModule,
    StorageModule,
    EmrModule,
    CareModule,
    BillingModule,
    NotificationsModule,
    InsightsModule,
    UsersModule,
    HospitalsModule,
    DepartmentsModule,
    DoctorsModule,
    PatientsModule,
    AppointmentsModule,
    MedicalRecordsModule,
    PrescriptionsModule,
    LabModule,
    PharmacyModule,
    AnalyticsModule,
    AuditModule,
  ],
  providers: [
    // Throttling is applied to the auth surface only (see AuthController).
    // Registering ThrottlerGuard globally made the auth budget
    // (AUTH_RATE_LIMIT_MAX, default 20/min) the limit for EVERY route, so a
    // single dashboard load — which fans out to several resources and polls
    // the unread counter — tripped 429s during normal use.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
