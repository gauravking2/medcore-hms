import {
  AppointmentStatus,
  ChargeCategory,
  Gender,
  InvoiceStatus,
  LabOrderStatus,
  PaymentStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { hashPassword } from '../src/auth/crypto.util';

const prisma = new PrismaClient();

// Every demo account uses a real bcrypt hash so the seeded environment is
// actually sign-in-able. Passwords are development-only placeholders.
const DEMO_PASSWORD = 'MedCore!Demo1';
const QA_PASSWORD = 'QaTest!1234';
let demoPasswordHash = '';
const hospitals = [
  { name: 'Northstar Demo Clinic', slug: 'northstar-demo' },
  { name: 'Willowbend Demo Hospital', slug: 'willowbend-demo' },
];
const specialties = [
  'Cardiology',
  'Pediatrics',
  'Dermatology',
  'Neurology',
  'Orthopedics',
  'Gynecology',
  'Ophthalmology',
  'General Medicine',
];
const names = [
  ['Avery', 'Quill'], ['Rowan', 'Fable'], ['Sage', 'Marlow'], ['Ellis', 'Wren'], ['Rory', 'Vale'],
  ['Mira', 'Solace'], ['Theo', 'Briar'], ['Lena', 'Cove'], ['Remy', 'Hollis'], ['Iris', 'North'],
  ['Jules', 'Meadow'], ['Nico', 'Harbor'], ['Talia', 'Fern'], ['Emery', 'Lake'], ['Noa', 'Sterling'],
  ['Arden', 'Blue'], ['Kit', 'Elm'], ['Milan', 'Brook'], ['Zuri', 'Ash'], ['Lior', 'West'],
  ['Cleo', 'Pine'], ['Orion', 'Dale'], ['Esme', 'Cloud'], ['Beck', 'River'], ['Dara', 'Moon'],
  ['Indigo', 'Field'], ['Sky', 'Amber'], ['Perry', 'Stone'], ['Lumi', 'Glen'], ['Marlow', 'Snow'],
];

async function main() {
  demoPasswordHash = await hashPassword(DEMO_PASSWORD);
  await prisma.user.upsert({
    where: { email: 'superadmin@example.test' },
    update: { passwordHash: demoPasswordHash },
    create: {
      email: 'superadmin@example.test',
      passwordHash: demoPasswordHash,
      role: UserRole.SUPER_ADMIN,
      hospitalId: null,
    },
  });

  for (const [hospitalIndex, data] of hospitals.entries()) {
    const hospital = await prisma.hospital.upsert({ where: { slug: data.slug }, update: {}, create: data });
    await prisma.user.upsert({
      where: { email: `admin@${data.slug}.example.test` },
      update: { passwordHash: demoPasswordHash },
      create: {
        email: `admin@${data.slug}.example.test`,
        passwordHash: demoPasswordHash,
        role: UserRole.HOSPITAL_ADMIN,
        hospitalId: hospital.id,
      },
    });
    const departmentRows = await Promise.all(specialties.map((name, i) => prisma.department.upsert({
      where: { hospitalId_code: { hospitalId: hospital.id, code: `DEPT-${i + 1}` } },
      update: { name },
      create: { hospitalId: hospital.id, name, code: `DEPT-${i + 1}` },
    })));
    const doctors = [];
    for (let i = 0; i < 4; i++) {
      const n = hospitalIndex * 4 + i;
      const specialization = specialties[n];
      const email = `doctor${n + 1}@${data.slug}.example.test`;
      const user = await prisma.user.upsert({
        where: { email },
        update: { passwordHash: demoPasswordHash },
        create: { email, passwordHash: demoPasswordHash, role: UserRole.DOCTOR, hospitalId: hospital.id },
      });
      const doctor = await prisma.doctor.upsert({
        where: { userId: user.id },
        update: { specialization, consultationFee: 75 + n * 5 },
        create: {
          hospitalId: hospital.id, userId: user.id, licenseNumber: `DEMO-${hospitalIndex + 1}-${i + 1}`,
          specialization, consultationFee: 75 + n * 5,
        },
      });
      doctors.push(doctor);
      const department = departmentRows[n];
      await prisma.doctorDepartment.upsert({
        where: { doctorId_departmentId: { doctorId: doctor.id, departmentId: department.id } },
        update: {},
        create: { hospitalId: hospital.id, doctorId: doctor.id, departmentId: department.id },
      });
      await prisma.doctorAvailability.deleteMany({ where: { doctorId: doctor.id } });
      await prisma.doctorAvailability.createMany({
        data: [1, 2, 3, 4, 5].map((weekday) => ({
          hospitalId: hospital.id, doctorId: doctor.id, weekday,
          startsAt: '09:00', endsAt: '17:00', slotMinutes: 30,
        })),
      });
    }
    const patients = [];
    for (let i = 0; i < names.length; i++) {
      const [firstName, lastName] = names[i];
      patients.push(await prisma.patient.upsert({
        where: { hospitalId_patientNumber: { hospitalId: hospital.id, patientNumber: `${hospitalIndex + 1}-${String(i + 1).padStart(3, '0')}` } },
        update: {},
        create: {
          hospitalId: hospital.id, patientNumber: `${hospitalIndex + 1}-${String(i + 1).padStart(3, '0')}`,
          firstName, lastName, gender: Gender.UNSPECIFIED,
        },
      }));
    }
    const now = new Date();
    const createdAppointments = [];
    for (let day = 1; day <= 14; day++) {
      for (let i = 0; i < 2; i++) {
        const startsAt = new Date(now);
        startsAt.setDate(now.getDate() - day);
        startsAt.setHours(9 + i, 0, 0, 0);
        const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
        const patient = patients[(day * 2 + i) % patients.length];
        const doctor = doctors[(day + i) % doctors.length];
        const department = departmentRows[(day + i) % departmentRows.length];
        createdAppointments.push(await prisma.appointment.upsert({
          where: { id: `demo-${hospitalIndex + 1}-${day}-${i}` }, update: {}, create: {
            id: `demo-${hospitalIndex + 1}-${day}-${i}`, hospitalId: hospital.id, patientId: patient.id,
            doctorId: doctor.id, departmentId: department.id, startsAt, endsAt,
            status: AppointmentStatus.COMPLETED, reason: 'Synthetic demo follow-up',
          },
        }));
      }
    }
    const medicines = [];
    for (const [name, sku] of [
      ['Demo Analgesic', 'MED-AN-01'], ['Demo Saline', 'MED-SA-02'], ['Demo Vitamin', 'MED-VI-03'],
    ]) {
      const medicine = await prisma.medicine.upsert({
        where: { hospitalId_sku: { hospitalId: hospital.id, sku } },
        update: { reorderLevel: 10 },
        create: { hospitalId: hospital.id, name, sku, reorderLevel: 10 },
      });
      medicines.push(medicine);
      const batches: Array<[string, string, string, number, number, number]> = [
        [`B-${sku}-A1`, '2025-01-15', '2027-01-15', 500, 0.8, 1.5],
        [`B-${sku}-B1`, '2025-06-01', '2027-06-30', 250, 0.75, 1.5],
      ];
      for (const [batchNumber, mfg, exp, quantity, unitCost, mrp] of batches) {
        await prisma.inventoryBatch.upsert({
          where: { hospitalId_medicineId_batchNumber: { hospitalId: hospital.id, medicineId: medicine.id, batchNumber } },
          update: { quantity, unitCost, mrp },
          create: {
            hospitalId: hospital.id, medicineId: medicine.id, batchNumber,
            manufacturingDate: new Date(mfg), expiryDate: new Date(exp),
            quantity, unitCost, mrp,
          },
        });
      }
    }
    const labTests = [];
    for (const [name, code, unit, referenceRange] of [
      ['Demo Blood Count', 'LAB-CBC', 'cells/uL', 'Synthetic range'],
      ['Demo Chemistry Panel', 'LAB-CHEM', 'mmol/L', 'Synthetic range'],
      ['Demo Thyroid Screen', 'LAB-TSH', 'mIU/L', 'Synthetic range'],
    ]) {
      labTests.push(await prisma.labTest.upsert({
        where: { hospitalId_code: { hospitalId: hospital.id, code } },
        update: {},
        create: { hospitalId: hospital.id, name, code, unit, referenceRange },
      }));
    }
    for (const [k, appointment] of createdAppointments.slice(0, 4).entries()) {
      const record = await prisma.medicalRecord.upsert({
        where: { appointmentId: appointment.id },
        update: {},
        create: {
          hospitalId: hospital.id, appointmentId: appointment.id,
          patientId: appointment.patientId, doctorId: appointment.doctorId,
          chiefComplaint: 'Synthetic demo complaint', diagnosis: 'Synthetic demo diagnosis',
          clinicalNotes: 'Generated for local development only.',
        },
      });
      const prescription = await prisma.prescription.upsert({
        where: { id: `rx-${appointment.id}` },
        update: {},
        create: { id: `rx-${appointment.id}`, hospitalId: hospital.id, medicalRecordId: record.id },
      });
      await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: prescription.id } });
      await prisma.prescriptionItem.createMany({
        data: medicines.slice(0, 2).map((medicine, m) => ({
          hospitalId: hospital.id, prescriptionId: prescription.id, medicineId: medicine.id,
          dosage: m === 0 ? '500mg' : '10ml', frequency: 'Twice daily', duration: '7 days',
          quantity: m === 0 ? 14 : 1, specialInstructions: 'Take after food (demo data).',
        })),
      });
      await prisma.labOrder.upsert({
        where: { id: `labord-${appointment.id}` },
        update: {},
        create: {
          id: `labord-${appointment.id}`, hospitalId: hospital.id, medicalRecordId: record.id,
          patientId: appointment.patientId, labTestId: labTests[0].id,
          status: k === 0 ? LabOrderStatus.APPROVED : LabOrderStatus.ORDERED,
          resultValue: k === 0 ? '5.2' : null,
          resultNotes: k === 0 ? 'Within synthetic range.' : null,
          resultAt: k === 0 ? new Date() : null,
          approvedByUserId: k === 0 ? doctors[0].userId : null,
          approvedAt: k === 0 ? new Date() : null,
        },
      });
      const consultationFee = Number(doctors.find((d) => d.id === appointment.doctorId)?.consultationFee ?? 75);
      const labCharge = 45;
      const invoice = await prisma.invoice.upsert({
        where: { appointmentId: appointment.id },
        update: { subtotal: consultationFee + labCharge, total: consultationFee + labCharge },
        create: {
          hospitalId: hospital.id, appointmentId: appointment.id, patientId: appointment.patientId,
          invoiceNumber: `INV-${hospitalIndex + 1}-${k + 1}`,
          status: InvoiceStatus.ISSUED, paymentStatus: PaymentStatus.UNPAID,
          subtotal: consultationFee + labCharge, total: consultationFee + labCharge,
        },
      });
      await prisma.invoiceItem.upsert({
        where: { id: `invi-${appointment.id}-consult` },
        update: {},
        create: {
          id: `invi-${appointment.id}-consult`, hospitalId: hospital.id, invoiceId: invoice.id,
          category: ChargeCategory.CONSULTATION, description: 'Consultation charge (demo)',
          quantity: 1, unitPrice: consultationFee, amount: consultationFee,
        },
      });
      await prisma.invoiceItem.upsert({
        where: { id: `invi-${appointment.id}-lab` },
        update: {},
        create: {
          id: `invi-${appointment.id}-lab`, hospitalId: hospital.id, invoiceId: invoice.id,
          category: ChargeCategory.LAB, description: 'Lab charge (demo)',
          quantity: 1, unitPrice: labCharge, amount: labCharge,
        },
      });
    }
  }
}

/**
 * Dedicated QA accounts used by the Playwright suites. Each non-super role is
 * bound to its own hospital so tenant-isolation assertions stay meaningful.
 * All use the shared password `QaTest!1234`.
 */
async function seedQaAccounts() {
  const primary = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'northstar-demo' } });
  const secondary = await prisma.hospital.findUniqueOrThrow({ where: { slug: 'willowbend-demo' } });
  const qaPasswordHash = await hashPassword(QA_PASSWORD);
  const department = await prisma.department.findFirstOrThrow({ where: { hospitalId: primary.id } });

  const accounts: Array<{ email: string; role: UserRole; hospitalId: string | null }> = [
    { email: 'qa-super-admin@example.test', role: UserRole.SUPER_ADMIN, hospitalId: null },
    { email: 'qa-hospital-admin@example.test', role: UserRole.HOSPITAL_ADMIN, hospitalId: primary.id },
    { email: 'qa-doctor@example.test', role: UserRole.DOCTOR, hospitalId: primary.id },
    { email: 'qa-nurse@example.test', role: UserRole.NURSE, hospitalId: primary.id },
    { email: 'qa-receptionist@example.test', role: UserRole.RECEPTIONIST, hospitalId: primary.id },
    { email: 'qa-lab-technician@example.test', role: UserRole.LAB_TECHNICIAN, hospitalId: primary.id },
    { email: 'qa-pharmacist@example.test', role: UserRole.PHARMACIST, hospitalId: primary.id },
    { email: 'qa-accountant@example.test', role: UserRole.ACCOUNTANT, hospitalId: primary.id },
    { email: 'qa-patient@example.test', role: UserRole.PATIENT, hospitalId: primary.id },
    { email: 'qa-patient-other@example.test', role: UserRole.PATIENT, hospitalId: secondary.id },
  ];

  for (const account of accounts) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { passwordHash: qaPasswordHash, role: account.role, hospitalId: account.hospitalId },
      create: { ...account, passwordHash: qaPasswordHash },
    });
    if (account.role === UserRole.DOCTOR) {
      const doctor = await prisma.doctor.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          hospitalId: primary.id,
          userId: user.id,
          licenseNumber: 'QA-DOC-1',
          specialization: 'Cardiology',
          consultationFee: 120,
        },
      });
      await prisma.doctorDepartment.upsert({
        where: { doctorId_departmentId: { doctorId: doctor.id, departmentId: department.id } },
        update: {},
        create: { hospitalId: primary.id, doctorId: doctor.id, departmentId: department.id },
      });
      await prisma.doctorAvailability.deleteMany({ where: { doctorId: doctor.id } });
      await prisma.doctorAvailability.createMany({
        data: [1, 2, 3, 4, 5].map((weekday) => ({
          hospitalId: primary.id,
          doctorId: doctor.id,
          weekday,
          startsAt: '09:00',
          endsAt: '17:00',
          slotMinutes: 30,
        })),
      });
    }
    if (account.role === UserRole.PATIENT) {
      await prisma.patient.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          hospitalId: account.hospitalId as string,
          userId: user.id,
          patientNumber: `QA-${account.hospitalId === primary.id ? '1' : '2'}`,
          firstName: 'Qa',
          lastName: account.email.includes('other') ? 'Other' : 'Primary',
          gender: Gender.UNSPECIFIED,
        },
      });
    }
  }
}

async function run() {
  await main();
  await seedQaAccounts();
}

run().finally(() => prisma.$disconnect());
