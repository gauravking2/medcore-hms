import { Module } from '@nestjs/common';

// Phase 1 foundation only: each domain module is an extension point, not a feature implementation.
@Module({}) export class AuthModule {}
@Module({}) export class UsersModule {}
@Module({}) export class HospitalsModule {}
@Module({}) export class DepartmentsModule {}
@Module({}) export class DoctorsModule {}
@Module({}) export class PatientsModule {}
@Module({}) export class AppointmentsModule {}
@Module({}) export class MedicalRecordsModule {}
@Module({}) export class PrescriptionsModule {}
@Module({}) export class LabModule {}
@Module({}) export class PharmacyModule {}
@Module({}) export class BillingModule {}
@Module({}) export class NotificationsModule {}
@Module({}) export class AnalyticsModule {}
@Module({}) export class AuditModule {}
