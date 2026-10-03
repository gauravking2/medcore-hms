import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthContext } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

export type RangeKey = 'today' | '7d' | '30d' | 'custom';

export interface DateRange {
  from: Date;
  to: Date;
  key: RangeKey;
}

export function parseDateRange(query: { range?: unknown; from?: unknown; to?: unknown }): DateRange {
  const key = (typeof query.range === 'string' ? query.range : '7d') as RangeKey;
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (key === 'today') {
    const end = new Date(startOfToday);
    end.setHours(23, 59, 59, 999);
    return { from: startOfToday, to: end, key };
  }
  if (key === '30d') {
    const from = new Date(startOfToday);
    from.setDate(from.getDate() - 29);
    return { from, to: now, key };
  }
  if (key === 'custom') {
    const from = typeof query.from === 'string' ? new Date(query.from) : null;
    const to = typeof query.to === 'string' ? new Date(query.to) : null;
    if (!from || Number.isNaN(from.getTime()) || !to || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
      const error = new Error('Custom range needs valid from/to dates with from <= to.');
      (error as NodeJS.ErrnoException).code = 'INVALID_RANGE';
      throw error;
    }
    if (to.getTime() - from.getTime() > 366 * 24 * 3600_000) {
      const error = new Error('Custom range is limited to 366 days.');
      (error as NodeJS.ErrnoException).code = 'INVALID_RANGE';
      throw error;
    }
    return { from, to, key };
  }
  const from = new Date(startOfToday);
  from.setDate(from.getDate() - 6);
  return { from, to: now, key: '7d' };
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    days.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days.slice(0, 366);
}

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  resolveScope(user: AuthContext, requestedHospitalId?: string): string | null {
    if (user.role === 'SUPER_ADMIN') return requestedHospitalId ?? null;
    if (requestedHospitalId && requestedHospitalId !== user.hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
    }
    if (!user.hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'NO_HOSPITAL_SCOPE', message: 'Your account is not associated with a hospital.' } });
    }
    return user.hospitalId;
  }

  assertAnalyticsRole(user: AuthContext): void {
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'ACCOUNTANT', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'LAB_TECHNICIAN', 'PHARMACIST', 'PATIENT'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission for analytics.' } });
    }
  }

  // Entity permissions per role. This is the single source of truth: the
  // per-entity helpers below must not contradict it, and the frontend mirrors
  // it so a role never requests an entity it will be denied.
  private static readonly SEARCH_ENTITIES: Record<string, string[]> = {
    SUPER_ADMIN: ['patients', 'doctors', 'medicines'],
    HOSPITAL_ADMIN: ['patients', 'doctors', 'medicines'],
    DOCTOR: ['patients', 'doctors', 'medicines'],
    NURSE: ['patients', 'doctors', 'medicines'],
    RECEPTIONIST: ['patients', 'doctors', 'medicines'],
    LAB_TECHNICIAN: ['doctors', 'medicines'],
    PHARMACIST: ['doctors', 'medicines'],
    ACCOUNTANT: ['medicines'],
  };

  static searchEntitiesFor(role: string): string[] {
    return InsightsService.SEARCH_ENTITIES[role] ?? [];
  }

  assertSearchRole(user: AuthContext, entity: string): void {
    const allowed = InsightsService.searchEntitiesFor(user.role);
    if (allowed.length === 0) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Search is not available for patient accounts.' } });
    }
    if (!allowed.includes(entity)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'This search is not available for your role.' } });
    }
  }

  async overview(user: AuthContext, hospitalId: string | undefined, range: DateRange) {
    this.assertAnalyticsRole(user);
    if (user.role === 'PATIENT') {
      return this.patientOverview(user);
    }
    const scope = this.resolveScope(user, hospitalId);
    const hospitalFilter = scope ? { hospitalId: scope } : {};
    const [revenue, appointments, patients, doctors, beds, departments, lowStock] = await Promise.all([
      this.revenue(scope, range),
      this.appointmentVolume(scope, range),
      this.patientGrowth(scope, range),
      this.doctorCounts(scope),
      this.bedOccupancy(scope),
      this.departmentOccupancy(scope),
      this.lowStockCount(scope),
    ]);
    const revenueTotal = revenue.series.reduce((sum, point) => sum + point.total, 0);
    const appointmentTotal = appointments.series.reduce((sum, point) => sum + point.count, 0);
    void hospitalFilter;
    return { range: { from: range.from.toISOString(), to: range.to.toISOString(), key: range.key }, revenueTotal, appointmentTotal, revenue, appointments, patients, doctors, beds, departments, lowStock };
  }

  private async revenue(hospitalId: string | null, range: DateRange) {
    const where = {
      ...(hospitalId ? { hospitalId } : {}),
      status: 'PAID' as const,
      paidAt: { gte: range.from, lte: range.to },
    };
    const invoices = await this.prisma.invoice.findMany({ where, select: { total: true, paidAt: true } });
    const byDay = new Map<string, number>();
    for (const invoice of invoices) {
      if (!invoice.paidAt) continue;
      const key = dayKey(invoice.paidAt);
      byDay.set(key, (byDay.get(key) ?? 0) + Number(invoice.total));
    }
    const series = eachDay(range.from, range.to).map((day) => ({ day, total: Math.round((byDay.get(day) ?? 0) * 100) / 100 }));
    return { series };
  }

  private async appointmentVolume(hospitalId: string | null, range: DateRange) {
    const where = {
      ...(hospitalId ? { hospitalId } : {}),
      deletedAt: null,
      startsAt: { gte: range.from, lte: range.to },
    };
    const appointments = await this.prisma.appointment.findMany({ where, select: { startsAt: true, status: true } });
    const byDay = new Map<string, number>();
    for (const appointment of appointments) {
      const key = dayKey(appointment.startsAt);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const series = eachDay(range.from, range.to).map((day) => ({ day, count: byDay.get(day) ?? 0 }));
    return { series };
  }

  private async patientGrowth(hospitalId: string | null, range: DateRange) {
    const where = {
      ...(hospitalId ? { hospitalId } : {}),
      deletedAt: null,
      createdAt: { gte: range.from, lte: range.to },
    };
    const patients = await this.prisma.patient.findMany({ where, select: { createdAt: true } });
    const byDay = new Map<string, number>();
    for (const patient of patients) {
      const key = dayKey(patient.createdAt);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const series = eachDay(range.from, range.to).map((day) => ({ day, count: byDay.get(day) ?? 0 }));
    return { series, total: patients.length };
  }

  private async doctorCounts(hospitalId: string | null) {
    const where = { ...(hospitalId ? { hospitalId } : {}), deletedAt: null };
    const [active, total] = await Promise.all([
      this.prisma.doctor.count({ where }),
      this.prisma.doctor.count({ where: hospitalId ? { hospitalId } : {} }),
    ]);
    return { active, total };
  }

  private async bedOccupancy(hospitalId: string | null) {
    // The schema models rooms (no per-bed rows). Occupancy is derived from
    // active rooms vs rooms referenced by upcoming/active appointments.
    const where = hospitalId ? { hospitalId } : {};
    const [rooms, occupiedRooms] = await Promise.all([
      this.prisma.room.findMany({ where, select: { id: true, roomNumber: true, capacity: true, isActive: true } }),
      this.prisma.appointment.findMany({
        where: { ...(hospitalId ? { hospitalId } : {}), deletedAt: null, roomId: { not: null }, startsAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        select: { roomId: true },
      }),
    ]);
    const occupied = new Set(occupiedRooms.map((appointment) => appointment.roomId).filter(Boolean) as string[]);
    const totalCapacity = rooms.reduce((sum, room) => sum + (room.capacity ?? 1), 0);
    return {
      totalRooms: rooms.length,
      activeRooms: rooms.filter((room) => room.isActive).length,
      occupiedRooms: occupied.size,
      totalCapacity,
      note: 'Room-level occupancy; no per-bed rows exist in the schema.',
    };
  }

  private async departmentOccupancy(hospitalId: string | null) {
    if (!hospitalId) {
      const hospitals = await this.prisma.hospital.findMany({ select: { id: true, name: true } });
      const perHospital = await Promise.all(
        hospitals.slice(0, 25).map(async (hospital) => ({
          hospitalId: hospital.id,
          hospitalName: hospital.name,
          appointments: await this.prisma.appointment.count({ where: { hospitalId: hospital.id, deletedAt: null, startsAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) } } }),
        })),
      );
      return { scope: 'platform', departments: [], perHospital };
    }
    const departments = await this.prisma.department.findMany({ where: { hospitalId }, select: { id: true, name: true, code: true } });
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const heat = await Promise.all(
      departments.map(async (department) => ({
        departmentId: department.id,
        name: department.name,
        code: department.code,
        appointments: await this.prisma.appointment.count({ where: { hospitalId, departmentId: department.id, deletedAt: null, startsAt: { gte: since } } }),
        doctors: await this.prisma.doctorDepartment.count({ where: { hospitalId, departmentId: department.id } }),
      })),
    );
    return { scope: 'hospital', departments: heat, perHospital: [] };
  }

  private async lowStockCount(hospitalId: string | null) {
    if (!hospitalId) {
      const count = await this.prisma.medicine.count({});
      return { lowStockMedicines: 0, medicinesTracked: count, scope: 'platform' as const };
    }
    const medicines = await this.prisma.medicine.findMany({ where: { hospitalId }, include: { batches: { select: { quantity: true } } } });
    let low = 0;
    for (const medicine of medicines) {
      const total = medicine.batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
      if (total < Number(medicine.reorderLevel)) low += 1;
    }
    return { lowStockMedicines: low, medicinesTracked: medicines.length, scope: 'hospital' as const };
  }

  private async patientOverview(user: AuthContext) {
    const patient = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
    if (!patient) {
      throw new ForbiddenException({ success: false, error: { code: 'NO_PATIENT_PROFILE', message: 'No patient profile is linked to this account.' } });
    }
    const [upcoming, invoices, labOrders, notifications] = await Promise.all([
      this.prisma.appointment.count({ where: { patientId: patient.id, deletedAt: null, startsAt: { gte: new Date() }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } }),
      this.prisma.invoice.findMany({ where: { patientId: patient.id }, select: { paymentStatus: true, total: true } }),
      this.prisma.labOrder.count({ where: { patientId: patient.id, status: 'APPROVED' } }),
      this.prisma.notification.count({ where: { userId: user.userId, status: 'UNREAD' } }),
    ]);
    const unpaid = invoices.filter((invoice) => invoice.paymentStatus !== 'PAID');
    return {
      scope: 'patient',
      upcomingAppointments: upcoming,
      approvedReports: labOrders,
      unpaidInvoices: unpaid.length,
      unpaidTotal: unpaid.reduce((sum, invoice) => sum + Number(invoice.total), 0),
      unreadNotifications: notifications,
    };
  }

  async search(user: AuthContext, entity: string, term: string, hospitalId: string | undefined, page: { page: number; limit: number; skip: number }, filters: Record<string, string | undefined>) {
    this.assertSearchRole(user, entity);
    // A SUPER_ADMIN is platform-scoped by design (matching analytics/activity),
    // so an unqualified search spans all hospitals instead of failing with
    // NO_HOSPITAL_SCOPE. Every other role is resolved to its own hospital.
    const scope = this.resolveScope(user, hospitalId);
    const cleaned = term.trim().slice(0, 100);
    if (entity === 'patients') return this.searchPatients(user, scope, cleaned, page, filters);
    if (entity === 'doctors') return this.searchDoctors(user, scope, cleaned, page, filters);
    if (entity === 'medicines') return this.searchMedicines(user, scope, cleaned, page, filters);
    throw new ForbiddenException({ success: false, error: { code: 'UNKNOWN_ENTITY', message: 'Entity must be patients, doctors, or medicines.' } });
  }

  private async searchPatients(user: AuthContext, hospitalId: string | null, term: string, page: { page: number; limit: number; skip: number }, filters: Record<string, string | undefined>) {
    const where: Record<string, unknown> = { deletedAt: null, ...(hospitalId ? { hospitalId } : {}) };
    if (term) {
      where.OR = [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { patientNumber: { contains: term, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.patient.findMany({ where: where as never, skip: page.skip, take: page.limit, orderBy: { createdAt: 'desc' }, select: { id: true, firstName: true, lastName: true, patientNumber: true, phone: true } }),
      this.prisma.patient.count({ where: where as never }),
    ]);
    void filters;
    return { items, total };
  }

  private async searchDoctors(user: AuthContext, hospitalId: string | null, term: string, page: { page: number; limit: number; skip: number }, filters: Record<string, string | undefined>) {
    const where: Record<string, unknown> = { deletedAt: null, ...(hospitalId ? { hospitalId } : {}) };
    const and: Record<string, unknown>[] = [];
    if (term) {
      and.push({ OR: [{ specialization: { contains: term, mode: 'insensitive' } }, { licenseNumber: { contains: term, mode: 'insensitive' } }, { user: { email: { contains: term, mode: 'insensitive' } } }] });
    }
    if (filters.specialization) and.push({ specialization: { contains: filters.specialization, mode: 'insensitive' } });
    if (filters.departmentId) and.push({ departments: { some: { departmentId: filters.departmentId } } });
    if (and.length > 0) where.AND = and;
    const [items, total] = await Promise.all([
      this.prisma.doctor.findMany({ where: where as never, skip: page.skip, take: page.limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { email: true, firstName: true, lastName: true } }, departments: { include: { department: { select: { id: true, name: true } } } } } }),
      this.prisma.doctor.count({ where: where as never }),
    ]);
    void user;
    return { items, total };
  }

  private async searchMedicines(user: AuthContext, hospitalId: string | null, term: string, page: { page: number; limit: number; skip: number }, filters: Record<string, string | undefined>) {
    const where: Record<string, unknown> = { ...(hospitalId ? { hospitalId } : {}) };
    const and: Record<string, unknown>[] = [];
    if (term) {
      and.push({ OR: [{ name: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }, { genericName: { contains: term, mode: 'insensitive' } }] });
    }
    if (filters.dosageForm) and.push({ dosageForm: { contains: filters.dosageForm, mode: 'insensitive' } });
    if (filters.activeOnly === 'true') and.push({ isActive: true });
    if (and.length > 0) where.AND = and;
    let items = await this.prisma.medicine.findMany({ where: where as never, skip: page.skip, take: page.limit, orderBy: { name: 'asc' }, include: { batches: { select: { quantity: true, expiryDate: true, quarantined: true } } } });
    let total = await this.prisma.medicine.count({ where: where as never });
    if (filters.lowStock === 'true' || filters.expiring === 'true') {
      const all = await this.prisma.medicine.findMany({ where: where as never, orderBy: { name: 'asc' }, include: { batches: { select: { quantity: true, expiryDate: true, quarantined: true } } } });
      const now = Date.now();
      const filtered = all.filter((medicine) => {
        const stock = medicine.batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
        if (filters.lowStock === 'true' && stock >= Number(medicine.reorderLevel)) return false;
        if (filters.expiring === 'true') {
          const soon = medicine.batches.some((batch) => !batch.quarantined && batch.expiryDate.getTime() - now < 30 * 24 * 3600_000 && Number(batch.quantity) > 0);
          if (!soon) return false;
        }
        return true;
      });
      total = filtered.length;
      items = filtered.slice(page.skip, page.skip + page.limit);
    }
    void user;
    return { items, total };
  }

  async activity(user: AuthContext, hospitalId: string | undefined, page: { page: number; limit: number; skip: number }) {
    const scope = this.resolveScope(user, hospitalId);
    const where = scope ? { hospitalId: scope } : {};
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, skip: page.skip, take: page.limit, orderBy: { createdAt: 'desc' }, select: { id: true, action: true, entityType: true, entityId: true, userId: true, createdAt: true } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
