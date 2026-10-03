import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { PrismaService } from './prisma/prisma.service';

async function loginAs(server: unknown, email: string, password: string): Promise<string> {
  const response = await request(server as never).post('/api/auth/login').send({ email, password }).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

describe('Phase 6 EMR integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  let hospitalAId = '';
  let superToken = '';
  let adminAToken = '';
  let doctorToken = '';
  let patientToken = '';
  let otherPatientToken = '';
  let appointmentId = '';
  let recordId = '';
  let prescriptionId = '';
  let patientAId = '';
  let otherPatientId = '';
  let medicineId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const hospitalA = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'northstar-demo' } });
    hospitalAId = hospitalA.id;

    const superEmail = `phase6-super-${runId}@example.test`;
    await prisma.user.create({ data: { email: superEmail, passwordHash: await bcrypt.hash('Sup3r!Strong1', 12), role: 'SUPER_ADMIN', hospitalId: null } });
    superToken = await loginAs(app.getHttpServer(), superEmail, 'Sup3r!Strong1');

    const adminEmail = `phase6-admin-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: adminEmail, password: 'Adm1n!Strong1', role: 'HOSPITAL_ADMIN', hospitalId: hospitalAId }).expect(201);
    adminAToken = await loginAs(app.getHttpServer(), adminEmail, 'Adm1n!Strong1');

    const department = await request(app.getHttpServer()).post(`/api/hospitals/${hospitalAId}/departments`)
      .set('Authorization', `Bearer ${adminAToken}`).send({ name: `Phase6 Dept ${runId}`, code: `P6${String(runId).slice(-6)}` }).expect(201);

    const doctorEmail = `phase6-doctor-${runId}@example.test`;
    const doctor = await request(app.getHttpServer()).post('/api/doctors').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, email: doctorEmail, licenseNumber: `P6D-${runId}`, specialization: 'General Medicine', consultationFee: 80, departmentIds: [department.body.data.id] }).expect(201);
    await prisma.user.update({ where: { email: doctorEmail }, data: { passwordHash: await bcrypt.hash('D0ct!Strong1', 12) } });
    doctorToken = await loginAs(app.getHttpServer(), doctorEmail, 'D0ct!Strong1');

    const patientAEmail = `phase6-patient-a-${runId}@example.test`;
    const patientA = await request(app.getHttpServer()).post('/api/patients').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, firstName: 'Phase6A', lastName: `Runner${runId}`, email: patientAEmail, password: 'Pat1ent!Strong' }).expect(201);
    patientAId = patientA.body.data.id;
    patientToken = await loginAs(app.getHttpServer(), patientAEmail, 'Pat1ent!Strong');

    const patientBEmail = `phase6-patient-b-${runId}@example.test`;
    const patientB = await request(app.getHttpServer()).post('/api/patients').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, firstName: 'Phase6B', lastName: `Runner${runId}`, email: patientBEmail, password: 'Pat1ent!Strong' }).expect(201);
    otherPatientId = patientB.body.data.id;
    otherPatientToken = await loginAs(app.getHttpServer(), patientBEmail, 'Pat1ent!Strong');

    const startsAt = new Date(Date.now() + 2 * 3600_000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    const appointment = await prisma.appointment.create({
      data: { hospitalId: hospitalAId, patientId: patientAId, doctorId: doctor.body.data.id, departmentId: department.body.data.id, startsAt, endsAt, status: 'IN_PROGRESS' },
    });
    appointmentId = appointment.id;
    const medicine = await prisma.medicine.findFirstOrThrow({ where: { hospitalId: hospitalAId } });
    medicineId = medicine.id;
  }, 90000);

  afterAll(async () => {
    await app?.close();
  });

  it('1. Doctor can create EMR for own appointment', async () => {
    const response = await request(app.getHttpServer()).post('/api/medical-records').set('Authorization', `Bearer ${doctorToken}`)
      .send({ appointmentId, chiefComplaint: 'Fever', diagnosis: 'Viral fever', clinicalNotes: 'Rest advised.' }).expect(201);
    recordId = response.body.data.id;
    expect(response.body.data.appointmentId).toBe(appointmentId);
  });

  it('2. Unauthorized role cannot create EMR', async () => {
    await request(app.getHttpServer()).post('/api/medical-records').set('Authorization', `Bearer ${patientToken}`)
      .send({ appointmentId }).expect(403);
  });

  it('3. Doctor cannot create EMR for another hospital appointment', async () => {
    const otherAppointment = await prisma.appointment.findFirstOrThrow({ where: { hospitalId: { not: hospitalAId } } });
    await request(app.getHttpServer()).post('/api/medical-records').set('Authorization', `Bearer ${doctorToken}`)
      .send({ appointmentId: otherAppointment.id }).expect(403);
  });

  it('4-5. Patient isolation: other denied, own allowed', async () => {
    await request(app.getHttpServer()).get(`/api/medical-records/${recordId}`).set('Authorization', `Bearer ${otherPatientToken}`).expect(403);
    const own = await request(app.getHttpServer()).get(`/api/medical-records/${recordId}`).set('Authorization', `Bearer ${patientToken}`).expect(200);
    expect(own.body.data.diagnosis).toBe('Viral fever');
  });

  it('6. Medical record cannot be hard deleted (no route)', async () => {
    await request(app.getHttpServer()).delete(`/api/medical-records/${recordId}`).set('Authorization', `Bearer ${doctorToken}`).expect(404);
    const stillThere = await prisma.medicalRecord.findUnique({ where: { id: recordId } });
    expect(stillThere).toBeTruthy();
  });

  it('7-8. BMI calculated; invalid vitals rejected', async () => {
    const vitals = await request(app.getHttpServer()).post(`/api/medical-records/${recordId}/vitals`).set('Authorization', `Bearer ${doctorToken}`)
      .send({ heightCm: 170, weightKg: 70, systolicBp: 120, diastolicBp: 80, pulse: 72, temperatureCelsius: 37, spo2: 98 }).expect(201);
    expect(Number(vitals.body.data.bmi)).toBeCloseTo(24.2, 1);
    await request(app.getHttpServer()).post(`/api/medical-records/${recordId}/vitals`).set('Authorization', `Bearer ${doctorToken}`)
      .send({ systolicBp: 500 }).expect(400);
  });

  it('9. Diagnosis is encrypted at rest', async () => {
    const raw = await prisma.medicalRecord.findUniqueOrThrow({ where: { id: recordId } });
    expect(raw.diagnosis).not.toBe('Viral fever');
    expect(raw.diagnosis?.startsWith('gcm:')).toBe(true);
    expect(JSON.stringify(raw)).toBeTruthy();
  });

  it('10-11. Oversize and disallowed attachments rejected', async () => {
    const oversize = await request(app.getHttpServer()).post(`/api/medical-records/${recordId}/attachments`).set('Authorization', `Bearer ${doctorToken}`)
      .attach('file', Buffer.alloc(21 * 1024 * 1024, 1), { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(oversize.status).toBeGreaterThanOrEqual(400);
    await request(app.getHttpServer()).post(`/api/medical-records/${recordId}/attachments`).set('Authorization', `Bearer ${doctorToken}`)
      .attach('file', Buffer.from('MZ fake'), { filename: 'evil.exe', contentType: 'application/octet-stream' }).expect(403);
  });

  it('12. Valid attachment stored via abstraction', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const response = await request(app.getHttpServer()).post(`/api/medical-records/${recordId}/attachments`).set('Authorization', `Bearer ${doctorToken}`)
      .attach('file', png, { filename: 'scan.png', contentType: 'image/png' }).expect(201);
    expect(response.body.data.storedPath).toBeDefined();
    expect(response.body.data.mimeType).toBe('image/png');
  });

  it('13-14. Doctor creates prescription; cross-hospital medicine rejected', async () => {
    const response = await request(app.getHttpServer()).post('/api/prescriptions').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, notes: 'Take with food', items: [{ medicineId, dosage: '500mg', frequency: 'Twice daily', duration: '7 days', quantity: 14 }] }).expect(201);
    prescriptionId = response.body.data.id;
    const otherMedicine = await prisma.medicine.findFirstOrThrow({ where: { hospitalId: { not: hospitalAId } } });
    await request(app.getHttpServer()).post('/api/prescriptions').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, items: [{ medicineId: otherMedicine.id, dosage: '500mg', frequency: 'Daily', duration: '7 days' }] }).expect(403);
  });

  it('15-16. Patient cannot create prescription; items validated', async () => {
    await request(app.getHttpServer()).post('/api/prescriptions').set('Authorization', `Bearer ${patientToken}`)
      .send({ medicalRecordId: recordId, items: [{ medicineId, dosage: '500mg', frequency: 'Daily', duration: '7 days' }] }).expect(403);
    await request(app.getHttpServer()).post('/api/prescriptions').set('Authorization', `Bearer ${doctorToken}`)
      .send({ medicalRecordId: recordId, items: [{ medicineId, dosage: '', frequency: 'Daily', duration: '7 days' }] }).expect(403);
  });

  it('17. Signature upload validation works', async () => {
    await request(app.getHttpServer()).post('/api/doctors/me/signature').set('Authorization', `Bearer ${doctorToken}`)
      .attach('file', Buffer.from('MZ'), { filename: 'sig.exe', contentType: 'application/octet-stream' }).expect(403);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>Dr</text></svg>');
    await request(app.getHttpServer()).post('/api/doctors/me/signature').set('Authorization', `Bearer ${doctorToken}`)
      .attach('file', svg, { filename: 'signature.svg', contentType: 'image/svg+xml' }).expect(201);
  });

  it('18. Prescription PDF generated successfully', async () => {
    const response = await request(app.getHttpServer()).get(`/api/prescriptions/${prescriptionId}/pdf`).set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(Number(response.headers['content-length'] ?? response.body.length ?? 1)).toBeGreaterThan(500);
  });

  it('19. Unauthorized user cannot download another patient PDF', async () => {
    await request(app.getHttpServer()).get(`/api/prescriptions/${prescriptionId}/pdf`).set('Authorization', `Bearer ${otherPatientToken}`).expect(403);
  });

  it('20. Audit records created for important writes', async () => {
    const count = await prisma.auditLog.count({ where: { entityId: recordId } });
    expect(count).toBeGreaterThanOrEqual(1);
    const rxCount = await prisma.auditLog.count({ where: { entityId: prescriptionId } });
    expect(rxCount).toBeGreaterThanOrEqual(1);
    void patientAId;
    void otherPatientId;
  });
});
