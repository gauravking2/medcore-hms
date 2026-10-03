import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { PrismaService } from './prisma/prisma.service';

const HOSPITAL_A = 'northstar-demo';
const HOSPITAL_B = 'willowbend-demo';

async function loginAs(server: unknown, email: string, password: string): Promise<string> {
  const response = await request(server as never)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

describe('Phase 4 directory integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  let hospitalAId = '';
  let hospitalBId = '';
  let superToken = '';
  let adminAToken = '';
  let patientToken = '';
  let patientId = '';
  let departmentAId = '';
  let doctorId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const hospitalA = await prisma.hospital.findUniqueOrThrow({ where: { slug: HOSPITAL_A } });
    const hospitalB = await prisma.hospital.findUniqueOrThrow({ where: { slug: HOSPITAL_B } });
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;
    await prisma.user.upsert({
      where: { email: `phase4-super-${runId}@example.test` },
      update: {},
      create: {
        email: `phase4-super-${runId}@example.test`,
        passwordHash: '$2b$12$KIX9l5YvQ4QJ2H6y3m6Y5eH6y3m6Y5eH6y3m6Y5eH6y3m6Y5eH6',
        role: 'SUPER_ADMIN',
        hospitalId: null,
      },
    });
    await prisma.user.update({
      where: { email: `phase4-super-${runId}@example.test` },
      data: { passwordHash: await (await import('bcryptjs')).hash('Sup3r!Strong1', 12) },
    });
    superToken = await loginAs(app.getHttpServer(), `phase4-super-${runId}@example.test`, 'Sup3r!Strong1');
    await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ email: `phase4-admin-a-${runId}@example.test`, password: 'Adm1n!Strong1', role: 'HOSPITAL_ADMIN', hospitalId: hospitalAId })
      .expect(201);
    adminAToken = await loginAs(app.getHttpServer(), `phase4-admin-a-${runId}@example.test`, 'Adm1n!Strong1');
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('1. Super Admin can create hospital', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/hospitals')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: `Phase4 Hospital ${runId}`, slug: `phase4-${runId}`, email: `h-${runId}@example.test` })
      .expect(201);
    expect(response.body.data.slug).toBe(`phase4-${runId}`);
    expect(response.body.data.status).toBe('PENDING_VERIFICATION');
  });

  it('2. Unauthorized role cannot create hospital', async () => {
    await request(app.getHttpServer())
      .post('/api/hospitals')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: 'Blocked', slug: `blocked-${runId}` })
      .expect(403);
  });

  it('3. Super Admin can verify hospital', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/hospitals')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: `Verify Me ${runId}`, slug: `verify-${runId}` })
      .expect(201);
    const verified = await request(app.getHttpServer())
      .post(`/api/hospitals/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: 'ACTIVE' })
      .expect(201);
    expect(verified.body.data.status).toBe('ACTIVE');
  });

  it('4. Hospital Admin cannot modify another hospital', async () => {
    await request(app.getHttpServer())
      .patch(`/api/hospitals/${hospitalBId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: 'Hijacked' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/hospitals/${hospitalBId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(403);
  });

  it('5. Hospital Admin can create department in own hospital', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/hospitals/${hospitalAId}/departments`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: `Phase4 Dept ${runId}`, code: `P4${String(runId).slice(-6)}` })
      .expect(201);
    departmentAId = response.body.data.id;
    expect(response.body.data.hospitalId).toBe(hospitalAId);
  });

  it('6. Hospital Admin cannot retrieve another hospital department', async () => {
    const other = await prisma.department.findFirstOrThrow({ where: { hospitalId: hospitalBId } });
    await request(app.getHttpServer())
      .get(`/api/departments/${other.id}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(403);
  });

  it('7. Hospital Admin cannot modify another hospital department', async () => {
    const other = await prisma.department.findFirstOrThrow({ where: { hospitalId: hospitalBId } });
    await request(app.getHttpServer())
      .patch(`/api/departments/${other.id}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: 'Hijacked' })
      .expect(403);
  });

  it('8. Authorized role can create doctor', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({
        hospitalId: hospitalAId,
        email: `phase4-doctor-${runId}@example.test`,
        licenseNumber: `P4-${runId}`,
        specialization: 'Cardiology',
        consultationFee: 100,
        departmentIds: [departmentAId],
      })
      .expect(201);
    doctorId = response.body.data.id;
    expect(response.body.data.hospitalId).toBe(hospitalAId);
  });

  it('9. Cross-hospital doctor access is denied', async () => {
    const other = await prisma.doctor.findFirstOrThrow({ where: { hospitalId: hospitalBId } });
    await request(app.getHttpServer())
      .get(`/api/doctors/${other.id}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(403);
  });

  it('10. Doctor profile is linked to user/hospital/department', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/doctors/${doctorId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(200);
    expect(response.body.data.hospitalId).toBe(hospitalAId);
    expect(response.body.data.user.email).toBe(`phase4-doctor-${runId}@example.test`);
    expect(response.body.data.departments).toHaveLength(1);
  });

  it('11. Hospital Admin can manage permitted staff', async () => {
    const invited = await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ email: `phase4-nurse-${runId}@example.test`, password: 'Nurs3!Strong1', role: 'NURSE', hospitalId: hospitalAId })
      .expect(201);
    expect(invited.body.data.role).toBe('NURSE');
    const updated = await request(app.getHttpServer())
      .patch(`/api/users/${invited.body.data.id}/role`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ role: 'RECEPTIONIST' })
      .expect(200);
    expect(updated.body.data.role).toBe('RECEPTIONIST');
  });

  it('12. Hospital Admin cannot create/promote Super Admin', async () => {
    await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ email: `phase4-evil-${runId}@example.test`, password: 'Ev1l!Strong1', role: 'SUPER_ADMIN', hospitalId: hospitalAId })
      .expect(403);
    const nurse = await prisma.user.findFirstOrThrow({ where: { email: `phase4-nurse-${runId}@example.test` } });
    await request(app.getHttpServer())
      .patch(`/api/users/${nurse.id}/role`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ role: 'SUPER_ADMIN' })
      .expect(403);
  });

  it('13. User cannot self-promote', async () => {
    const me = await prisma.user.findFirstOrThrow({ where: { email: `phase4-nurse-${runId}@example.test` } });
    const nurseToken = await loginAs(app.getHttpServer(), `phase4-nurse-${runId}@example.test`, 'Nurs3!Strong1');
    await request(app.getHttpServer())
      .patch(`/api/users/${me.id}/role`)
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ role: 'HOSPITAL_ADMIN' })
      .expect(403);
  });

  it('14. Cross-hospital staff access is denied', async () => {
    const otherAdmin = await prisma.user.findFirstOrThrow({ where: { email: `admin@${HOSPITAL_B}.example.test` } });
    await request(app.getHttpServer())
      .get(`/api/users/${otherAdmin.id}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(403);
  });

  it('15. Authorized hospital role can register patient', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, firstName: 'Phase4', lastName: `Patient${runId}`, email: `phase4-patient-${runId}@example.test`, password: 'Pat1ent!Strong' })
      .expect(201);
    patientId = response.body.data.id;
    expect(response.body.data.hospitalId).toBe(hospitalAId);
    patientToken = await loginAs(app.getHttpServer(), `phase4-patient-${runId}@example.test`, 'Pat1ent!Strong');
  });

  it('16. Patient can view own profile', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(response.body.data.id).toBe(patientId);
  });

  it('17. Patient cannot view another patient profile', async () => {
    const other = await prisma.patient.findFirstOrThrow({ where: { hospitalId: hospitalAId, id: { not: patientId } } });
    await request(app.getHttpServer())
      .get(`/api/patients/${other.id}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(403);
  });

  it('18. Cross-hospital patient access is denied', async () => {
    const other = await prisma.patient.findFirstOrThrow({ where: { hospitalId: hospitalBId } });
    await request(app.getHttpServer())
      .get(`/api/patients/${other.id}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(403);
  });

  it('19. Important writes create audit records', async () => {
    const audits = await prisma.auditLog.count({ where: { entityId: patientId } });
    expect(audits).toBeGreaterThanOrEqual(1);
    const hospitalAudits = await prisma.auditLog.count({ where: { action: { startsWith: 'hospital.' } } });
    expect(hospitalAudits).toBeGreaterThanOrEqual(1);
  });
});
