import { AppointmentStatus, PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

describe('Phase 2 schema invariants', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps enum contracts intact', () => {
    expect(Object.values(UserRole)).toEqual(
      expect.arrayContaining([
        'SUPER_ADMIN',
        'HOSPITAL_ADMIN',
        'DOCTOR',
        'NURSE',
        'RECEPTIONIST',
        'LAB_TECHNICIAN',
        'PHARMACIST',
        'ACCOUNTANT',
        'PATIENT',
      ]),
    );
    expect(Object.values(AppointmentStatus)).toEqual(
      expect.arrayContaining([
        'PENDING',
        'CONFIRMED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'NO_SHOW',
      ]),
    );
  });

  it('supports soft deletes on patient, doctor, and appointment', async () => {
    const fields = ['Patient', 'Doctor', 'Appointment'] as const;
    for (const model of fields) {
      const delegate = (prisma as unknown as Record<string, { findFirst: (args: object) => Promise<unknown> }>)[model[0].toLowerCase() + model.slice(1)];
      expect(delegate).toBeDefined();
      await expect(delegate.findFirst({ where: { deletedAt: null } })).resolves.toBeDefined();
    }
  });

  it('rejects cross-hospital appointment relations', async () => {
    const first = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'northstar-demo' } });
    const second = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'willowbend-demo' } });
    const patient = await prisma.patient.findFirstOrThrow({ where: { hospitalId: first.id } });
    const doctor = await prisma.doctor.findFirstOrThrow({ where: { hospitalId: second.id } });
    const department = await prisma.department.findFirstOrThrow({ where: { hospitalId: second.id } });
    await expect(
      prisma.appointment.create({
        data: {
          hospitalId: first.id,
          patientId: patient.id,
          doctorId: doctor.id,
          departmentId: department.id,
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 30 * 60_000),
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces hospital-scoped uniqueness for patient numbers', async () => {
    const hospital = await prisma.hospital.findFirstOrThrow();
    const patient = await prisma.patient.findFirstOrThrow({ where: { hospitalId: hospital.id } });
    await expect(
      prisma.patient.create({
        data: {
          hospitalId: hospital.id,
          patientNumber: patient.patientNumber,
          firstName: 'Duplicate',
          lastName: 'Check',
        },
      }),
    ).rejects.toThrow();
  });

  it('verifies seed integrity across tenants', async () => {
    const [hospitals, doctors, patients, appointments, departments, medicines, labTests] = await Promise.all([
      prisma.hospital.count(),
      prisma.doctor.count(),
      prisma.patient.count(),
      prisma.appointment.count(),
      prisma.department.count(),
      prisma.medicine.count(),
      prisma.labTest.count(),
    ]);
    expect(hospitals).toBeGreaterThanOrEqual(2);
    expect(doctors).toBeGreaterThanOrEqual(8);
    expect(patients).toBeGreaterThanOrEqual(30);
    expect(appointments).toBeGreaterThanOrEqual(28);
    expect(departments).toBeGreaterThanOrEqual(2);
    expect(medicines).toBeGreaterThanOrEqual(1);
    expect(labTests).toBeGreaterThanOrEqual(1);
    const superAdmin = await prisma.user.findUnique({ where: { email: 'superadmin@example.test' } });
    expect(superAdmin?.hospitalId).toBeNull();
  });
});
