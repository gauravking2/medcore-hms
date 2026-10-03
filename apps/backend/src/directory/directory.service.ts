import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { HospitalStatus, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth.service';
import { hashPassword } from '../auth/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import { resolveHospitalScope } from '../tenant/tenant.decorator';
import {
  CreateDepartmentDto,
  CreateDoctorDto,
  CreateHospitalDto,
  CreatePatientDto,
  InviteStaffDto,
  UpdateDepartmentDto,
  UpdateDoctorDto,
  UpdateHospitalDto,
  UpdatePatientDto,
} from './directory.dto';

const STAFF_MANAGEABLE: UserRole[] = [
  'HOSPITAL_ADMIN',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'ACCOUNTANT',
];

function safeUser(user: {
  id: string;
  email: string;
  role: UserRole;
  hospitalId: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    hospitalId: user.hospitalId,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertSameHospital(user: AuthContext, hospitalId: string, code = 'CROSS_HOSPITAL_DENIED') {
    const scope = resolveHospitalScope(user, hospitalId);
    if (scope !== hospitalId) {
      throw new ForbiddenException({ success: false, error: { code, message: 'Access to another hospital is denied.' } });
    }
  }

  private async nextPatientNumber(hospitalId: string, reserved: Set<string> = new Set()): Promise<string> {
    // Patient numbers in long-lived databases use mixed legacy formats
    // (e.g. "QA-1", "1-030", "CMUS-0002"). Lexical ORDER BY on the raw string
    // does not yield the numeric maximum, which previously caused
    // `nextPatientNumber` to return an already-used value and surface a 500
    // unique-constraint error. Scan the trailing numeric suffix instead.
    const rows = await this.prisma.patient.findMany({ where: { hospitalId }, select: { patientNumber: true } });
    let max = 0;
    for (const row of rows) {
      const tail = String(row.patientNumber).split('-').pop() ?? '';
      const numeric = Number(tail);
      if (Number.isFinite(numeric) && numeric > max) max = numeric;
    }
    const prefix = hospitalId.slice(0, 4).toUpperCase();
    const existing = new Set(rows.map((row) => row.patientNumber));
    let candidate = max + 1;
    let value = `${prefix}-${String(candidate).padStart(4, '0')}`;
    while (existing.has(value) || reserved.has(value)) {
      candidate += 1;
      value = `${prefix}-${String(candidate).padStart(4, '0')}`;
    }
    return value;
  }

  async createHospital(dto: CreateHospitalDto, user: AuthContext, ip?: string | null) {
    const hospital = await this.prisma.hospital.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        email: dto.email,
        phone: dto.phone,
        timezone: dto.timezone ?? 'UTC',
        status: 'PENDING_VERIFICATION',
        ...(dto.address
          ? { addresses: { create: { ...dto.address } } }
          : {}),
      },
      include: { addresses: true },
    });
    await this.audit.record({ userId: user.userId, hospitalId: hospital.id, action: 'hospital.create', entityType: 'Hospital', entityId: hospital.id, ipAddress: ip ?? null, metadata: { slug: hospital.slug } });
    return hospital;
  }

  async listHospitals(user: AuthContext, page: { page: number; limit: number; search?: string; skip: number }) {
    const where: Prisma.HospitalWhereInput = {};
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.hospitalId) return { items: [], total: 0 };
      where.id = user.hospitalId;
    }
    if (page.search) where.OR = [{ name: { contains: page.search, mode: 'insensitive' } }, { slug: { contains: page.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      this.prisma.hospital.findMany({ where, skip: page.skip, take: page.limit, orderBy: { name: 'asc' } }),
      this.prisma.hospital.count({ where }),
    ]);
    return { items, total };
  }

  async getHospital(id: string, user: AuthContext) {
    const hospital = await this.prisma.hospital.findUnique({ where: { id }, include: { addresses: true } });
    if (!hospital) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Hospital not found.' } });
    if (user.role !== 'SUPER_ADMIN' && hospital.id !== user.hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
    }
    return hospital;
  }

  async updateHospital(id: string, dto: UpdateHospitalDto, user: AuthContext, ip?: string | null) {
    if (user.role !== 'SUPER_ADMIN') this.assertSameHospital(user, id);
    else {
      const exists = await this.prisma.hospital.findUnique({ where: { id } });
      if (!exists) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Hospital not found.' } });
    }
    const hospital = await this.prisma.hospital.update({ where: { id }, data: { ...dto } });
    await this.audit.record({ userId: user.userId, hospitalId: id, action: 'hospital.update', entityType: 'Hospital', entityId: id, ipAddress: ip ?? null });
    return hospital;
  }

  async updateHospitalStatus(id: string, status: HospitalStatus, user: AuthContext, ip?: string | null) {
    const hospital = await this.prisma.hospital.findUnique({ where: { id } });
    if (!hospital) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Hospital not found.' } });
    if (user.role === 'HOSPITAL_ADMIN') {
      this.assertSameHospital(user, id);
      if (status === 'ACTIVE' || status === 'PENDING_VERIFICATION') {
        throw new ForbiddenException({ success: false, error: { code: 'STATUS_DENIED', message: 'Only platform administrators can verify hospitals.' } });
      }
    }
    const updated = await this.prisma.hospital.update({ where: { id }, data: { status } });
    await this.audit.record({ userId: user.userId, hospitalId: id, action: 'hospital.status', entityType: 'Hospital', entityId: id, ipAddress: ip ?? null, metadata: { status } });
    return updated;
  }

  async createDepartment(hospitalId: string, dto: CreateDepartmentDto, user: AuthContext, ip?: string | null) {
    this.assertSameHospital(user, hospitalId);
    const department = await this.prisma.department.create({ data: { hospitalId, name: dto.name, code: dto.code, description: dto.description } });
    await this.audit.record({ userId: user.userId, hospitalId, action: 'department.create', entityType: 'Department', entityId: department.id, ipAddress: ip ?? null });
    return department;
  }

  async listDepartments(hospitalId: string, user: AuthContext, page: { page: number; limit: number; search?: string; skip: number }) {
    this.assertSameHospital(user, hospitalId);
    const where: Prisma.DepartmentWhereInput = { hospitalId };
    if (page.search) where.OR = [{ name: { contains: page.search, mode: 'insensitive' } }, { code: { contains: page.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      this.prisma.department.findMany({ where, skip: page.skip, take: page.limit, orderBy: { name: 'asc' } }),
      this.prisma.department.count({ where }),
    ]);
    return { items, total };
  }

  async getDepartment(id: string, user: AuthContext) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found.' } });
    this.assertSameHospital(user, department.hospitalId);
    return department;
  }

  async updateDepartment(id: string, dto: UpdateDepartmentDto, user: AuthContext, ip?: string | null) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Department not found.' } });
    this.assertSameHospital(user, department.hospitalId);
    const updated = await this.prisma.department.update({ where: { id }, data: { ...dto } });
    await this.audit.record({ userId: user.userId, hospitalId: department.hospitalId, action: 'department.update', entityType: 'Department', entityId: id, ipAddress: ip ?? null });
    return updated;
  }

  async createDoctor(dto: CreateDoctorDto, user: AuthContext, ip?: string | null) {
    this.assertSameHospital(user, dto.hospitalId);
    let userId = dto.userId ?? null;
    if (!userId && dto.email) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.hospitalId !== dto.hospitalId || existing.role !== 'DOCTOR') {
          throw new ForbiddenException({ success: false, error: { code: 'USER_TENANT_MISMATCH', message: 'User does not belong to this hospital as a doctor.' } });
        }
        userId = existing.id;
      } else {
        const created = await this.prisma.user.create({
          data: { email, passwordHash: await hashPassword(`Temp!${Date.now().toString(36)}Aa1`), role: 'DOCTOR', hospitalId: dto.hospitalId, firstName: dto.firstName, lastName: dto.lastName },
        });
        userId = created.id;
      }
    }
    if (!userId) {
      throw new ForbiddenException({ success: false, error: { code: 'DOCTOR_USER_REQUIRED', message: 'Provide userId or email for the doctor account.' } });
    }
    const linked = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!linked || linked.hospitalId !== dto.hospitalId || linked.role !== 'DOCTOR') {
      throw new ForbiddenException({ success: false, error: { code: 'USER_TENANT_MISMATCH', message: 'User does not belong to this hospital as a doctor.' } });
    }
    const departments = dto.departmentIds ?? [];
    for (const departmentId of departments) {
      const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
      if (!department || department.hospitalId !== dto.hospitalId) {
        throw new ForbiddenException({ success: false, error: { code: 'DEPARTMENT_TENANT_MISMATCH', message: 'Department does not belong to this hospital.' } });
      }
    }
    const doctor = await this.prisma.doctor.create({
      data: {
        hospitalId: dto.hospitalId,
        userId,
        licenseNumber: dto.licenseNumber,
        specialization: dto.specialization,
        bio: dto.bio,
        consultationFee: dto.consultationFee ?? 0,
      },
      include: { user: true, departments: { include: { department: true } } },
    });
    for (const departmentId of departments) {
      await this.prisma.doctorDepartment.create({ data: { hospitalId: dto.hospitalId, doctorId: doctor.id, departmentId } });
    }
    await this.audit.record({ userId: user.userId, hospitalId: dto.hospitalId, action: 'doctor.create', entityType: 'Doctor', entityId: doctor.id, ipAddress: ip ?? null });
    return doctor;
  }

  async listDoctors(user: AuthContext, page: { page: number; limit: number; search?: string; skip: number; hospitalId?: string }) {
    const hospitalId = resolveHospitalScope(user, page.hospitalId);
    const where: Prisma.DoctorWhereInput = { deletedAt: null };
    if (hospitalId) where.hospitalId = hospitalId;
    else if (user.role !== 'SUPER_ADMIN') return { items: [], total: 0 };
    if (page.search) where.OR = [{ specialization: { contains: page.search, mode: 'insensitive' } }, { licenseNumber: { contains: page.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      this.prisma.doctor.findMany({ where, skip: page.skip, take: page.limit, orderBy: { createdAt: 'desc' }, include: { user: true, departments: { include: { department: true } } } }),
      this.prisma.doctor.count({ where }),
    ]);
    return { items, total };
  }

  async getDoctor(id: string, user: AuthContext) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id }, include: { user: true, departments: { include: { department: true } } } });
    if (!doctor || doctor.deletedAt) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Doctor not found.' } });
    if (user.role === 'DOCTOR') {
      const own = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== doctor.id) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access is denied.' } });
      }
      return doctor;
    }
    this.assertSameHospital(user, doctor.hospitalId);
    return doctor;
  }

  async updateDoctor(id: string, dto: UpdateDoctorDto, user: AuthContext, ip?: string | null) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id } });
    if (!doctor || doctor.deletedAt) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Doctor not found.' } });
    if (user.role === 'DOCTOR') {
      const own = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== doctor.id) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Doctors may only update their own profile.' } });
      }
      if (dto.departmentIds) {
        throw new ForbiddenException({ success: false, error: { code: 'DEPARTMENT_DENIED', message: 'Doctors cannot change department assignment.' } });
      }
    } else if (user.role !== 'SUPER_ADMIN' && user.role !== 'HOSPITAL_ADMIN') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } });
    } else {
      this.assertSameHospital(user, doctor.hospitalId);
    }
    const { departmentIds, ...rest } = dto;
    const updated = await this.prisma.doctor.update({ where: { id }, data: { ...rest } });
    if (departmentIds && (user.role === 'SUPER_ADMIN' || user.role === 'HOSPITAL_ADMIN')) {
      for (const departmentId of departmentIds) {
        const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
        if (!department || department.hospitalId !== doctor.hospitalId) {
          throw new ForbiddenException({ success: false, error: { code: 'DEPARTMENT_TENANT_MISMATCH', message: 'Department does not belong to this hospital.' } });
        }
      }
      await this.prisma.doctorDepartment.deleteMany({ where: { doctorId: id } });
      await this.prisma.doctorDepartment.createMany({ data: departmentIds.map((departmentId) => ({ hospitalId: doctor.hospitalId, doctorId: id, departmentId })) });
    }
    await this.audit.record({ userId: user.userId, hospitalId: doctor.hospitalId, action: 'doctor.update', entityType: 'Doctor', entityId: id, ipAddress: ip ?? null });
    return updated;
  }

  async listUsers(user: AuthContext, page: { page: number; limit: number; search?: string; skip: number; hospitalId?: string; role?: string }) {
    const hospitalId = resolveHospitalScope(user, page.hospitalId);
    const where: Prisma.UserWhereInput = {};
    if (hospitalId) where.hospitalId = hospitalId;
    else if (user.role !== 'SUPER_ADMIN') return { items: [], total: 0 };
    if (page.role) where.role = page.role as UserRole;
    if (page.search) where.email = { contains: page.search, mode: 'insensitive' };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, skip: page.skip, take: page.limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(safeUser), total };
  }

  async getUser(id: string, user: AuthContext) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    if (user.role !== 'SUPER_ADMIN') {
      if (!target.hospitalId || target.hospitalId !== user.hospitalId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
      }
    }
    if (target.passwordHash) void 0;
    return safeUser(target);
  }

  async inviteStaff(dto: InviteStaffDto, user: AuthContext, ip?: string | null) {
    this.assertSameHospital(user, dto.hospitalId);
    if (!STAFF_MANAGEABLE.includes(dto.role as UserRole)) {
      throw new ForbiddenException({ success: false, error: { code: 'ROLE_DENIED', message: 'This role cannot be assigned through staff invitation.' } });
    }
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ForbiddenException({ success: false, error: { code: 'DUPLICATE_EMAIL', message: 'An account with this email already exists.' } });
    }
    const created = await this.prisma.user.create({
      data: { email, passwordHash: await hashPassword(dto.password), role: dto.role as UserRole, hospitalId: dto.hospitalId, firstName: dto.firstName, lastName: dto.lastName },
    });
    await this.audit.record({ userId: user.userId, hospitalId: dto.hospitalId, action: 'staff.invite', entityType: 'User', entityId: created.id, ipAddress: ip ?? null, metadata: { role: dto.role } });
    return safeUser(created);
  }

  async updateUserRole(id: string, role: string, user: AuthContext, ip?: string | null) {
    const next = role as UserRole;
    if (next === 'SUPER_ADMIN') {
      throw new ForbiddenException({ success: false, error: { code: 'ROLE_DENIED', message: 'SUPER_ADMIN cannot be granted through this endpoint.' } });
    }
    if (id === user.userId) {
      throw new ForbiddenException({ success: false, error: { code: 'SELF_PROMOTION_DENIED', message: 'You cannot change your own role.' } });
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    if (user.role === 'HOSPITAL_ADMIN') {
      if (!target.hospitalId || target.hospitalId !== user.hospitalId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
      }
      if (target.role === 'SUPER_ADMIN') {
        throw new ForbiddenException({ success: false, error: { code: 'ROLE_DENIED', message: 'Platform roles cannot be changed here.' } });
      }
      if (!STAFF_MANAGEABLE.includes(next)) {
        throw new ForbiddenException({ success: false, error: { code: 'ROLE_DENIED', message: 'This role cannot be assigned.' } });
      }
    }
    const updated = await this.prisma.user.update({ where: { id }, data: { role: next } });
    await this.audit.record({ userId: user.userId, hospitalId: updated.hospitalId, action: 'staff.role-change', entityType: 'User', entityId: id, ipAddress: ip ?? null, metadata: { from: target.role, to: role } });
    return safeUser(updated);
  }

  async createPatient(dto: CreatePatientDto, user: AuthContext, ip?: string | null) {
    this.assertSameHospital(user, dto.hospitalId);
    let userId: string | null = null;
    if (dto.email) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.hospitalId !== dto.hospitalId || existing.role !== 'PATIENT') {
          throw new ForbiddenException({ success: false, error: { code: 'USER_TENANT_MISMATCH', message: 'User does not belong to this hospital as a patient.' } });
        }
        userId = existing.id;
      } else {
        if (!dto.password) {
          throw new ForbiddenException({ success: false, error: { code: 'PASSWORD_REQUIRED', message: 'Password is required when creating a patient login.' } });
        }
        const created = await this.prisma.user.create({
          data: { email, passwordHash: await hashPassword(dto.password), role: 'PATIENT', hospitalId: dto.hospitalId },
        });
        userId = created.id;
      }
    }
    const reserved = new Set<string>();
    let patient: { id: string } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const patientNumber = await this.nextPatientNumber(dto.hospitalId, reserved);
      reserved.add(patientNumber);
      try {
        patient = await this.prisma.patient.create({
          data: {
            hospitalId: dto.hospitalId,
            userId,
            patientNumber,
            firstName: dto.firstName,
            lastName: dto.lastName,
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
            gender: dto.gender ?? 'UNSPECIFIED',
            phone: dto.phone,
            emergencyContactName: dto.emergencyContactName,
            emergencyContactPhone: dto.emergencyContactPhone,
          },
        });
        lastError = null;
        break;
      } catch (error) {
        // Concurrent creators can pick the same free number; retry with a
        // freshly computed suffix instead of surfacing a 500.
        if ((error as { code?: string })?.code === 'P2002') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    if (!patient) {
      if ((lastError as { code?: string })?.code === 'P2002') {
        throw new ConflictException({ success: false, error: { code: 'PATIENT_NUMBER_CONFLICT', message: 'Patient number is already in use. Please retry.' } });
      }
      throw lastError;
    }
    await this.audit.record({ userId: user.userId, hospitalId: dto.hospitalId, action: 'patient.create', entityType: 'Patient', entityId: patient.id, ipAddress: ip ?? null });
    return patient;
  }

  async listPatients(user: AuthContext, page: { page: number; limit: number; search?: string; skip: number; hospitalId?: string }) {
    const hospitalId = resolveHospitalScope(user, page.hospitalId);
    const where: Prisma.PatientWhereInput = { deletedAt: null };
    if (hospitalId) where.hospitalId = hospitalId;
    else if (user.role !== 'SUPER_ADMIN') return { items: [], total: 0 };
    if (page.search) where.OR = [{ firstName: { contains: page.search, mode: 'insensitive' } }, { lastName: { contains: page.search, mode: 'insensitive' } }, { patientNumber: { contains: page.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      this.prisma.patient.findMany({ where, skip: page.skip, take: page.limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.patient.count({ where }),
    ]);
    return { items, total };
  }

  async getPatient(id: string, user: AuthContext) {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient || patient.deletedAt) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Patient not found.' } });
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== patient.id) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only view your own profile.' } });
      }
      return patient;
    }
    this.assertSameHospital(user, patient.hospitalId);
    return patient;
  }

  async updatePatient(id: string, dto: UpdatePatientDto, user: AuthContext, ip?: string | null) {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient || patient.deletedAt) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Patient not found.' } });
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== patient.id) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only update your own profile.' } });
      }
    } else if (user.role !== 'SUPER_ADMIN' && user.role !== 'HOSPITAL_ADMIN' && user.role !== 'RECEPTIONIST' && user.role !== 'DOCTOR' && user.role !== 'NURSE') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } });
    } else {
      this.assertSameHospital(user, patient.hospitalId);
    }
    const updated = await this.prisma.patient.update({ where: { id }, data: { ...dto } });
    await this.audit.record({ userId: user.userId, hospitalId: patient.hospitalId, action: 'patient.update', entityType: 'Patient', entityId: id, ipAddress: ip ?? null });
    return updated;
  }
}
