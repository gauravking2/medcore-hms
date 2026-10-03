import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { decryptText, encryptText, isEncrypted } from './emr-crypto';
import { AppendEmrEntryDto, CreateEmrDto, CreatePrescriptionDto, RecordVitalsDto } from './emr.dto';
import { renderPrescriptionPdf } from './prescription-pdf';

const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_ALLOWED = new Map<string, string[]>([
  ['application/pdf', ['.pdf']],
  ['image/png', ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
]);
const SIGNATURE_ALLOWED = new Map<string, string[]>([
  ['image/svg+xml', ['.svg']],
  ['image/png', ['.png']],
]);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

function assertUpload(mimeType: string, fileName: string, sizeBytes: number, allowed: Map<string, string[]>, maxBytes: number) {
  if (sizeBytes > maxBytes) {
    throw new ForbiddenException({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the allowed size limit.' } });
  }
  const extensions = allowed.get(mimeType);
  const extension = extensionOf(fileName);
  if (!extensions || !extensions.includes(extension)) {
    throw new ForbiddenException({ success: false, error: { code: 'FILE_TYPE_DENIED', message: 'This file type is not allowed.' } });
  }
  if (['.exe', '.bat', '.cmd', '.sh', '.js', '.html'].includes(extension)) {
    throw new ForbiddenException({ success: false, error: { code: 'FILE_TYPE_DENIED', message: 'Executable files are not allowed.' } });
  }
}

function calculateBmi(heightCm?: number, weightKg?: number): number | null {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return null;
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  if (!Number.isFinite(bmi) || bmi < 5 || bmi > 100) return null;
  return Math.round(bmi * 10) / 10;
}

function decryptRecord(record: { diagnosis: string | null; clinicalNotes: string | null }) {
  return {
    diagnosis: record.diagnosis && isEncrypted(record.diagnosis) ? decryptText(record.diagnosis) : record.diagnosis,
    clinicalNotes: record.clinicalNotes && isEncrypted(record.clinicalNotes) ? decryptText(record.clinicalNotes) : record.clinicalNotes,
  };
}

@Injectable()
export class EmrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  private async ownDoctor(user: AuthContext) {
    const doctor = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
    if (!doctor || doctor.deletedAt) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'A doctor profile is required.' } });
    }
    return doctor;
  }

  async createRecord(dto: CreateEmrDto, user: AuthContext, ip?: string | null) {
    if (user.role !== 'DOCTOR') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Only doctors can create medical records.' } });
    }
    const doctor = await this.ownDoctor(user);
    const appointment = await this.prisma.appointment.findUnique({ where: { id: dto.appointmentId } });
    if (!appointment || appointment.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
    }
    if (appointment.doctorId !== doctor.id || appointment.hospitalId !== doctor.hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only create records for your own appointments.' } });
    }
    const existing = await this.prisma.medicalRecord.findUnique({ where: { appointmentId: dto.appointmentId } });
    if (existing) {
      throw new ForbiddenException({ success: false, error: { code: 'RECORD_EXISTS', message: 'A record already exists for this appointment.' } });
    }
    const created = await this.prisma.medicalRecord.create({
      data: {
        hospitalId: doctor.hospitalId,
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: doctor.id,
        chiefComplaint: dto.chiefComplaint,
        diagnosis: dto.diagnosis ? encryptText(dto.diagnosis) : undefined,
        clinicalNotes: dto.clinicalNotes ? encryptText(dto.clinicalNotes) : undefined,
      },
    });
    if (dto.presentingSymptoms || dto.differentialDiagnosis || dto.treatmentPlan || dto.treatmentInstructions || dto.icd10Code) {
      await this.prisma.medicalRecordEntry.create({
        data: {
          hospitalId: doctor.hospitalId,
          medicalRecordId: created.id,
          authorUserId: user.userId,
          entryType: 'NOTE',
          payload: {
            presentingSymptoms: dto.presentingSymptoms ?? null,
            differentialDiagnosis: dto.differentialDiagnosis ?? null,
            treatmentPlan: dto.treatmentPlan ?? null,
            treatmentInstructions: dto.treatmentInstructions ?? null,
            icd10Code: dto.icd10Code ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    }
    await this.audit.record({ userId: user.userId, hospitalId: doctor.hospitalId, action: 'emr.create', entityType: 'MedicalRecord', entityId: created.id, ipAddress: ip ?? null });
    return { ...created, ...decryptRecord(created) };
  }

  private async recordInScope(id: string, user: AuthContext) {
    const record = await this.prisma.medicalRecord.findUnique({
      where: { id },
      include: { entries: { orderBy: { createdAt: 'asc' } }, attachments: true, vitals: { orderBy: { createdAt: 'desc' } } },
    });
    if (!record) {
      throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Medical record not found.' } });
    }
    if (user.role === 'SUPER_ADMIN') return record;
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== record.patientId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only view your own records.' } });
      }
      return record;
    }
    if (!user.hospitalId || record.hospitalId !== user.hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
    }
    return record;
  }

  async getRecord(id: string, user: AuthContext) {
    const record = await this.recordInScope(id, user);
    return { ...record, ...decryptRecord(record) };
  }

  async recordsForPatient(patientId: string, user: AuthContext, page: { page: number; limit: number; skip: number }) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient || patient.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Patient not found.' } });
    }
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== patientId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only view your own records.' } });
      }
    } else if (user.role !== 'SUPER_ADMIN' && (!user.hospitalId || patient.hospitalId !== user.hospitalId)) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
    }
    const [items, total] = await Promise.all([
      this.prisma.medicalRecord.findMany({ where: { patientId }, skip: page.skip, take: page.limit, orderBy: { recordedAt: 'desc' } }),
      this.prisma.medicalRecord.count({ where: { patientId } }),
    ]);
    return { items: items.map((item) => ({ ...item, ...decryptRecord(item) })), total };
  }

  async updateRecord(id: string, dto: Partial<CreateEmrDto>, user: AuthContext, ip?: string | null) {
    if (user.role !== 'DOCTOR' && user.role !== 'SUPER_ADMIN' && user.role !== 'HOSPITAL_ADMIN') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot update clinical records.' } });
    }
    const record = await this.recordInScope(id, user);
    if (user.role === 'DOCTOR') {
      const own = await this.ownDoctor(user);
      if (own.id !== record.doctorId) {
        throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Doctors may only update their own encounters.' } });
      }
    }
    // Append-only: clinical changes are appended as history entries; the header
    // keeps the latest snapshot for fast reads but nothing is ever deleted.
    const updated = await this.prisma.medicalRecord.update({
      where: { id },
      data: {
        chiefComplaint: dto.chiefComplaint,
        diagnosis: dto.diagnosis ? encryptText(dto.diagnosis) : undefined,
        clinicalNotes: dto.clinicalNotes ? encryptText(dto.clinicalNotes) : undefined,
      },
    });
    await this.prisma.medicalRecordEntry.create({
      data: {
        hospitalId: record.hospitalId,
        medicalRecordId: id,
        authorUserId: user.userId,
        entryType: 'NOTE',
        payload: { chiefComplaint: dto.chiefComplaint ?? null, diagnosisUpdated: Boolean(dto.diagnosis), notesUpdated: Boolean(dto.clinicalNotes) } as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({ userId: user.userId, hospitalId: record.hospitalId, action: 'emr.update', entityType: 'MedicalRecord', entityId: id, ipAddress: ip ?? null });
    return { ...updated, ...decryptRecord(updated) };
  }

  async appendEntry(id: string, dto: AppendEmrEntryDto, user: AuthContext, ip?: string | null) {
    if (user.role !== 'DOCTOR' && user.role !== 'NURSE' && user.role !== 'SUPER_ADMIN' && user.role !== 'HOSPITAL_ADMIN') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot add clinical entries.' } });
    }
    const record = await this.recordInScope(id, user);
    const entry = await this.prisma.medicalRecordEntry.create({
      data: {
        hospitalId: record.hospitalId,
        medicalRecordId: id,
        authorUserId: user.userId,
        entryType: dto.entryType,
        payload: { text: dto.text ?? null, allergies: dto.allergies ?? null, medicationHistory: dto.medicationHistory ?? null, vaccinations: dto.vaccinations ?? null, familyHistory: dto.familyHistory ?? null } as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({ userId: user.userId, hospitalId: record.hospitalId, action: 'emr.entry', entityType: 'MedicalRecordEntry', entityId: entry.id, ipAddress: ip ?? null });
    return entry;
  }

  async recordVitals(id: string, dto: RecordVitalsDto, user: AuthContext, ip?: string | null) {
    if (user.role !== 'DOCTOR' && user.role !== 'NURSE' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot record vitals.' } });
    }
    const record = await this.recordInScope(id, user);
    const bmi = calculateBmi(dto.heightCm, dto.weightKg);
    const vitals = await this.prisma.vitalSign.create({
      data: {
        hospitalId: record.hospitalId,
        medicalRecordId: id,
        systolicBp: dto.systolicBp,
        diastolicBp: dto.diastolicBp,
        pulse: dto.pulse,
        temperatureCelsius: dto.temperatureCelsius,
        spo2: dto.spo2,
        heightCm: dto.heightCm,
        weightKg: dto.weightKg,
        bmi,
        recordedByUserId: user.userId,
      },
    });
    await this.audit.record({ userId: user.userId, hospitalId: record.hospitalId, action: 'emr.vitals', entityType: 'VitalSign', entityId: vitals.id, ipAddress: ip ?? null });
    return vitals;
  }

  async uploadAttachment(id: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, user: AuthContext, ip?: string | null) {
    if (user.role !== 'DOCTOR' && user.role !== 'NURSE' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot upload attachments.' } });
    }
    const record = await this.recordInScope(id, user);
    assertUpload(file.mimetype, file.originalname, file.size, ATTACHMENT_ALLOWED, ATTACHMENT_MAX_BYTES);
    const stored = await this.storage.save(`emr/${record.hospitalId}`, file.originalname, file.mimetype, file.buffer);
    const attachment = await this.prisma.medicalRecordAttachment.create({
      data: {
        hospitalId: record.hospitalId,
        medicalRecordId: id,
        fileName: file.originalname.slice(0, 128),
        storedPath: stored.storedPath,
        mimeType: file.mimetype,
        sizeBytes: stored.sizeBytes,
        uploadedByUserId: user.userId,
      },
    });
    await this.audit.record({ userId: user.userId, hospitalId: record.hospitalId, action: 'emr.attachment', entityType: 'MedicalRecordAttachment', entityId: attachment.id, ipAddress: ip ?? null, metadata: { mimeType: file.mimetype, sizeBytes: stored.sizeBytes } });
    return attachment;
  }

  private async prescriptionInScope(id: string, user: AuthContext) {
    const prescription = await this.prisma.prescription.findUnique({ where: { id }, include: { items: { include: { medicine: true } }, medicalRecord: true } });
    if (!prescription) {
      throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Prescription not found.' } });
    }
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access is denied.' } });
      }
      const ownRecord = await this.prisma.medicalRecord.findFirst({ where: { id: prescription.medicalRecordId, patientId: own.id } });
      if (!ownRecord) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only view your own prescriptions.' } });
      }
      return prescription;
    }
    if (user.role !== 'SUPER_ADMIN' && (!user.hospitalId || prescription.hospitalId !== user.hospitalId)) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
    }
    return prescription;
  }

  async createPrescription(dto: CreatePrescriptionDto, user: AuthContext, ip?: string | null) {
    if (user.role !== 'DOCTOR') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Only doctors can create prescriptions.' } });
    }
    const doctor = await this.ownDoctor(user);
    const record = await this.prisma.medicalRecord.findUnique({ where: { id: dto.medicalRecordId } });
    if (!record || record.hospitalId !== doctor.hospitalId || record.doctorId !== doctor.id) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Prescriptions must reference your own encounter.' } });
    }
    if (!dto.items || dto.items.length === 0) {
      throw new ForbiddenException({ success: false, error: { code: 'PRESCRIPTION_EMPTY', message: 'At least one medicine item is required.' } });
    }
    for (const item of dto.items) {
      if (!item.medicineId || !item.dosage?.trim() || !item.frequency?.trim() || !item.duration?.trim()) {
        throw new ForbiddenException({ success: false, error: { code: 'PRESCRIPTION_ITEM_INVALID', message: 'Dosage, frequency, and duration are required for every item.' } });
      }
      const medicine = await this.prisma.medicine.findUnique({ where: { id: item.medicineId } });
      if (!medicine || medicine.hospitalId !== doctor.hospitalId) {
        throw new ForbiddenException({ success: false, error: { code: 'MEDICINE_TENANT_MISMATCH', message: 'Medicine does not belong to this hospital.' } });
      }
    }
    const prescription = await this.prisma.prescription.create({
      data: {
        hospital: { connect: { id: doctor.hospitalId } },
        medicalRecord: { connect: { id: record.id } },
        notes: dto.notes,
        items: {
          create: dto.items.map((item) => ({
            hospital: { connect: { id: doctor.hospitalId } },
            medicine: { connect: { id: item.medicineId } },
            dosage: item.dosage,
            frequency: item.frequency,
            duration: item.duration,
            quantity: item.quantity,
            specialInstructions: item.specialInstructions,
          })),
        },
      },
      include: { items: { include: { medicine: true } } },
    });
    await this.audit.record({ userId: user.userId, hospitalId: doctor.hospitalId, action: 'prescription.create', entityType: 'Prescription', entityId: prescription.id, ipAddress: ip ?? null });
    const patient = await this.prisma.patient.findUnique({ where: { id: record.patientId }, include: { user: true } });
    await this.notifications.emit({
      hospitalId: doctor.hospitalId,
      type: 'PRESCRIPTION_READY',
      title: 'Prescription ready',
      body: `Your prescription from ${doctor.specialization} is ready at the pharmacy.`,
      entityType: 'Prescription',
      entityId: prescription.id,
      patientId: record.patientId,
      patientPhone: patient?.phone ?? patient?.user?.phone ?? undefined,
    }).catch(() => undefined);
    return prescription;
  }

  async getPrescription(id: string, user: AuthContext) {
    return this.prescriptionInScope(id, user);
  }

  async prescriptionsForPatient(patientId: string, user: AuthContext, page: { page: number; limit: number; skip: number }) {
    const records = await this.recordsForPatient(patientId, user, { page: 1, limit: 1000, skip: 0 });
    const recordIds = records.items.map((item) => item.id);
    const where: Prisma.PrescriptionWhereInput = { medicalRecordId: { in: recordIds } };
    const [items, total] = await Promise.all([
      this.prisma.prescription.findMany({ where, skip: page.skip, take: page.limit, orderBy: { issuedAt: 'desc' }, include: { items: { include: { medicine: true } } } }),
      this.prisma.prescription.count({ where }),
    ]);
    return { items, total };
  }

  async uploadSignature(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, user: AuthContext, ip?: string | null) {
    if (user.role !== 'DOCTOR') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Only doctors can upload signatures.' } });
    }
    const doctor = await this.ownDoctor(user);
    assertUpload(file.mimetype, file.originalname, file.size, SIGNATURE_ALLOWED, 2 * 1024 * 1024);
    const stored = await this.storage.save(`signatures/${doctor.hospitalId}`, file.originalname, file.mimetype, file.buffer);
    await this.prisma.doctor.update({ where: { id: doctor.id }, data: { signaturePath: stored.storedPath } });
    await this.audit.record({ userId: user.userId, hospitalId: doctor.hospitalId, action: 'doctor.signature', entityType: 'Doctor', entityId: doctor.id, ipAddress: ip ?? null, metadata: { mimeType: file.mimetype } });
    return { storedPath: stored.storedPath, sizeBytes: stored.sizeBytes };
  }

  async prescriptionPdf(id: string, user: AuthContext) {
    const prescription = await this.prescriptionInScope(id, user);
    const record = await this.prisma.medicalRecord.findUniqueOrThrow({ where: { id: prescription.medicalRecordId } });
    const [hospital, doctor, patient] = await Promise.all([
      this.prisma.hospital.findUniqueOrThrow({ where: { id: prescription.hospitalId } }),
      this.prisma.doctor.findUniqueOrThrow({ where: { id: record.doctorId } }),
      this.prisma.patient.findUniqueOrThrow({ where: { id: record.patientId } }),
    ]);
    const doctorUser = await this.prisma.user.findUnique({ where: { id: doctor.userId } });
    const pdf = await renderPrescriptionPdf({
      hospitalName: hospital.name,
      hospitalContact: [hospital.email, hospital.phone].filter(Boolean).join(' · ') || hospital.slug,
      doctorName: [doctorUser?.firstName, doctorUser?.lastName].filter(Boolean).join(' ') || doctorUser?.email || 'Treating doctor',
      doctorSpecialization: doctor.specialization,
      doctorLicense: doctor.licenseNumber,
      patientName: `${patient.firstName} ${patient.lastName}`,
      patientNumber: patient.patientNumber,
      issuedAt: prescription.issuedAt.toISOString().slice(0, 10),
      prescriptionId: prescription.id,
      notes: prescription.notes,
      items: prescription.items.map((item) => ({
        medicine: item.medicine.name,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        quantity: item.quantity?.toString() ?? null,
        instructions: item.specialInstructions,
      })),
      signed: Boolean(doctor.signaturePath),
    });
    await this.audit.record({ userId: user.userId, hospitalId: prescription.hospitalId, action: 'prescription.pdf', entityType: 'Prescription', entityId: id, ipAddress: null });
    return pdf;
  }
}
