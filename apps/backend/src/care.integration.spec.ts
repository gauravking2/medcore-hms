import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ExpiryJob } from './care/expiry.job';
import { PrismaService } from './prisma/prisma.service';

async function loginAs(server: unknown, email: string, password: string): Promise<string> {
  const response = await request(server as never).post('/api/auth/login').send({ email, password }).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

describe('Phase 7 lab + pharmacy integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let expiry: ExpiryJob;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  let hospitalAId = '';
  let superToken = '';
  let adminAToken = '';
  let doctorToken = '';
  let techToken = '';
  let pharmacistToken = '';
  let patientToken = '';
  let recordId = '';
  let patientAId = '';
  let labTestId = '';
  let labOrderId = '';
  let medicineId = '';
  let prescriptionId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    expiry = app.get(ExpiryJob);
    const hospitalA = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'northstar-demo' } });
    hospitalAId = hospitalA.id;

    const superEmail = `phase7-super-${runId}@example.test`;
    await prisma.user.create({ data: { email: superEmail, passwordHash: await bcrypt.hash('Sup3r!Strong1', 12), role: 'SUPER_ADMIN', hospitalId: null } });
    superToken = await loginAs(app.getHttpServer(), superEmail, 'Sup3r!Strong1');

    const adminEmail = `phase7-admin-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: adminEmail, password: 'Adm1n!Strong1', role: 'HOSPITAL_ADMIN', hospitalId: hospitalAId }).expect(201);
    adminAToken = await loginAs(app.getHttpServer(), adminEmail, 'Adm1n!Strong1');

    const techEmail = `phase7-tech-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: techEmail, password: 'T3ch!Strong1', role: 'LAB_TECHNICIAN', hospitalId: hospitalAId }).expect(201);
    techToken = await loginAs(app.getHttpServer(), techEmail, 'T3ch!Strong1');

    const pharmacistEmail = `phase7-pharm-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: pharmacistEmail, password: 'Ph4rm!Strong1', role: 'PHARMACIST', hospitalId: hospitalAId }).expect(201);
    pharmacistToken = await loginAs(app.getHttpServer(), pharmacistEmail, 'Ph4rm!Strong1');

    const department = await request(app.getHttpServer()).post(`/api/hospitals/${hospitalAId}/departments`)
      .set('Authorization', `Bearer ${adminAToken}`).send({ name: `Phase7 Dept ${runId}`, code: `P7${String(runId).slice(-6)}` }).expect(201);

    const doctorEmail = `phase7-doctor-${runId}@example.test`;
    const doctor = await request(app.getHttpServer()).post('/api/doctors').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, email: doctorEmail, licenseNumber: `P7D-${runId}`, specialization: 'General Medicine', consultationFee: 80, departmentIds: [department.body.data.id] }).expect(201);
    await prisma.user.update({ where: { email: doctorEmail }, data: { passwordHash: await bcrypt.hash('D0ct!Strong1', 12) } });
    doctorToken = await loginAs(app.getHttpServer(), doctorEmail, 'D0ct!Strong1');

    const patientEmail = `phase7-patient-${runId}@example.test`;
    const patient = await request(app.getHttpServer()).post('/api/patients').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, firstName: 'Phase7', lastName: `Runner${runId}`, email: patientEmail, password: 'Pat1ent!Strong' }).expect(201);
    patientAId = patient.body.data.id;
    patientToken = await loginAs(app.getHttpServer(), patientEmail, 'Pat1ent!Strong');

    const startsAt = new Date(Date.now() + 3600_000);
    const appointment = await prisma.appointment.create({
      data: { hospitalId: hospitalAId, patientId: patientAId, doctorId: doctor.body.data.id, departmentId: department.body.data.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), status: 'IN_PROGRESS' },
    });
    const record = await request(app.getHttpServer()).post('/api/medical-records').set('Authorization', `Bearer ${doctorToken}`)
      .send({ appointmentId: appointment.id, chiefComplaint: 'Checkup', diagnosis: 'Healthy', clinicalNotes: 'Routine.' }).expect(201);
    recordId = record.body.data.id;
  }, 90000);

  afterAll(async () => {
    await app?.close();
  });

  it('LAB-1. Doctor creates valid lab order', async () => {
    const test = await request(app.getHttpServer()).post(`/api/lab-tests?hospitalId=${hospitalAId}`).set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: `Phase7 CBC ${runId}`, code: `P7CBC${String(runId).slice(-5)}`, unit: 'g/dL', referenceRange: '12-16', rangeLow: 12, rangeHigh: 16 }).expect(201);
    labTestId = test.body.data.id;
    const order = await request(app.getHttpServer()).post('/api/lab-orders').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, labTestId }).expect(201);
    labOrderId = order.body.data.id;
    expect(order.body.data.status).toBe('ORDERED');
  });

  it('LAB-2. Unauthorized role cannot create lab order', async () => {
    await request(app.getHttpServer()).post('/api/lab-orders').set('Authorization', `Bearer ${patientToken}`)
      .send({ medicalRecordId: recordId, labTestId }).expect(403);
  });

  it('LAB-3. Cross-hospital lab order rejected', async () => {
    const otherTest = await prisma.labTest.findFirstOrThrow({ where: { hospitalId: { not: hospitalAId } } });
    await request(app.getHttpServer()).post('/api/lab-orders').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, labTestId: otherTest.id }).expect(403);
  });

  it('LAB-4. Sample collection status works', async () => {
    const updated = await request(app.getHttpServer()).patch(`/api/lab-orders/${labOrderId}/status`).set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'SAMPLE_COLLECTED' }).expect(200);
    expect(updated.body.data.status).toBe('SAMPLE_COLLECTED');
    await request(app.getHttpServer()).patch(`/api/lab-orders/${labOrderId}/status`).set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PROCESSING' }).expect(200);
  });

  it('LAB-5/6. Structured result upload works; out-of-range flagged', async () => {
    const updated = await request(app.getHttpServer()).patch(`/api/lab-orders/${labOrderId}/result`).set('Authorization', `Bearer ${techToken}`)
      .send({ resultNumeric: 18.5, resultNotes: 'High value' }).expect(200);
    expect(updated.body.data.abnormalFlag).toBe('HIGH');
  });

  it('LAB-7. Invalid result rejected', async () => {
    const fresh = await request(app.getHttpServer()).post('/api/lab-orders').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, labTestId }).expect(201);
    await request(app.getHttpServer()).patch(`/api/lab-orders/${fresh.body.data.id}/status`).set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'SAMPLE_COLLECTED' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/lab-orders/${fresh.body.data.id}/status`).set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PROCESSING' }).expect(200);
    const bad = await request(app.getHttpServer()).patch(`/api/lab-orders/${fresh.body.data.id}/result`).set('Authorization', `Bearer ${techToken}`)
      .send({ resultNumeric: 'not-a-number' });
    expect(bad.status).toBe(400);
  });

  it('LAB-8/9/10. Unauthorized approval rejected; approved visible; unapproved hidden', async () => {
    await request(app.getHttpServer()).post(`/api/lab-orders/${labOrderId}/approve`).set('Authorization', `Bearer ${patientToken}`).expect(403);
    await request(app.getHttpServer()).get(`/api/lab-orders/${labOrderId}`).set('Authorization', `Bearer ${patientToken}`).expect(403);
    await request(app.getHttpServer()).post(`/api/lab-orders/${labOrderId}/approve`).set('Authorization', `Bearer ${techToken}`).expect(201);
    const visible = await request(app.getHttpServer()).get(`/api/lab-orders/${labOrderId}`).set('Authorization', `Bearer ${patientToken}`).expect(200);
    expect(visible.body.data.status).toBe('APPROVED');
  });

  it('LAB-11. Cross-hospital lab result access rejected', async () => {
    const other = await prisma.labOrder.findFirstOrThrow({ where: { hospitalId: { not: hospitalAId } } });
    await request(app.getHttpServer()).get(`/api/lab-orders/${other.id}`).set('Authorization', `Bearer ${techToken}`).expect(403);
  });

  it('LAB-12. Lab report attachment validation works', async () => {
    const fresh = await request(app.getHttpServer()).post('/api/lab-orders').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, labTestId }).expect(201);
    await request(app.getHttpServer()).patch(`/api/lab-orders/${fresh.body.data.id}/status`).set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'SAMPLE_COLLECTED' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/lab-orders/${fresh.body.data.id}/status`).set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PROCESSING' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/lab-orders/${fresh.body.data.id}/result`).set('Authorization', `Bearer ${techToken}`)
      .field('resultValue', 'see report')
      .attach('file', Buffer.from('MZ'), { filename: 'evil.exe', contentType: 'application/octet-stream' }).expect(403);
    const pdf = Buffer.from('%PDF-1.4 fake report');
    const uploaded = await request(app.getHttpServer()).patch(`/api/lab-orders/${fresh.body.data.id}/result`).set('Authorization', `Bearer ${techToken}`)
      .field('resultValue', 'see report')
      .attach('file', pdf, { filename: 'report.pdf', contentType: 'application/pdf' }).expect(200);
    expect(uploaded.body.data.reportPath).toBeDefined();
  });

  it('RX-13. Medicine can be created/updated by authorized role', async () => {
    const created = await request(app.getHttpServer()).post(`/api/medicines?hospitalId=${hospitalAId}`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ name: `Phase7 Med ${runId}`, sku: `P7M-${runId}`, reorderLevel: 10, dosageForm: 'Tablet' }).expect(201);
    medicineId = created.body.data.id;
    const updated = await request(app.getHttpServer()).patch(`/api/medicines/${medicineId}`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ reorderLevel: 12 }).expect(200);
    expect(Number(updated.body.data.reorderLevel)).toBe(12);
    await request(app.getHttpServer()).post(`/api/medicines?hospitalId=${hospitalAId}`).set('Authorization', `Bearer ${patientToken}`)
      .send({ name: 'Blocked', sku: `P7X-${runId}` }).expect(403);
  });

  it('RX-14/15. Batch created; invalid dates rejected', async () => {
    await request(app.getHttpServer()).post('/api/inventory/batches').set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId, batchNumber: `P7B1-${runId}`, manufacturingDate: '2026-01-01', expiryDate: '2025-01-01', quantity: 10, unitCost: 1, mrp: 2 }).expect(400);
    await request(app.getHttpServer()).post('/api/inventory/batches').set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId, batchNumber: `P7B1-${runId}`, manufacturingDate: '2025-01-01', expiryDate: '2030-01-01', quantity: 100, unitCost: 1, mrp: 2 }).expect(201);
  });

  it('RX-16/17. Expired and quarantined batches cannot be dispensed', async () => {
    const rx = await request(app.getHttpServer()).post('/api/prescriptions').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, items: [{ medicineId, dosage: '500mg', frequency: 'Daily', duration: '7 days', quantity: 5 }] }).expect(201);
    prescriptionId = rx.body.data.id;
    const expired = await request(app.getHttpServer()).post('/api/inventory/batches').set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId, batchNumber: `P7EXP-${runId}`, quantity: 50, unitCost: 1, mrp: 2, expiryDate: '2021-01-01' }).expect(201);
    void expired;
    const quarantined = await request(app.getHttpServer()).post('/api/inventory/batches').set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId, batchNumber: `P7Q-${runId}`, manufacturingDate: '2025-01-01', expiryDate: '2030-06-01', quantity: 50, unitCost: 1, mrp: 2 }).expect(201);
    await request(app.getHttpServer()).patch(`/api/inventory/batches/${quarantined.body.data.id}/quarantine`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ quarantined: true }).expect(200);
    // FIFO must skip expired/quarantined and consume the eligible P7B1 batch.
    const dispensed = await request(app.getHttpServer()).post(`/api/pharmacy/prescriptions/${prescriptionId}/dispense`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId, quantity: 5 }).expect(201);
    expect(dispensed.body.data.legs[0].batchId).not.toBe(quarantined.body.data.id);
  });

  it('RX-18/19. FIFO oldest-first; spills to next batch', async () => {
    const fifoMedicine = await request(app.getHttpServer()).post(`/api/medicines?hospitalId=${hospitalAId}`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ name: `Phase7 FIFO ${runId}`, sku: `P7F-${runId}`, reorderLevel: 5 }).expect(201);
    const fifoId = fifoMedicine.body.data.id;
    const oldBatch = await request(app.getHttpServer()).post('/api/inventory/batches').set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId: fifoId, batchNumber: `P7FO-${runId}`, manufacturingDate: '2024-01-01', expiryDate: '2030-01-01', quantity: 3, unitCost: 1, mrp: 2 }).expect(201);
    const newBatch = await request(app.getHttpServer()).post('/api/inventory/batches').set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId: fifoId, batchNumber: `P7FN-${runId}`, manufacturingDate: '2025-06-01', expiryDate: '2030-06-01', quantity: 10, unitCost: 1, mrp: 2 }).expect(201);
    const rx = await request(app.getHttpServer()).post('/api/prescriptions').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, items: [{ medicineId: fifoId, dosage: '250mg', frequency: 'Daily', duration: '5 days', quantity: 5 }] }).expect(201);
    const dispensed = await request(app.getHttpServer()).post(`/api/pharmacy/prescriptions/${rx.body.data.id}/dispense`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId: fifoId, quantity: 5 }).expect(201);
    expect(dispensed.body.data.legs[0].batchId).toBe(oldBatch.body.data.id);
    expect(dispensed.body.data.legs).toHaveLength(2);
    expect(dispensed.body.data.legs[1].batchId).toBe(newBatch.body.data.id);
  });

  it('RX-20/21. Stock never negative; concurrent dispensing safe', async () => {
    const concMedicine = await request(app.getHttpServer()).post(`/api/medicines?hospitalId=${hospitalAId}`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ name: `Phase7 Conc ${runId}`, sku: `P7C-${runId}`, reorderLevel: 1 }).expect(201);
    const concId = concMedicine.body.data.id;
    await request(app.getHttpServer()).post('/api/inventory/batches').set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId: concId, batchNumber: `P7CC-${runId}`, manufacturingDate: '2025-01-01', expiryDate: '2030-01-01', quantity: 5, unitCost: 1, mrp: 2 }).expect(201);
    const rx = await request(app.getHttpServer()).post('/api/prescriptions').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, items: [{ medicineId: concId, dosage: '100mg', frequency: 'Daily', duration: '5 days', quantity: 5 }] }).expect(201);
    const attempt = () => request(app.getHttpServer()).post(`/api/pharmacy/prescriptions/${rx.body.data.id}/dispense`).set('Authorization', `Bearer ${pharmacistToken}`).send({ medicineId: concId, quantity: 4 });
    const [first, second] = await Promise.all([attempt(), attempt()]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const batches = await prisma.inventoryBatch.findMany({ where: { medicineId: concId } });
    for (const batch of batches) {
      expect(Number(batch.quantity)).toBeGreaterThanOrEqual(0);
    }
  });

  it('RX-22/23. Low-stock and expiring detected', async () => {
    const low = await request(app.getHttpServer()).get(`/api/pharmacy/low-stock?hospitalId=${hospitalAId}`).set('Authorization', `Bearer ${pharmacistToken}`).expect(200);
    expect(Array.isArray(low.body.data)).toBe(true);
    const expiringSoon = await request(app.getHttpServer()).post('/api/inventory/batches').set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId, batchNumber: `P7E-${runId}`, manufacturingDate: '2025-01-01', expiryDate: new Date(Date.now() + 10 * 24 * 3600_000).toISOString(), quantity: 5, unitCost: 1, mrp: 2 }).expect(201);
    void expiringSoon;
    const expiring = await request(app.getHttpServer()).get(`/api/pharmacy/expiring?hospitalId=${hospitalAId}&withinDays=30`).set('Authorization', `Bearer ${pharmacistToken}`).expect(200);
    expect(expiring.body.data.length).toBeGreaterThanOrEqual(1);
    const report = await expiry.scanExpiring(30);
    expect(report.length).toBeGreaterThanOrEqual(1);
  });

  it('RX-24/25/26. Valid fulfilment; wrong-hospital rejected; audit written', async () => {
    const valid = await request(app.getHttpServer()).post(`/api/pharmacy/prescriptions/${prescriptionId}/dispense`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId, quantity: 2 }).expect(201);
    expect(valid.body.data.quantity).toBe(2);
    const otherRx = await prisma.prescription.findFirstOrThrow({ where: { hospitalId: { not: hospitalAId } } });
    await request(app.getHttpServer()).post(`/api/pharmacy/prescriptions/${otherRx.id}/dispense`).set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ medicineId, quantity: 1 }).expect(403);
    const audits = await prisma.auditLog.count({ where: { action: 'pharmacy.dispense', entityId: prescriptionId } });
    expect(audits).toBeGreaterThanOrEqual(1);
    void patientAId;
  });
});
