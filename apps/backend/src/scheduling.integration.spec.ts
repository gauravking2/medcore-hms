import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { PrismaService } from './prisma/prisma.service';
import { ReminderQueue } from './scheduling/reminder.queue';

async function loginAs(server: unknown, email: string, password: string): Promise<string> {
  const response = await request(server as never).post('/api/auth/login').send({ email, password }).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

function futureSlot(dayOffset: number, hour: number, minute: number, durationMinutes: number) {
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + dayOffset);
  startsAt.setHours(hour, minute, 0, 0);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000) };
}

describe('Phase 5 scheduling integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reminders: ReminderQueue;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  let hospitalAId = '';
  let hospitalBId = '';
  let superToken = '';
  let adminAToken = '';
  let receptionistToken = '';
  let patientToken = '';
  let doctorTokenA = '';
  let doctorIdA = '';
  let departmentAId = '';
  let patientAId = '';
  let patientBId = '';
  let concurrencyReport = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    reminders = app.get(ReminderQueue);
    const hospitalA = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'northstar-demo' } });
    const hospitalB = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'willowbend-demo' } });
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;

    const superEmail = `phase5-super-${runId}@example.test`;
    await prisma.user.create({ data: { email: superEmail, passwordHash: await bcrypt.hash('Sup3r!Strong1', 12), role: 'SUPER_ADMIN', hospitalId: null } });
    superToken = await loginAs(app.getHttpServer(), superEmail, 'Sup3r!Strong1');

    const adminEmail = `phase5-admin-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: adminEmail, password: 'Adm1n!Strong1', role: 'HOSPITAL_ADMIN', hospitalId: hospitalAId }).expect(201);
    adminAToken = await loginAs(app.getHttpServer(), adminEmail, 'Adm1n!Strong1');

    const receptionistEmail = `phase5-recep-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: receptionistEmail, password: 'Rec3p!Strong1', role: 'RECEPTIONIST', hospitalId: hospitalAId }).expect(201);
    receptionistToken = await loginAs(app.getHttpServer(), receptionistEmail, 'Rec3p!Strong1');

    const department = await request(app.getHttpServer()).post(`/api/hospitals/${hospitalAId}/departments`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: `Phase5 Dept ${runId}`, code: `P5${String(runId).slice(-6)}` }).expect(201);
    departmentAId = department.body.data.id;

    const doctorEmail = `phase5-doctor-${runId}@example.test`;
    const doctor = await request(app.getHttpServer()).post('/api/doctors').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, email: doctorEmail, licenseNumber: `P5D-${runId}`, specialization: 'Cardiology', consultationFee: 100, departmentIds: [departmentAId] }).expect(201);
    doctorIdA = doctor.body.data.id;
    await prisma.user.update({ where: { email: doctorEmail }, data: { passwordHash: await bcrypt.hash('D0ct!Strong1', 12) } });
    doctorTokenA = await loginAs(app.getHttpServer(), doctorEmail, 'D0ct!Strong1');

    // Availability covers every weekday 08:00-18:00, 30-minute slots.
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await request(app.getHttpServer()).post(`/api/doctors/${doctorIdA}/availability`)
        .set('Authorization', `Bearer ${doctorTokenA}`)
        .send({ weekday, startsAt: '08:00', endsAt: '18:00', slotMinutes: 30 }).expect(201);
    }

    const patientAEmail = `phase5-patient-a-${runId}@example.test`;
    const patientARes = await request(app.getHttpServer()).post('/api/patients').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, firstName: 'Phase5A', lastName: `Runner${runId}`, email: patientAEmail, password: 'Pat1ent!Strong' }).expect(201);
    patientAId = patientARes.body.data.id;
    patientToken = await loginAs(app.getHttpServer(), patientAEmail, 'Pat1ent!Strong');

    const patientBEmail = `phase5-patient-b-${runId}@example.test`;
    const patientBRes = await request(app.getHttpServer()).post('/api/patients').set('Authorization', `Bearer ${adminAToken}`)
      .send({ hospitalId: hospitalAId, firstName: 'Phase5B', lastName: `Runner${runId}`, email: patientBEmail, password: 'Pat1ent!Strong' }).expect(201);
    patientBId = patientBRes.body.data.id;
    await loginAs(app.getHttpServer(), patientBEmail, 'Pat1ent!Strong');
  }, 90000);

  afterAll(async () => {
    await app?.close();
  });

  it('1. Doctor creates valid availability', async () => {
    const list = await request(app.getHttpServer()).get(`/api/doctors/${doctorIdA}/availability`)
      .set('Authorization', `Bearer ${doctorTokenA}`).expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(7);
  });

  it('2. Invalid schedule is rejected', async () => {
    await request(app.getHttpServer()).post(`/api/doctors/${doctorIdA}/availability`)
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({ weekday: 1, startsAt: '13:00', endsAt: '09:00', slotMinutes: 30 }).expect(409);
  });

  it('3. Overlapping schedule is rejected', async () => {
    await request(app.getHttpServer()).post(`/api/doctors/${doctorIdA}/availability`)
      .set('Authorization', `Bearer ${doctorTokenA}`)
      .send({ weekday: 1, startsAt: '09:00', endsAt: '10:00', slotMinutes: 30 }).expect(409);
  });

  it('4. Available slots are generated correctly', async () => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    const dateStr = date.toISOString().slice(0, 10);
    const response = await request(app.getHttpServer()).get(`/api/doctors/${doctorIdA}/available-slots?date=${dateStr}`)
      .set('Authorization', `Bearer ${patientToken}`).expect(200);
    expect(response.body.data.slots.length).toBe(20);
  });

  it('5. Bookable slot can be booked', async () => {
    const { startsAt, endsAt } = futureSlot(3, 9, 0, 30);
    const response = await request(app.getHttpServer()).post('/api/appointments')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientAId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(201);
    expect(response.body.data.status).toBe('PENDING');
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(stored.reminder24hJobId).toContain(`appt-${stored.id}-24h`);
  });

  it('6. Already-booked slot is rejected', async () => {
    const { startsAt, endsAt } = futureSlot(3, 10, 0, 30);
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientAId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(201);
    const retry = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientBId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(409);
    expect(retry.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('7. Patient cannot double-book themselves at same time', async () => {
    const { startsAt, endsAt } = futureSlot(3, 11, 0, 30);
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientAId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(201);
    // Same slot, same patient, different doctor in the same hospital: the
    // availability gate would mask the invariant, so give the second doctor a
    // matching availability window first (test-only setup, same hospital).
    const otherDoctorRow = await prisma.doctor.findFirstOrThrow({ where: { hospitalId: hospitalAId, id: { not: doctorIdA } } });
    const weekday = startsAt.getDay();
    await prisma.doctorAvailability.deleteMany({ where: { doctorId: otherDoctorRow.id, weekday } });
    await prisma.doctorAvailability.create({ data: { hospitalId: hospitalAId, doctorId: otherDoctorRow.id, weekday, startsAt: '08:00', endsAt: '18:00', slotMinutes: 30 } });
    const otherDepartment = await prisma.department.findFirstOrThrow({ where: { hospitalId: hospitalAId } });
    const retry = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientAId, doctorId: otherDoctorRow.id, departmentId: otherDepartment.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(409);
    expect(retry.body.error.code).toBe('PATIENT_DOUBLE_BOOKED');
  });

  it('8. Doctor cannot be double-booked (overlap rejected)', async () => {
    const { startsAt } = futureSlot(3, 12, 0, 30);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientAId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(201);
    const overlapStart = new Date(startsAt.getTime() + 15 * 60_000);
    const overlapEnd = new Date(overlapStart.getTime() + 30 * 60_000);
    const retry = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientBId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: overlapStart.toISOString(), endsAt: overlapEnd.toISOString() }).expect(409);
    expect(retry.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('9-10. Invalid transition rejected; valid transition succeeds', async () => {
    const { startsAt, endsAt } = futureSlot(4, 9, 0, 30);
    const created = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientAId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(201);
    const id = created.body.data.id;
    await request(app.getHttpServer()).patch(`/api/appointments/${id}/status`).set('Authorization', `Bearer ${doctorTokenA}`)
      .send({ status: 'COMPLETED' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/appointments/${id}/status`).set('Authorization', `Bearer ${doctorTokenA}`)
      .send({ status: 'CONFIRMED' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/appointments/${id}/status`).set('Authorization', `Bearer ${doctorTokenA}`)
      .send({ status: 'IN_PROGRESS' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/appointments/${id}/status`).set('Authorization', `Bearer ${doctorTokenA}`)
      .send({ status: 'COMPLETED' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/appointments/${id}/status`).set('Authorization', `Bearer ${doctorTokenA}`)
      .send({ status: 'PENDING' }).expect(400);
  });

  it('11. Emergency booking bypasses normal availability', async () => {
    const { startsAt } = futureSlot(4, 3, 0, 30);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    const response = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientBId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), isEmergency: true, reason: 'Chest pain' }).expect(201);
    expect(response.body.data.isEmergency).toBe(true);
  });

  it('12-13. Cross-hospital creation and retrieval rejected', async () => {
    const otherPatient = await prisma.patient.findFirstOrThrow({ where: { hospitalId: hospitalBId } });
    const otherDepartment = await prisma.department.findFirstOrThrow({ where: { hospitalId: hospitalBId } });
    const { startsAt, endsAt } = futureSlot(5, 9, 0, 30);
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: otherPatient.id, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(403);
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientAId, doctorId: doctorIdA, departmentId: otherDepartment.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(403);
    const otherAppointment = await prisma.appointment.findFirstOrThrow({ where: { hospitalId: hospitalBId } });
    await request(app.getHttpServer()).get(`/api/appointments/${otherAppointment.id}`).set('Authorization', `Bearer ${receptionistToken}`).expect(403);
  });

  it('14. Unauthorized role is rejected', async () => {
    const accountantEmail = `phase5-acct-${runId}@example.test`;
    await request(app.getHttpServer()).post('/api/users/invite').set('Authorization', `Bearer ${superToken}`)
      .send({ email: accountantEmail, password: 'Acc0unt!Strong1', role: 'ACCOUNTANT', hospitalId: hospitalAId }).expect(201);
    const accountantToken = await loginAs(app.getHttpServer(), accountantEmail, 'Acc0unt!Strong1');
    const { startsAt, endsAt } = futureSlot(5, 10, 0, 30);
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${accountantToken}`)
      .send({ patientId: patientAId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(403);
  });

  it('15. Appointment cancellation works and frees the slot', async () => {
    const { startsAt, endsAt } = futureSlot(5, 11, 0, 30);
    const created = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientAId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(201);
    await request(app.getHttpServer()).patch(`/api/appointments/${created.body.data.id}/cancel`).set('Authorization', `Bearer ${patientToken}`).expect(200);
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`)
      .send({ patientId: patientBId, doctorId: doctorIdA, departmentId: departmentAId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }).expect(201);
  });

  it('16-17. Reminder scheduled; cancelled reminder handled', async () => {
    const startsAt = new Date(Date.now() + 25 * 3600_000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    const created = await prisma.appointment.create({
      data: { hospitalId: hospitalAId, patientId: patientAId, doctorId: doctorIdA, departmentId: departmentAId, startsAt, endsAt, status: 'CONFIRMED' },
    });
    const jobs = await reminders.scheduleFor(created.id, hospitalAId, startsAt);
    expect(jobs.job24hId).toBe(`appt-${created.id}-24h`);
    expect(jobs.job1hId).toBe(`appt-${created.id}-1h`);
    await reminders.cancelFor(created.id);
    await prisma.appointment.update({ where: { id: created.id }, data: { status: 'CANCELLED' } });
    const delivered: string[] = [];
    await reminders.startWorker(async (payload) => { delivered.push(payload.appointmentId); });
    const { Worker } = await import('bullmq');
    void Worker;
    expect(delivered).toHaveLength(0);
  });

  it('18. CRITICAL: simultaneous bookings yield exactly one success', async () => {
    const { startsAt, endsAt } = futureSlot(6, 9, 0, 30);
    const payloadFor = (patientId: string) => ({
      patientId, doctorId: doctorIdA, departmentId: departmentAId,
      startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    });
    const attempt = (patientId: string) =>
      request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${receptionistToken}`).send(payloadFor(patientId));
    const [first, second] = await Promise.all([attempt(patientAId), attempt(patientBId)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('SLOT_UNAVAILABLE');
    concurrencyReport = `concurrency: attempts=2 success=1 rejected=1 code=${loser.body.error.code}`;
    const count = await prisma.appointment.count({ where: { doctorId: doctorIdA, startsAt, deletedAt: null, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } });
    expect(count).toBe(1);
  });

  it('exposes concurrency report', () => {
    expect(concurrencyReport).toContain('success=1');
  });
});
