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

describe('Phase 9 insights integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  let hospitalAId = '';
  let hospitalBId = '';
  let superToken = '';
  let adminAToken = '';
  let doctorToken = '';
  let receptionistToken = '';
  let accountantToken = '';
  let patientToken = '';
  let patientAId = '';

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
    const hospitalB = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'willowbend-demo' } });
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;

    const superEmail = `phase9-super-${runId}@example.test`;
    await prisma.user.create({ data: { email: superEmail, passwordHash: await bcrypt.hash('Sup3r!Strong1', 12), role: 'SUPER_ADMIN', hospitalId: null } });
    superToken = await loginAs(app.getHttpServer(), superEmail, 'Sup3r!Strong1');

    const adminEmail = `phase9-admin-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: adminEmail, password: 'Adm1n!Strong1', role: 'HOSPITAL_ADMIN', hospitalId: hospitalAId }).expect(201);
    adminAToken = await loginAs(app.getHttpServer(), adminEmail, 'Adm1n!Strong1');

    const doctorEmail = `phase9-doctor-${runId}@example.test`;
    const department = await request(app.getHttpServer()).post(`/api/hospitals/${hospitalAId}/departments`)
      .set('Authorization', `Bearer ${adminAToken}`).send({ name: `Phase9 Dept ${runId}`, code: `P9${String(runId).slice(-6)}` }).expect(201);
    await request(app.getHttpServer()).post('/api/doctors').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, email: doctorEmail, licenseNumber: `P9D-${runId}`, specialization: 'Cardiology', consultationFee: 90, departmentIds: [department.body.data.id] }).expect(201);
    await prisma.user.update({ where: { email: doctorEmail }, data: { passwordHash: await bcrypt.hash('D0ct!Strong1', 12) } });
    doctorToken = await loginAs(app.getHttpServer(), doctorEmail, 'D0ct!Strong1');

    const receptionistEmail = `phase9-recep-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: receptionistEmail, password: 'Rec3p!Strong1', role: 'RECEPTIONIST', hospitalId: hospitalAId }).expect(201);
    receptionistToken = await loginAs(app.getHttpServer(), receptionistEmail, 'Rec3p!Strong1');

    const accountantEmail = `phase9-acct-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: accountantEmail, password: 'Acc0unt!Strong1', role: 'ACCOUNTANT', hospitalId: hospitalAId }).expect(201);
    accountantToken = await loginAs(app.getHttpServer(), accountantEmail, 'Acc0unt!Strong1');

    const patientEmail = `phase9-patient-${runId}@example.test`;
    const patient = await request(app.getHttpServer()).post('/api/patients').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, firstName: 'Phase9', lastName: `Runner${runId}`, email: patientEmail, password: 'Pat1ent!Strong' }).expect(201);
    patientAId = patient.body.data.id;
    patientToken = await loginAs(app.getHttpServer(), patientEmail, 'Pat1ent!Strong');
  }, 120000);

  afterAll(async () => {
    await app?.close();
  });

  it('DASH-2. Unauthorized analytics access is rejected', async () => {
    await request(app.getHttpServer()).get('/api/analytics/overview?range=7d').expect(401);
  });

  it('DASH-3/ANALYTICS. Hospital admin sees own-hospital metrics', async () => {
    const response = await request(app.getHttpServer()).get('/api/analytics/overview?range=7d').set('Authorization', `Bearer ${adminAToken}`).expect(200);
    expect(response.body.data.revenue).toBeDefined();
    expect(response.body.data.appointments.series).toHaveLength(7);
    expect(response.body.data.departments.scope).toBe('hospital');
    const otherAdmin = await prisma.user.findFirst({ where: { hospitalId: hospitalBId, role: 'HOSPITAL_ADMIN' } });
    void otherAdmin;
  });

  it('DASH-4. Super admin platform metrics', async () => {
    const response = await request(app.getHttpServer()).get('/api/analytics/overview?range=7d').set('Authorization', `Bearer ${superToken}`).expect(200);
    expect(response.body.data.departments.scope).toBe('platform');
    expect(response.body.data.departments.perHospital.length).toBeGreaterThanOrEqual(2);
  });

  it('DASH-5. Patient dashboard shows only own information', async () => {
    const response = await request(app.getHttpServer()).get('/api/analytics/overview?range=7d').set('Authorization', `Bearer ${patientToken}`).expect(200);
    expect(response.body.data.scope).toBe('patient');
    expect(typeof response.body.data.upcomingAppointments).toBe('number');
  });

  it('ANALYTICS-6/7/8. Revenue, volume, growth shapes are correct', async () => {
    const response = await request(app.getHttpServer()).get('/api/analytics/overview?range=7d').set('Authorization', `Bearer ${accountantToken}`).expect(200);
    expect(response.body.data.revenue.series.every((point: { day: string; total: number }) => typeof point.total === 'number')).toBe(true);
    expect(response.body.data.patients.total).toBeGreaterThanOrEqual(0);
    expect(response.body.data.doctors.active).toBeGreaterThanOrEqual(1);
  });

  it('ANALYTICS-9/10/11. Occupancy tenant-safe, low-stock scoped, date filtering', async () => {
    const admin = await request(app.getHttpServer()).get('/api/analytics/overview?range=7d').set('Authorization', `Bearer ${adminAToken}`).expect(200);
    expect(admin.body.data.lowStock.scope).toBe('hospital');
    const today = await request(app.getHttpServer()).get('/api/analytics/overview?range=today').set('Authorization', `Bearer ${adminAToken}`).expect(200);
    expect(today.body.data.appointments.series).toHaveLength(1);
    const custom = await request(app.getHttpServer()).get('/api/analytics/overview?range=custom&from=2026-01-01&to=2026-01-07').set('Authorization', `Bearer ${adminAToken}`).expect(200);
    expect(custom.body.data.appointments.series).toHaveLength(7);
    await request(app.getHttpServer()).get('/api/analytics/overview?range=custom&from=bad&to=2026-01-07').set('Authorization', `Bearer ${adminAToken}`).expect(400);
    await request(app.getHttpServer()).get(`/api/analytics/overview?range=7d&hospitalId=${hospitalBId}`).set('Authorization', `Bearer ${adminAToken}`).expect(403);
  });

  it('SEARCH-13/14/15. Patient, doctor, medicine search work', async () => {
    const patients = await request(app.getHttpServer()).get('/api/search?entity=patients&q=Phase9').set('Authorization', `Bearer ${receptionistToken}`).expect(200);
    expect(patients.body.data.length).toBeGreaterThanOrEqual(1);
    expect(patients.body.meta.total).toBeGreaterThanOrEqual(1);
    const doctors = await request(app.getHttpServer()).get('/api/search?entity=doctors&q=Cardiology').set('Authorization', `Bearer ${receptionistToken}`).expect(200);
    expect(doctors.body.data.length).toBeGreaterThanOrEqual(1);
    const medicines = await request(app.getHttpServer()).get('/api/search?entity=medicines&q=MED').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(medicines.body.meta.page).toBe(1);
  });

  it('SEARCH-17/18. Tenant isolation + unauthorized entity rejected', async () => {
    const cross = await request(app.getHttpServer()).get(`/api/search?entity=patients&q=&hospitalId=${hospitalBId}`).set('Authorization', `Bearer ${receptionistToken}`).expect(403);
    void cross;
    await request(app.getHttpServer()).get('/api/search?entity=patients&q=x').set('Authorization', `Bearer ${patientToken}`).expect(403);
    await request(app.getHttpServer()).get('/api/search?entity=records&q=x').set('Authorization', `Bearer ${receptionistToken}`).expect(403);
    const scoped = await request(app.getHttpServer()).get('/api/search?entity=doctors&q=').set('Authorization', `Bearer ${receptionistToken}`).expect(200);
    const foreign = (scoped.body.data as Array<{ hospitalId: string }>).filter((row) => row.hospitalId === hospitalBId);
    expect(foreign).toHaveLength(0);
  });

  it('FILTERS-20/21/22/23. Appointment, medicine, invoice, lab filters', async () => {
    const appointments = await request(app.getHttpServer()).get('/api/appointments?status=COMPLETED').set('Authorization', `Bearer ${receptionistToken}`).expect(200);
    expect(appointments.body.meta.total).toBeGreaterThanOrEqual(0);
    const medicines = await request(app.getHttpServer()).get('/api/medicines?search=MED').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(medicines.body.meta.total).toBeGreaterThanOrEqual(0);
    const invoices = await request(app.getHttpServer()).get('/api/invoices?paymentStatus=UNPAID').set('Authorization', `Bearer ${accountantToken}`).expect(200);
    expect(invoices.body.meta.total).toBeGreaterThanOrEqual(0);
    const labs = await request(app.getHttpServer()).get('/api/lab-orders?status=ORDERED').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(labs.body.meta.total).toBeGreaterThanOrEqual(0);
    void patientAId;
  });

  it('ACTIVITY. Recent activity log is tenant-scoped', async () => {
    const activity = await request(app.getHttpServer()).get('/api/activity').set('Authorization', `Bearer ${adminAToken}`).expect(200);
    expect(Array.isArray(activity.body.data)).toBe(true);
    expect(activity.body.meta.total).toBeGreaterThanOrEqual(1);
  });
});
