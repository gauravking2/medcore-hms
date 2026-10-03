# MedCore HMS — Architecture (Phase 1 + Phase 2)

## Purpose

MedCore HMS is a multi-hospital health management system foundation.
Phase 1 delivers project scaffolding and infrastructure only.
Phase 2 delivers the normalized PostgreSQL/Prisma domain schema with
hospital tenant isolation, plus demo seed data.

No authentication, authorization, or clinical workflows are implemented yet.
Those arrive in Phase 3/4.

## Layout

```text
apps/frontend      Next.js 15 + React 19 + Tailwind CSS 4 + shadcn/ui foundation
apps/backend       NestJS 10 API, health endpoint, domain module extension points
packages/types     Shared UserRole enum and API response contracts
apps/backend/prisma  Prisma schema, migrations, seed script
nginx/nginx.conf   Reverse-proxy scaffold (plain HTTP; TLS is deployment-specific)
.github/workflows  CI: lint, typecheck, tests, build
docs/              This documentation
```

## Backend modules (extension points)

`apps/backend/src/modules.ts` declares one empty module per future domain:
auth, users, hospitals, departments, doctors, patients, appointments,
medical-records, prescriptions, lab, pharmacy, billing, notifications,
analytics, audit. Business logic is intentionally not implemented yet.

## Database (Phase 2)

See `apps/backend/prisma/schema.prisma` — Hospital, User, Address,
Department, Doctor (+ DoctorDepartment, DoctorAvailability), Patient, Room,
Appointment, MedicalRecord, Prescription (+ PrescriptionItem), Medicine
(+ InventoryBatch), LabTest, LabOrder, Invoice (+ InvoiceItem), Notification,
AuditLog.

Tenant isolation is structural: tenant-scoped rows carry `hospitalId` and
cross-tenant relations use composite foreign keys such as
`Appointment(patientId, hospitalId) -> Patient(id, hospitalId)`.

## Data flow

```text
Browser -> Nginx (:80) -> frontend (:3000) / backend (:3001)
Backend -> PostgreSQL (:5432), Redis (:6379, URL-configured)
```
