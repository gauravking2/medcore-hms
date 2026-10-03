import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LabOrderStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateBatchDto, CreateLabOrderDto, CreateLabTestDto, CreateMedicineDto, DispenseDto, UpdateLabTestDto, UpdateMedicineDto, UploadLabResultDto } from './care.dto';
import { ExpiryJob } from './expiry.job';
import { assertLabTransition, flagForValue } from './lab-lifecycle';

const LAB_REPORT_MAX_BYTES = 10 * 1024 * 1024;
const LAB_REPORT_ALLOWED = new Map<string, string[]>([['application/pdf', ['.pdf']]]);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

function isSerializationFailure(error: unknown): boolean {
  // Postgres aborts one Serializable writer with SQLSTATE 40001; Prisma
  // surfaces it as P2034 (or the raw message for $queryRaw paths).
  const code = (error as NodeJS.ErrnoException)?.code;
  const message = (error as Error)?.message ?? '';
  return code === 'P2034' || message.includes('40001') || message.includes('could not serialize');
}

@Injectable()
export class CareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly expiry: ExpiryJob,
    private readonly notifications: NotificationsService,
  ) {}

  private assertSameHospital(user: AuthContext, hospitalId: string) {
    if (user.role !== 'SUPER_ADMIN' && user.hospitalId !== hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
    }
  }

  // ---------- Lab catalog ----------
  async createLabTest(dto: CreateLabTestDto, user: AuthContext, hospitalId: string, ip?: string | null) {
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'LAB_TECHNICIAN'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot manage lab tests.' } });
    }
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) throw new ForbiddenException({ success: false, error: { code: 'NO_HOSPITAL_SCOPE', message: 'No hospital scope.' } });
    this.assertSameHospital(user, scope);
    const test = await this.prisma.labTest.create({
      data: { hospitalId: scope, name: dto.name, code: dto.code, description: dto.description, unit: dto.unit, referenceRange: dto.referenceRange, rangeLow: dto.rangeLow, rangeHigh: dto.rangeHigh },
    });
    await this.audit.record({ userId: user.userId, hospitalId: scope, action: 'lab-test.create', entityType: 'LabTest', entityId: test.id, ipAddress: ip ?? null });
    return test;
  }

  async listLabTests(user: AuthContext, hospitalId: string | undefined, page: { page: number; limit: number; skip: number; search?: string }) {
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const where: Prisma.LabTestWhereInput = { hospitalId: scope };
    if (page.search) where.OR = [{ name: { contains: page.search, mode: 'insensitive' } }, { code: { contains: page.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      this.prisma.labTest.findMany({ where, skip: page.skip, take: page.limit, orderBy: { name: 'asc' } }),
      this.prisma.labTest.count({ where }),
    ]);
    return { items, total };
  }

  async updateLabTest(id: string, dto: UpdateLabTestDto, user: AuthContext, ip?: string | null) {
    const test = await this.prisma.labTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Lab test not found.' } });
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'LAB_TECHNICIAN'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot manage lab tests.' } });
    }
    this.assertSameHospital(user, test.hospitalId);
    const updated = await this.prisma.labTest.update({ where: { id }, data: { ...dto } });
    await this.audit.record({ userId: user.userId, hospitalId: test.hospitalId, action: 'lab-test.update', entityType: 'LabTest', entityId: id, ipAddress: ip ?? null });
    return updated;
  }

  // ---------- Lab orders ----------
  async createLabOrder(dto: CreateLabOrderDto, user: AuthContext, ip?: string | null) {
    if (user.role !== 'DOCTOR' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Only doctors can create lab orders.' } });
    }
    const record = await this.prisma.medicalRecord.findUnique({ where: { id: dto.medicalRecordId } });
    if (!record) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Medical record not found.' } });
    const test = await this.prisma.labTest.findUnique({ where: { id: dto.labTestId } });
    if (!test || test.hospitalId !== record.hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Lab test does not belong to this hospital.' } });
    }
    if (user.role === 'DOCTOR') {
      const doctor = await this.prisma.doctor.findUnique({ where: { userId: user.userId } });
      if (!doctor || doctor.id !== record.doctorId) {
        throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You can only order labs for your own encounters.' } });
      }
    } else {
      this.assertSameHospital(user, record.hospitalId);
    }
    const order = await this.prisma.labOrder.create({
      data: { hospitalId: record.hospitalId, medicalRecordId: record.id, patientId: record.patientId, labTestId: test.id, status: 'ORDERED' },
      include: { labTest: true },
    });
    await this.audit.record({ userId: user.userId, hospitalId: record.hospitalId, action: 'lab-order.create', entityType: 'LabOrder', entityId: order.id, ipAddress: ip ?? null });
    return order;
  }

  private async labOrderInScope(id: string, user: AuthContext, roles: string[]) {
    const order = await this.prisma.labOrder.findUnique({ where: { id }, include: { labTest: true, patient: true } });
    if (!order) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Lab order not found.' } });
    if (!roles.includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission for lab orders.' } });
    }
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== order.patientId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only view your own lab orders.' } });
      }
      return order;
    }
    this.assertSameHospital(user, order.hospitalId);
    return order;
  }

  async listLabOrders(user: AuthContext, query: { page: number; limit: number; skip: number; status?: string; patientId?: string; hospitalId?: string; search?: string }) {
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own) return { items: [], total: 0 };
      // Patients only see APPROVED results; unapproved rows stay hidden.
      const where: Prisma.LabOrderWhereInput = { patientId: own.id, status: 'APPROVED' };
      const [items, total] = await Promise.all([
        this.prisma.labOrder.findMany({ where, skip: query.skip, take: query.limit, orderBy: { orderedAt: 'desc' }, include: { labTest: true } }),
        this.prisma.labOrder.count({ where }),
      ]);
      return { items, total };
    }
    const scope = user.role === 'SUPER_ADMIN' ? query.hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const where: Prisma.LabOrderWhereInput = { hospitalId: scope };
    if (query.status) where.status = query.status as LabOrderStatus;
    if (query.patientId) where.patientId = query.patientId;
    if (query.search) where.labTest = { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] };
    const [items, total] = await Promise.all([
      this.prisma.labOrder.findMany({ where, skip: query.skip, take: query.limit, orderBy: { orderedAt: 'desc' }, include: { labTest: true, patient: true } }),
      this.prisma.labOrder.count({ where }),
    ]);
    return { items, total };
  }

  async getLabOrder(id: string, user: AuthContext) {
    if (user.role === 'PATIENT') {
      const order = await this.labOrderInScope(id, user, ['PATIENT']);
      if (order.status !== 'APPROVED') {
        throw new ForbiddenException({ success: false, error: { code: 'RESULT_NOT_READY', message: 'This result is not yet available.' } });
      }
      return order;
    }
    return this.labOrderInScope(id, user, ['DOCTOR', 'NURSE', 'LAB_TECHNICIAN', 'HOSPITAL_ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST']);
  }

  async updateLabOrderStatus(id: string, status: LabOrderStatus, user: AuthContext, ip?: string | null) {
    const order = await this.labOrderInScope(id, user, ['LAB_TECHNICIAN', 'DOCTOR', 'HOSPITAL_ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST']);
    if (status === 'APPROVED') {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Use the approval endpoint to approve results.' } });
    }
    assertLabTransition(order.status, status);
    const updated = await this.prisma.labOrder.update({ where: { id }, data: { status, collectedAt: status === 'SAMPLE_COLLECTED' ? new Date() : undefined } });
    await this.audit.record({ userId: user.userId, hospitalId: order.hospitalId, action: 'lab-order.status', entityType: 'LabOrder', entityId: id, ipAddress: ip ?? null, metadata: { from: order.status, to: status } });
    return updated;
  }

  async uploadLabResult(id: string, dto: UploadLabResultDto, file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, user: AuthContext, ip?: string | null) {
    const order = await this.labOrderInScope(id, user, ['LAB_TECHNICIAN', 'SUPER_ADMIN', 'HOSPITAL_ADMIN']);
    if (order.status !== 'PROCESSING' && order.status !== 'SAMPLE_COLLECTED') {
      throw new ForbiddenException({ success: false, error: { code: 'INVALID_LAB_TRANSITION', message: 'Results can only be uploaded while processing.' } });
    }
    if (dto.resultNumeric !== undefined && !Number.isFinite(dto.resultNumeric)) {
      const error = new Error('Numeric result is invalid.');
      (error as NodeJS.ErrnoException).code = 'INVALID_RESULT';
      throw error;
    }
    let reportPath: string | undefined;
    let reportMimeType: string | undefined;
    let reportSizeBytes: number | undefined;
    if (file) {
      if (file.size > LAB_REPORT_MAX_BYTES) {
        throw new ForbiddenException({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'Report exceeds the size limit.' } });
      }
      const extensions = LAB_REPORT_ALLOWED.get(file.mimetype);
      if (!extensions || !extensions.includes(extensionOf(file.originalname))) {
        throw new ForbiddenException({ success: false, error: { code: 'FILE_TYPE_DENIED', message: 'Only PDF lab reports are allowed.' } });
      }
      const stored = await this.storage.save(`lab/${order.hospitalId}`, file.originalname, file.mimetype, file.buffer);
      reportPath = stored.storedPath;
      reportMimeType = file.mimetype;
      reportSizeBytes = stored.sizeBytes;
    }
    const flag = dto.resultNumeric !== undefined
      ? flagForValue(dto.resultNumeric, order.labTest.rangeLow ? Number(order.labTest.rangeLow) : null, order.labTest.rangeHigh ? Number(order.labTest.rangeHigh) : null)
      : null;
    const updated = await this.prisma.labOrder.update({
      where: { id },
      data: {
        status: 'RESULT_UPLOADED',
        resultValue: dto.resultValue ?? (dto.resultNumeric !== undefined ? String(dto.resultNumeric) : undefined),
        resultNumeric: dto.resultNumeric,
        resultUnit: dto.resultUnit ?? order.labTest.unit,
        abnormalFlag: flag,
        resultNotes: dto.resultNotes,
        resultAt: new Date(),
        reportPath,
        reportMimeType,
        reportSizeBytes,
      },
    });
    await this.audit.record({ userId: user.userId, hospitalId: order.hospitalId, action: 'lab-order.result', entityType: 'LabOrder', entityId: id, ipAddress: ip ?? null, metadata: { abnormalFlag: flag } });
    return updated;
  }

  async approveLabOrder(id: string, user: AuthContext, ip?: string | null) {
    // Only senior lab roles approve: LAB_TECHNICIAN is the designated reviewer
    // here; DOCTOR/HOSPITAL_ADMIN/SUPER_ADMIN may countersign.
    const order = await this.labOrderInScope(id, user, ['LAB_TECHNICIAN', 'DOCTOR', 'HOSPITAL_ADMIN', 'SUPER_ADMIN']);
    if (order.status !== 'RESULT_UPLOADED') {
      throw new ForbiddenException({ success: false, error: { code: 'INVALID_LAB_TRANSITION', message: 'Only uploaded results can be approved.' } });
    }
    const updated = await this.prisma.labOrder.update({ where: { id }, data: { status: 'APPROVED', approvedByUserId: user.userId, approvedAt: new Date() } });
    await this.audit.record({ userId: user.userId, hospitalId: order.hospitalId, action: 'lab-order.approve', entityType: 'LabOrder', entityId: id, ipAddress: ip ?? null });
    const patient = await this.prisma.patient.findUnique({ where: { id: order.patientId }, include: { user: true } });
    await this.notifications.emit({
      hospitalId: order.hospitalId,
      type: 'LAB_APPROVED',
      title: 'Lab report ready',
      body: `Your ${order.labTest.name} report is ready for review.`,
      entityType: 'LabOrder',
      entityId: order.id,
      patientId: order.patientId,
      patientEmail: patient?.user?.email ?? undefined,
      patientPhone: patient?.phone ?? patient?.user?.phone ?? undefined,
    }).catch(() => undefined);
    return updated;
  }

  // ---------- Pharmacy ----------
  async createMedicine(dto: CreateMedicineDto, user: AuthContext, hospitalId: string, ip?: string | null) {
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'PHARMACIST'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot manage medicines.' } });
    }
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) throw new ForbiddenException({ success: false, error: { code: 'NO_HOSPITAL_SCOPE', message: 'No hospital scope.' } });
    this.assertSameHospital(user, scope);
    const medicine = await this.prisma.medicine.create({
      data: { hospitalId: scope, name: dto.name, genericName: dto.genericName, strength: dto.strength, dosageForm: dto.dosageForm, sku: dto.sku, reorderLevel: dto.reorderLevel ?? 0 },
    });
    await this.audit.record({ userId: user.userId, hospitalId: scope, action: 'medicine.create', entityType: 'Medicine', entityId: medicine.id, ipAddress: ip ?? null });
    return medicine;
  }

  async listMedicines(user: AuthContext, hospitalId: string | undefined, page: { page: number; limit: number; skip: number; search?: string }) {
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const where: Prisma.MedicineWhereInput = { hospitalId: scope };
    if (page.search) where.OR = [{ name: { contains: page.search, mode: 'insensitive' } }, { sku: { contains: page.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      this.prisma.medicine.findMany({ where, skip: page.skip, take: page.limit, orderBy: { name: 'asc' }, include: { batches: true } }),
      this.prisma.medicine.count({ where }),
    ]);
    return { items, total };
  }

  async getMedicine(id: string, user: AuthContext) {
    const medicine = await this.prisma.medicine.findUnique({ where: { id }, include: { batches: true } });
    if (!medicine) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Medicine not found.' } });
    this.assertSameHospital(user, medicine.hospitalId);
    return medicine;
  }

  async updateMedicine(id: string, dto: UpdateMedicineDto, user: AuthContext, ip?: string | null) {
    const medicine = await this.prisma.medicine.findUnique({ where: { id } });
    if (!medicine) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Medicine not found.' } });
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'PHARMACIST'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot manage medicines.' } });
    }
    this.assertSameHospital(user, medicine.hospitalId);
    const updated = await this.prisma.medicine.update({ where: { id }, data: { ...dto } });
    await this.audit.record({ userId: user.userId, hospitalId: medicine.hospitalId, action: 'medicine.update', entityType: 'Medicine', entityId: id, ipAddress: ip ?? null });
    return updated;
  }

  async createBatch(dto: CreateBatchDto, user: AuthContext, ip?: string | null) {
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'PHARMACIST'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot manage inventory.' } });
    }
    const medicine = await this.prisma.medicine.findUnique({ where: { id: dto.medicineId } });
    if (!medicine) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Medicine not found.' } });
    this.assertSameHospital(user, medicine.hospitalId);
    const expiry = new Date(dto.expiryDate);
    const manufacturing = dto.manufacturingDate ? new Date(dto.manufacturingDate) : null;
    if (Number.isNaN(expiry.getTime()) || (manufacturing && Number.isNaN(manufacturing.getTime()))) {
      const error = new Error('Batch dates are invalid.');
      (error as NodeJS.ErrnoException).code = 'INVALID_DATES';
      throw error;
    }
    if (manufacturing && !(expiry.getTime() > manufacturing.getTime())) {
      const error = new Error('Expiry must be after manufacturing date.');
      (error as NodeJS.ErrnoException).code = 'INVALID_DATES';
      throw error;
    }
    const batch = await this.prisma.inventoryBatch.create({
      data: { hospitalId: medicine.hospitalId, medicineId: medicine.id, batchNumber: dto.batchNumber, manufacturingDate: manufacturing, expiryDate: expiry, quantity: dto.quantity, unitCost: dto.unitCost, mrp: dto.mrp },
    });
    await this.prisma.inventoryLedger.create({
      data: { hospitalId: medicine.hospitalId, medicineId: medicine.id, batchId: batch.id, quantityDelta: dto.quantity, balanceAfter: dto.quantity, reason: 'BATCH_RECEIVED', userId: user.userId },
    });
    await this.audit.record({ userId: user.userId, hospitalId: medicine.hospitalId, action: 'inventory.batch-create', entityType: 'InventoryBatch', entityId: batch.id, ipAddress: ip ?? null });
    return batch;
  }

  async listInventory(user: AuthContext, hospitalId: string | undefined, page: { page: number; limit: number; skip: number; search?: string }) {
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const where: Prisma.InventoryBatchWhereInput = { hospitalId: scope };
    if (page.search) where.OR = [{ batchNumber: { contains: page.search, mode: 'insensitive' } }, { medicine: { name: { contains: page.search, mode: 'insensitive' } } }];
    const [items, total] = await Promise.all([
      this.prisma.inventoryBatch.findMany({ where, skip: page.skip, take: page.limit, orderBy: { expiryDate: 'asc' }, include: { medicine: true } }),
      this.prisma.inventoryBatch.count({ where }),
    ]);
    return { items, total };
  }

  async quarantineBatch(id: string, quarantined: boolean, user: AuthContext, ip?: string | null) {
    const batch = await this.prisma.inventoryBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Batch not found.' } });
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'PHARMACIST'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot quarantine batches.' } });
    }
    this.assertSameHospital(user, batch.hospitalId);
    const updated = await this.prisma.inventoryBatch.update({ where: { id }, data: { quarantined } });
    await this.audit.record({ userId: user.userId, hospitalId: batch.hospitalId, action: 'inventory.quarantine', entityType: 'InventoryBatch', entityId: id, ipAddress: ip ?? null, metadata: { quarantined } });
    return updated;
  }

  async lowStock(user: AuthContext, hospitalId: string | undefined) {
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const medicines = await this.prisma.medicine.findMany({ where: { hospitalId: scope }, include: { batches: true } });
    const items = medicines
      .map((medicine) => {
        const total = medicine.batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
        return { medicine, total };
      })
      .filter(({ medicine, total }) => total < Number(medicine.reorderLevel));
    return { items, total: items.length };
  }

  async expiring(user: AuthContext, hospitalId: string | undefined, withinDays = 30) {
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const horizon = new Date(Date.now() + withinDays * 24 * 3600_000);
    const items = await this.prisma.inventoryBatch.findMany({ where: { hospitalId: scope, expiryDate: { lte: horizon } }, orderBy: { expiryDate: 'asc' }, include: { medicine: true } });
    return { items, total: items.length };
  }

  async dispense(prescriptionId: string, dto: DispenseDto, user: AuthContext, ip?: string | null) {
    if (!['PHARMACIST', 'SUPER_ADMIN', 'HOSPITAL_ADMIN'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Only pharmacists can dispense.' } });
    }
    const prescription = await this.prisma.prescription.findUnique({ where: { id: prescriptionId }, include: { items: true } });
    if (!prescription) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Prescription not found.' } });
    this.assertSameHospital(user, prescription.hospitalId);
    const medicine = await this.prisma.medicine.findUnique({ where: { id: dto.medicineId } });
    if (!medicine || medicine.hospitalId !== prescription.hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'MEDICINE_TENANT_MISMATCH', message: 'Medicine does not belong to this hospital.' } });
    }
    const requested = Number(dto.quantity);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new ForbiddenException({ success: false, error: { code: 'INVALID_QUANTITY', message: 'Quantity must be positive.' } });
    }
    const now = new Date();
    // FIFO: oldest manufacturing date first, then earliest expiry. Expired or
    // quarantined batches are never eligible — enforced in the query itself.
    // The transaction runs at Serializable isolation, so a concurrent writer
    // can abort this transaction with a 40001 serialization failure instead
    // of reaching the stock check. Retrying is the textbook response: the
    // retry re-reads committed stock and reports a genuine shortage as 409.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await this.dispenseTransaction(prescription, medicine, requested, user, now);
        await this.audit.record({ userId: user.userId, hospitalId: prescription.hospitalId, action: 'pharmacy.dispense', entityType: 'Prescription', entityId: prescription.id, ipAddress: ip ?? null, metadata: { medicineId: medicine.id, quantity: requested, legs: result.length } });
        return { legs: result, quantity: requested };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'INSUFFICIENT_STOCK' || code === 'NEGATIVE_STOCK') throw error;
        if (!isSerializationFailure(error) || attempt >= 3) {
          if (isSerializationFailure(error)) throw await this.afterSerializationConflict(prescription.hospitalId, medicine.id, requested);
          throw error;
        }
      }
    }
  }

  private async remainingEligibleStock(hospitalId: string, medicineId: string, now: Date): Promise<number> {
    const batches = await this.prisma.inventoryBatch.findMany({
      where: { medicineId, hospitalId, quarantined: false, expiryDate: { gt: now }, quantity: { gt: 0 } },
      select: { quantity: true },
    });
    return batches.reduce((total, batch) => total + Number(batch.quantity), 0);
  }

  private async afterSerializationConflict(hospitalId: string, medicineId: string, requested: number) {
    // Retries exhausted under sustained contention. Re-read committed stock:
    // a genuine shortage is 409 INSUFFICIENT_STOCK; otherwise report the
    // contention itself as 409 so concurrent writers never surface a 500.
    const available = await this.remainingEligibleStock(hospitalId, medicineId, new Date());
    if (available < requested) {
      const error = new Error('Insufficient stock to fulfil this quantity.');
      (error as NodeJS.ErrnoException).code = 'INSUFFICIENT_STOCK';
      return error;
    }
    return new ConflictException({ success: false, error: { code: 'CONCURRENT_UPDATE_CONFLICT', message: 'Another update is in progress. Please retry.' } });
  }

  private async dispenseTransaction(
    prescription: { id: string; hospitalId: string },
    medicine: { id: string },
    requested: number,
    user: AuthContext,
    now: Date,
  ): Promise<Array<{ batchId: string; quantity: number; balanceAfter: number }>> {
    return this.prisma.$transaction(async (tx) => {
        const batches = await tx.inventoryBatch.findMany({
          where: { medicineId: medicine.id, hospitalId: prescription.hospitalId, quarantined: false, expiryDate: { gt: now }, quantity: { gt: 0 } },
          orderBy: [{ manufacturingDate: 'asc' }, { expiryDate: 'asc' }, { createdAt: 'asc' }],
        });
        let remaining = requested;
        const legs: Array<{ batchId: string; quantity: number; balanceAfter: number }> = [];
        for (const batch of batches) {
          if (remaining <= 0) break;
          const available = Number(batch.quantity);
          if (available <= 0) continue;
          const take = Math.min(available, remaining);
          // Row-level lock: re-read inside the transaction to serialize writers.
          const locked = await tx.$queryRaw<Array<{ quantity: string }>>`SELECT quantity FROM "InventoryBatch" WHERE id = ${batch.id} FOR UPDATE`;
          const lockedQty = Number(locked[0]?.quantity ?? 0);
          if (lockedQty < take) {
            const error = new Error('Insufficient stock after concurrent dispense.');
            (error as NodeJS.ErrnoException).code = 'INSUFFICIENT_STOCK';
            throw error;
          }
          const updated = await tx.inventoryBatch.update({ where: { id: batch.id }, data: { quantity: lockedQty - take } });
          legs.push({ batchId: batch.id, quantity: take, balanceAfter: Number(updated.quantity) });
          remaining = Math.round((remaining - take) * 100) / 100;
        }
        if (remaining > 0.0001) {
          const error = new Error('Insufficient stock to fulfil this quantity.');
          (error as NodeJS.ErrnoException).code = 'INSUFFICIENT_STOCK';
          throw error;
        }
        // Defensive: quantities can never go negative even under races.
        for (const leg of legs) {
          if (leg.balanceAfter < -0.0001) {
            const error = new Error('Stock would go negative.');
            (error as NodeJS.ErrnoException).code = 'NEGATIVE_STOCK';
            throw error;
          }
          await tx.dispensation.create({
            data: { hospitalId: prescription.hospitalId, prescriptionId: prescription.id, medicineId: medicine.id, batchId: leg.batchId, quantity: leg.quantity, dispensedByUserId: user.userId },
          });
          await tx.inventoryLedger.create({
            data: { hospitalId: prescription.hospitalId, medicineId: medicine.id, batchId: leg.batchId, quantityDelta: -leg.quantity, balanceAfter: leg.balanceAfter, reason: 'DISPENSED', userId: user.userId },
          });
        }
        return legs;
      }, { isolationLevel: 'Serializable' });
  }

  async validPrescriptions(user: AuthContext, hospitalId: string | undefined, page: { page: number; limit: number; skip: number }) {
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const where: Prisma.PrescriptionWhereInput = { hospitalId: scope };
    const [items, total] = await Promise.all([
      this.prisma.prescription.findMany({ where, skip: page.skip, take: page.limit, orderBy: { issuedAt: 'desc' }, include: { items: { include: { medicine: true } } } }),
      this.prisma.prescription.count({ where }),
    ]);
    return { items, total };
  }

  async expiryReport(user: AuthContext, hospitalId: string | undefined, withinDays = 30) {
    const scope = user.role === 'SUPER_ADMIN' ? hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const findings = await this.expiry.scanExpiring(withinDays);
    const scoped = findings.filter((finding) => finding.hospitalId === scope);
    return { items: scoped, total: scoped.length };
  }
}
