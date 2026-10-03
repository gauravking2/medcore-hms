import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { resolveHospitalScope } from '../tenant/tenant.decorator';
import { assertValidTransition, isSlotOccupying } from './appointment-lifecycle';
import { CreateAppointmentDto, CreateAvailabilityDto, UpdateAvailabilityDto } from './scheduling.dto';
import { ReminderQueue } from './reminder.queue';
import { addMinutes, endOfDay, startOfDay, toMinutes, toTime, weekdayOf } from './time.util';

const SLOT_CACHE_TTL_SECONDS = 30;

function slotConflictCode(error: unknown): boolean {
  const message = (error as Error)?.message ?? '';
  return message.includes('SLOT_UNAVAILABLE') || (error as { code?: string })?.code === 'P2034';
}

function throwSlotUnavailable(): never {
  throw new ConflictException({ success: false, error: { code: 'SLOT_UNAVAILABLE', message: 'This slot was just booked by another patient.' } });
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly reminders: ReminderQueue,
    private readonly notifications: NotificationsService,
  ) {}

  private assertSameHospital(user: AuthContext, hospitalId: string) {
    const scope = resolveHospitalScope(user, hospitalId);
    if (scope !== hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
    }
  }

  private async doctorInScope(doctorId: string, hospitalId: string) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.deletedAt || doctor.hospitalId !== hospitalId) {
      throw new NotFoundException({ success: false, error: { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found in this hospital.' } });
    }
    return doctor;
  }

  private slotsCacheKey(doctorId: string, date: string): string {
    return `slots:${doctorId}:${date}`;
  }

  private async invalidateSlots(doctorId: string, startsAt: Date): Promise<void> {
    const day = startsAt.toISOString().slice(0, 10);
    await this.redis.del(this.slotsCacheKey(doctorId, day)).catch(() => undefined);
  }

  async createAvailability(doctorId: string, dto: CreateAvailabilityDto, user: AuthContext, ip?: string | null) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' } });
    }
    if (user.role === 'DOCTOR') {
      const own = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== doctorId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Doctors may only manage their own availability.' } });
      }
    } else {
      this.assertSameHospital(user, doctor.hospitalId);
    }
    const start = toMinutes(dto.startsAt);
    const end = toMinutes(dto.endsAt);
    if (!(end > start)) {
      throw new ConflictException({ success: false, error: { code: 'INVALID_SCHEDULE', message: 'End time must be after start time.' } });
    }
    const slotMinutes = dto.slotMinutes ?? 30;
    if (slotMinutes < 5 || slotMinutes > 480 || (end - start) % slotMinutes !== 0 && (end - start) < slotMinutes) {
      throw new ConflictException({ success: false, error: { code: 'INVALID_SCHEDULE', message: 'Slot duration is not sensible for this window.' } });
    }
    const existing = await this.prisma.doctorAvailability.findMany({ where: { doctorId, weekday: dto.weekday, isActive: true } });
    for (const row of existing) {
      const rowStart = toMinutes(row.startsAt);
      const rowEnd = toMinutes(row.endsAt);
      if (start < rowEnd && rowStart < end) {
        throw new ConflictException({ success: false, error: { code: 'SCHEDULE_OVERLAP', message: 'This schedule overlaps an existing availability window.' } });
      }
    }
    const created = await this.prisma.doctorAvailability.create({
      data: {
        hospitalId: doctor.hospitalId,
        doctorId,
        weekday: dto.weekday,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        slotMinutes,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveUntil: dto.effectiveUntil ? new Date(dto.effectiveUntil) : null,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.record({ userId: user.userId, hospitalId: doctor.hospitalId, action: 'availability.create', entityType: 'DoctorAvailability', entityId: created.id, ipAddress: ip ?? null });
    return created;
  }

  async listAvailability(doctorId: string, user: AuthContext) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' } });
    }
    this.assertSameHospital(user, doctor.hospitalId);
    return this.prisma.doctorAvailability.findMany({ where: { doctorId }, orderBy: [{ weekday: 'asc' }, { startsAt: 'asc' }] });
  }

  async updateAvailability(doctorId: string, id: string, dto: UpdateAvailabilityDto, user: AuthContext, ip?: string | null) {
    const row = await this.prisma.doctorAvailability.findUnique({ where: { id } });
    if (!row || row.doctorId !== doctorId) {
      throw new NotFoundException({ success: false, error: { code: 'AVAILABILITY_NOT_FOUND', message: 'Availability not found.' } });
    }
    if (user.role === 'DOCTOR') {
      const own = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== doctorId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Doctors may only manage their own availability.' } });
      }
    } else {
      this.assertSameHospital(user, row.hospitalId);
    }
    const startsAt = dto.startsAt ?? row.startsAt;
    const endsAt = dto.endsAt ?? row.endsAt;
    if (!(toMinutes(endsAt) > toMinutes(startsAt))) {
      throw new ConflictException({ success: false, error: { code: 'INVALID_SCHEDULE', message: 'End time must be after start time.' } });
    }
    const updated = await this.prisma.doctorAvailability.update({
      where: { id },
      data: {
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        slotMinutes: dto.slotMinutes,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveUntil: dto.effectiveUntil ? new Date(dto.effectiveUntil) : undefined,
        isActive: dto.isActive,
      },
    });
    await this.invalidateSlots(doctorId, new Date());
    for (let offset = 0; offset < 14; offset += 1) {
      const day = new Date();
      day.setDate(day.getDate() + offset);
      await this.redis.del(this.slotsCacheKey(doctorId, day.toISOString().slice(0, 10))).catch(() => undefined);
    }
    await this.audit.record({ userId: user.userId, hospitalId: row.hospitalId, action: 'availability.update', entityType: 'DoctorAvailability', entityId: id, ipAddress: ip ?? null });
    return updated;
  }

  async disableAvailability(doctorId: string, id: string, user: AuthContext, ip?: string | null) {
    return this.updateAvailability(doctorId, id, { isActive: false }, user, ip);
  }

  async availableSlots(doctorId: string, date: string, user: AuthContext) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' } });
    }
    this.assertSameHospital(user, doctor.hospitalId);
    const day = new Date(`${date}T00:00:00`);
    if (Number.isNaN(day.getTime())) {
      throw new ConflictException({ success: false, error: { code: 'INVALID_DATE', message: 'Date must be YYYY-MM-DD.' } });
    }
    const cacheKey = this.slotsCacheKey(doctorId, date);
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as { slots: Array<{ startsAt: string; endsAt: string }> };
      } catch {
        // fall through to regeneration
      }
    }
    const weekday = weekdayOf(day);
    const windows = await this.prisma.doctorAvailability.findMany({ where: { doctorId, weekday, isActive: true } });
    const activeWindows = windows.filter((window) => {
      if (window.effectiveFrom && day < startOfDay(window.effectiveFrom)) return false;
      if (window.effectiveUntil && day > endOfDay(window.effectiveUntil)) return false;
      return true;
    });
    const appointments = await this.prisma.appointment.findMany({
      where: { doctorId, deletedAt: null, startsAt: { gte: startOfDay(day) }, endsAt: { lte: endOfDay(day) } },
    });
    const occupying = appointments.filter((appointment) => isSlotOccupying(appointment.status));
    const now = new Date();
    const sameDay = day.toDateString() === now.toDateString();
    const slots: Array<{ startsAt: string; endsAt: string }> = [];
    for (const window of activeWindows) {
      let cursor = toMinutes(window.startsAt);
      const end = toMinutes(window.endsAt);
      while (cursor + window.slotMinutes <= end) {
        const slotStart = new Date(day);
        slotStart.setHours(Math.floor(cursor / 60), cursor % 60, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + window.slotMinutes * 60_000);
        const overlaps = occupying.some((appointment) => slotStart < appointment.endsAt && appointment.startsAt < slotEnd);
        if (!overlaps && (!sameDay || slotStart.getTime() > now.getTime())) {
          slots.push({ startsAt: slotStart.toISOString(), endsAt: slotEnd.toISOString() });
        }
        cursor += window.slotMinutes;
      }
    }
    const result = { slots };
    await this.redis.set(cacheKey, JSON.stringify(result), SLOT_CACHE_TTL_SECONDS).catch(() => undefined);
    return result;
  }

  private async fitsAvailability(doctorId: string, startsAt: Date, endsAt: Date): Promise<boolean> {
    const weekday = weekdayOf(startsAt);
    const windows = await this.prisma.doctorAvailability.findMany({ where: { doctorId, weekday, isActive: true } });
    const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
    const endMinutes = endsAt.getHours() * 60 + endsAt.getMinutes();
    const sameCalendarDay = startsAt.toDateString() === endsAt.toDateString();
    if (!sameCalendarDay) return false;
    return windows.some((window) => {
      if (window.effectiveFrom && startsAt < startOfDay(window.effectiveFrom)) return false;
      if (window.effectiveUntil && startsAt > endOfDay(window.effectiveUntil)) return false;
      return toMinutes(window.startsAt) <= startMinutes && endMinutes <= toMinutes(window.endsAt);
    });
  }

  async createAppointment(dto: CreateAppointmentDto, user: AuthContext, ip?: string | null) {
    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new ConflictException({ success: false, error: { code: 'INVALID_DATETIME', message: 'Scheduled start is invalid.' } });
    }
    let endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.endsAt && endsAt && Number.isNaN(endsAt.getTime())) {
      throw new ConflictException({ success: false, error: { code: 'INVALID_DATETIME', message: 'Scheduled end is invalid.' } });
    }
    if (!endsAt) {
      endsAt = addMinutes(startsAt, dto.durationMinutes ?? 30);
    }
    if (!(endsAt.getTime() > startsAt.getTime())) {
      throw new ConflictException({ success: false, error: { code: 'INVALID_DATETIME', message: 'End must be after start.' } });
    }
    if (!dto.isEmergency && startsAt.getTime() <= Date.now()) {
      throw new ConflictException({ success: false, error: { code: 'INVALID_DATETIME', message: 'Appointments must be scheduled in the future.' } });
    }

    const doctor = await this.prisma.doctor.findUnique({ where: { id: dto.doctorId } });
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId } });
    const department = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
    if (!doctor || doctor.deletedAt) throw new NotFoundException({ success: false, error: { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found.' } });
    if (!patient || patient.deletedAt) throw new NotFoundException({ success: false, error: { code: 'PATIENT_NOT_FOUND', message: 'Patient not found.' } });
    if (!department) throw new NotFoundException({ success: false, error: { code: 'DEPARTMENT_NOT_FOUND', message: 'Department not found.' } });

    // Tenant scope is resolved server-side. Non-admin roles are pinned to their
    // own hospital; SUPER_ADMIN may book in any hospital but all three entities
    // must still belong to the SAME hospital.
    const expectedHospital = user.role === 'SUPER_ADMIN' ? doctor.hospitalId : resolveHospitalScope(user, doctor.hospitalId);
    if (patient.hospitalId !== expectedHospital || department.hospitalId !== expectedHospital || doctor.hospitalId !== expectedHospital) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Patient, doctor, and department must belong to the same hospital.' } });
    }

    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== patient.id) {
        throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Patients may only book their own appointments.' } });
      }
    } else if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to book appointments.' } });
    }

    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
      if (!room || room.hospitalId !== expectedHospital) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Room does not belong to this hospital.' } });
      }
    }

    const isEmergency = dto.isEmergency === true;
    if (!isEmergency) {
      const fits = await this.fitsAvailability(dto.doctorId, startsAt, endsAt);
      if (!fits) {
        throw new ConflictException({ success: false, error: { code: 'OUTSIDE_AVAILABILITY', message: 'Requested time is outside the doctor availability.' } });
      }
    }
    // EMERGENCY DECISION (documented): emergency bookings bypass the weekly
    // availability grid but NEVER bypass tenant checks, permission checks, or
    // the overlap guard below. An emergency that overlaps an ACTIVE normal
    // appointment still fails with SLOT_UNAVAILABLE — the caller must cancel or
    // reschedule first. This keeps the database the source of truth and avoids
    // silently hiding collisions.

    // Concurrency protection: serialize writers for this doctor+slot with a
    // Postgres advisory transaction lock, then re-check overlap inside the
    // SAME transaction before inserting. The lock key is derived from the
    // doctor and the exact slot so unrelated bookings proceed in parallel.
    const lockKey = `appt:${dto.doctorId}:${startsAt.toISOString()}:${endsAt.toISOString()}`;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        const overlapping = await tx.appointment.findFirst({
          where: {
            doctorId: dto.doctorId,
            deletedAt: null,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            startsAt: { lt: endsAt as Date },
            endsAt: { gt: startsAt },
          },
        });
        if (overlapping) throwSlotUnavailable();
        const patientOverlap = await tx.appointment.findFirst({
          where: {
            patientId: dto.patientId,
            deletedAt: null,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            startsAt: { lt: endsAt as Date },
            endsAt: { gt: startsAt },
          },
        });
        if (patientOverlap) {
          throw new ConflictException({ success: false, error: { code: 'PATIENT_DOUBLE_BOOKED', message: 'Patient already has an appointment at this time.' } });
        }
        return tx.appointment.create({
          data: {
            hospitalId: expectedHospital as string,
            patientId: dto.patientId,
            doctorId: dto.doctorId,
            departmentId: dto.departmentId,
            roomId: dto.roomId,
            startsAt,
            endsAt: endsAt as Date,
            status: 'PENDING',
            isEmergency,
            reason: dto.reason,
          },
          include: { patient: true, doctor: { include: { user: true } }, department: true },
        });
      }, { isolationLevel: 'Serializable' });
      await this.invalidateSlots(dto.doctorId, startsAt);
      await this.reminders.scheduleFor(created.id, created.hospitalId, created.startsAt).catch(() => undefined);
      await this.audit.record({ userId: user.userId, hospitalId: created.hospitalId, action: 'appointment.create', entityType: 'Appointment', entityId: created.id, ipAddress: ip ?? null, metadata: { isEmergency } });
      if (isEmergency) {
        await this.notifications.emit({
          hospitalId: created.hospitalId,
          type: 'EMERGENCY_APPOINTMENT',
          title: 'Emergency appointment created',
          body: `Emergency appointment ${created.id.slice(0, 8)} booked with doctor ${created.doctorId.slice(0, 8)} at ${created.startsAt.toISOString()}.`,
          entityType: 'Appointment',
          entityId: created.id,
          patientId: created.patientId,
          doctorUserId: created.doctor.userId,
          doctorPhone: created.doctor.user.phone ?? undefined,
        }).catch(() => undefined);
      }
      return created;
    } catch (error) {
      if (slotConflictCode(error)) throwSlotUnavailable();
      throw error;
    }
  }

  async listAppointments(user: AuthContext, query: { page: number; limit: number; skip: number; search?: string; doctorId?: string; patientId?: string; departmentId?: string; status?: string; from?: string; to?: string; hospitalId?: string }) {
    const hospitalId = resolveHospitalScope(user, query.hospitalId);
    const where: Prisma.AppointmentWhereInput = { deletedAt: null };
    if (hospitalId) where.hospitalId = hospitalId;
    else if (user.role !== 'SUPER_ADMIN') return { items: [], total: 0 };
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own) return { items: [], total: 0 };
      where.patientId = own.id;
    } else if (user.role === 'DOCTOR') {
      const own = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!own) return { items: [], total: 0 };
      where.doctorId = query.doctorId && query.doctorId !== own.id ? '__none__' : own.id;
    } else {
      if (query.doctorId) where.doctorId = query.doctorId;
      if (query.patientId) where.patientId = query.patientId;
    }
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.status) where.status = query.status as AppointmentStatus;
    if (query.from || query.to) {
      where.startsAt = {};
      if (query.from) (where.startsAt as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.startsAt as Prisma.DateTimeFilter).lte = new Date(query.to);
    }
    if (query.search) where.reason = { contains: query.search, mode: 'insensitive' };
    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { startsAt: 'asc' },
        include: { patient: true, doctor: { include: { user: true } }, department: true },
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { items, total };
  }

  async getAppointment(id: string, user: AuthContext) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id }, include: { patient: true, doctor: true, department: true } });
    if (!appointment || appointment.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
    }
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== appointment.patientId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only view your own appointments.' } });
      }
      return appointment;
    }
    if (user.role === 'DOCTOR') {
      const own = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== appointment.doctorId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Doctors may only view their own appointments.' } });
      }
      return appointment;
    }
    this.assertSameHospital(user, appointment.hospitalId);
    return appointment;
  }

  async updateStatus(id: string, status: AppointmentStatus, user: AuthContext, ip?: string | null) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment || appointment.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
    }
    if (user.role === 'DOCTOR') {
      const own = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== appointment.doctorId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Doctors may only update their own appointments.' } });
      }
    } else if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'NURSE'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to update appointments.' } });
    } else {
      this.assertSameHospital(user, appointment.hospitalId);
    }
    if (status === 'PENDING') {
      const error = new Error('Invalid status transition.');
      (error as NodeJS.ErrnoException).code = 'INVALID_TRANSITION';
      throw error;
    }
    assertValidTransition(appointment.status, status);
    const updated = await this.prisma.appointment.update({ where: { id }, data: { status } });
    if (status === 'CANCELLED' || status === 'NO_SHOW') {
      await this.reminders.cancelFor(id);
      await this.invalidateSlots(appointment.doctorId, appointment.startsAt);
    }
    await this.audit.record({ userId: user.userId, hospitalId: appointment.hospitalId, action: 'appointment.status', entityType: 'Appointment', entityId: id, ipAddress: ip ?? null, metadata: { from: appointment.status, to: status } });
    if (status === 'CONFIRMED') {
      const full = await this.prisma.appointment.findUnique({ where: { id }, include: { patient: { include: { user: true } }, doctor: { include: { user: true } } } });
      if (full) {
        await this.notifications.emit({
          hospitalId: full.hospitalId,
          type: 'APPOINTMENT_CONFIRMED',
          title: 'Appointment confirmed',
          body: `Appointment on ${full.startsAt.toISOString()} with ${full.doctor.specialization} is confirmed.`,
          entityType: 'Appointment',
          entityId: full.id,
          patientId: full.patientId,
          patientEmail: full.patient.user?.email ?? undefined,
          patientPhone: full.patient.phone ?? full.patient.user?.phone ?? undefined,
        }).catch(() => undefined);
      }
    }
    return updated;
  }

  async cancel(id: string, user: AuthContext, ip?: string | null) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment || appointment.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
    }
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== appointment.patientId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only cancel your own appointments.' } });
      }
    } else if (user.role === 'DOCTOR') {
      const own = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== appointment.doctorId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Doctors may only cancel their own appointments.' } });
      }
    } else if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'NURSE'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to cancel appointments.' } });
    } else {
      this.assertSameHospital(user, appointment.hospitalId);
    }
    assertValidTransition(appointment.status, 'CANCELLED');
    const updated = await this.prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.reminders.cancelFor(id);
    await this.invalidateSlots(appointment.doctorId, appointment.startsAt);
    await this.audit.record({ userId: user.userId, hospitalId: appointment.hospitalId, action: 'appointment.cancel', entityType: 'Appointment', entityId: id, ipAddress: ip ?? null });
    return updated;
  }
}

export { toTime };
