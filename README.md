MedCore HMS
MedCore HMS is a full-stack, multi-tenant Hospital Management System built with Next.js, NestJS, PostgreSQL, Prisma, Redis, Socket.IO, BullMQ, and Docker.
Project Status
Development and local QA completed. Deployment pending.
Final local verification:
·	Backend tests: 110/110 passed
·	Playwright: 36/36 passed (Desktop 12/12, Tablet 12/12, Mobile 12/12)
·	UI audit: 45/45 passed
·	TypeScript: PASS
·	Lint: PASS
·	Frontend production build: PASS
·	Backend production build: PASS
·	Fresh database migrations: 7/7 passed
·	Seed: PASS
·	Authentication/RBAC: PASS
·	Tenant isolation: PASS
·	Appointment concurrency: PASS
·	Pharmacy concurrency: PASS
The remaining project work is deployment and final live-environment verification.
Features
Authentication & Security
·	JWT authentication
·	Refresh-token rotation and reuse protection
·	bcrypt password hashing
·	Password reset
·	Role-based access control
·	Hospital-level tenant isolation
·	Audit logging
·	Rate limiting
·	Secure HTTP-only refresh cookies
·	Helmet and CORS protection
·	Safe file-upload validation
·	Encrypted sensitive medical data
·	Broken OTP / 2FA / verification-code flow removed
Hospital Management
·	Hospital management
·	Hospital lifecycle
·	Departments
·	Doctors
·	Staff
·	Role assignment
Patients
·	Patient registration
·	Patient profiles
·	Patient search
·	Tenant-safe patient access
Appointments
·	Doctor availability
·	Slot generation
·	Appointment booking
·	Conflict detection
·	Patient double-booking protection
·	Emergency appointments
·	Appointment status lifecycle
·	Concurrent booking protection
EMR
·	Medical records
·	Medical history
·	Vitals
·	Automatic BMI calculation
·	Allergies
·	Medications
·	Vaccinations
·	Family history
·	Append-only record history
·	Protected diagnosis data
·	Medical attachments
Prescriptions
·	Prescription creation
·	Medicine items
·	Dosage and instructions
·	Digital signatures
·	Prescription PDF generation
Laboratory
·	Lab test catalog
·	Lab orders
·	Sample collection
·	Processing
·	Result upload
·	Automatic abnormal-result classification
·	Result approval
·	Patient visibility controls
Pharmacy & Inventory
·	Medicine management
·	Inventory batches
·	FIFO dispensing
·	Stock tracking
·	Expiry protection
·	Low-stock monitoring
·	Inventory ledger
·	Prescription dispensing
·	Concurrent dispensing protection
Billing & Payments
·	Invoice creation
·	Invoice items
·	Server-side total calculation
·	Invoice finalization/cancellation
·	Partial and full payments
·	Cash payments
·	Stripe/Razorpay payment abstractions
·	Webhook signature verification
·	Payment idempotency
·	Receipt PDF generation
Notifications
·	In-app notifications
·	Read/unread state
·	Socket.IO real-time notifications
·	User-specific notification rooms
·	Email/SMS provider abstractions
·	Background notification jobs
Patient Portal
Patients can access their own:
·	Profile
·	Appointments
·	Medical records
·	Prescriptions
·	Lab results
·	Invoices
·	Payments
·	Notifications
Dashboards & Analytics
Role-specific dashboards for:
·	SUPER_ADMIN
·	HOSPITAL_ADMIN
·	DOCTOR
·	NURSE
·	RECEPTIONIST
·	LAB_TECHNICIAN
·	PHARMACIST
·	ACCOUNTANT
·	PATIENT
Also includes server-side analytics, global search, filtering, and pagination.
Technology Stack
Frontend
·	Next.js 15
·	React 19
·	TypeScript
·	Tailwind CSS
·	shadcn/ui
·	Framer Motion
·	React Hook Form
·	Zod
·	TanStack Query
·	Zustand
Backend
·	NestJS
·	TypeScript
·	Prisma ORM
·	PostgreSQL 16
·	Redis 7
·	Socket.IO
·	BullMQ
·	Swagger / OpenAPI
Infrastructure
·	Docker
·	Docker Compose
·	Nginx
·	GitHub Actions
Architecture
                 ┌───────────────────┐
                 │    Next.js 15     │
                 │     Frontend      │
                 └─────────┬─────────┘
                           │
                      HTTP / Socket.IO
                           │
                 ┌─────────▼─────────┐
                 │      NestJS       │
                 │      Backend      │
                 └──────┬─────┬──────┘
                        │     │
                 ┌──────▼─┐ ┌─▼──────┐
                 │Postgres│ │ Redis  │
                 │ Prisma │ │ BullMQ │
                 └────────┘ └────────┘

Multi-Tenancy
Hospital-scoped data is protected using hospital ownership and server-side tenant checks.
·	SUPER_ADMIN can operate across hospitals.
·	Other roles are restricted to their permitted hospital and resources.
·	Patient data is isolated between patients and hospitals.
Project Structure
medcore-hms/
├── apps/
│   ├── frontend/
│   └── backend/
├── packages/
│   └── types/
├── docs/
├── nginx/
├── .github/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── README.md

Local Setup
1. Clone
git clone https://github.com/gauravking2/medcore-hms.git
cd medcore-hms

2. Install dependencies
npm install

3. Configure environment
Create the required environment files from .env.example.
Do not commit .env or real secrets to GitHub.
4. Start PostgreSQL and Redis
docker compose up -d postgres redis

5. Prepare Prisma
npx prisma generate
npx prisma migrate deploy

6. Seed demo data
npm run prisma:seed

7. Start backend
npm run dev:backend

Backend: http://localhost:3001
Health: http://localhost:3001/health
Swagger: http://localhost:3001/api/docs
8. Start frontend
npm run dev:frontend

Frontend: http://localhost:3000
Testing
npm run typecheck
npm run lint
npm test
npx playwright test
npm run build

QA
The final QA pass covered authentication, all 9 roles, RBAC, tenant isolation, appointments, EMR, prescriptions, laboratory, pharmacy, billing, payments, notifications, patient portal, search, analytics, responsive layouts, themes, accessibility, browser console/network checks, and fresh database migration/seed verification.
The previous rounded-card text overflow issue was fixed and verified across responsive viewports.
Deployment
Planned deployment architecture:
Railway
├── Frontend
├── Backend
├── PostgreSQL
└── Redis

Deployment environment variables must be configured in Railway and must not be committed to GitHub.
After deployment, re-test the frontend, backend, database migrations, authentication, RBAC, tenant isolation, appointments, EMR, prescriptions, laboratory, pharmacy, billing, notifications, and patient portal.
Documentation
Additional documentation is available in docs/.
Important QA report:
docs/QA-REPORT.md
Repository
https://github.com/gauravking2/medcore-hms
Important Notes
·	Payment integrations are suitable for development/test or sandbox use unless production provider credentials are configured.
·	Production deployment requires production-safe environment variables and secrets.
·	Never commit passwords, API keys, JWT secrets, database credentials, or other sensitive values.
License
Academic / project implementation of a Hospital Management System.
MedCore HMS
MedCore HMS is a full-stack, multi-tenant Hospital Management System built with Next.js, NestJS, PostgreSQL, Prisma, Redis, Socket.IO, BullMQ, and Docker.
Project Status
Development and local QA completed. Deployment pending.
Final local verification:
·	Backend tests: 110/110 passed
·	Playwright: 36/36 passed (Desktop 12/12, Tablet 12/12, Mobile 12/12)
·	UI audit: 45/45 passed
·	TypeScript: PASS
·	Lint: PASS
·	Frontend production build: PASS
·	Backend production build: PASS
·	Fresh database migrations: 7/7 passed
·	Seed: PASS
·	Authentication/RBAC: PASS
·	Tenant isolation: PASS
·	Appointment concurrency: PASS
·	Pharmacy concurrency: PASS
The remaining project work is deployment and final live-environment verification.
Features
Authentication & Security
·	JWT authentication
·	Refresh-token rotation and reuse protection
·	bcrypt password hashing
·	Password reset
·	Role-based access control
·	Hospital-level tenant isolation
·	Audit logging
·	Rate limiting
·	Secure HTTP-only refresh cookies
·	Helmet and CORS protection
·	Safe file-upload validation
·	Encrypted sensitive medical data
·	Broken OTP / 2FA / verification-code flow removed
Hospital Management
·	Hospital management
·	Hospital lifecycle
·	Departments
·	Doctors
·	Staff
·	Role assignment
Patients
·	Patient registration
·	Patient profiles
·	Patient search
·	Tenant-safe patient access
Appointments
·	Doctor availability
·	Slot generation
·	Appointment booking
·	Conflict detection
·	Patient double-booking protection
·	Emergency appointments
·	Appointment status lifecycle
·	Concurrent booking protection
EMR
·	Medical records
·	Medical history
·	Vitals
·	Automatic BMI calculation
·	Allergies
·	Medications
·	Vaccinations
·	Family history
·	Append-only record history
·	Protected diagnosis data
·	Medical attachments
Prescriptions
·	Prescription creation
·	Medicine items
·	Dosage and instructions
·	Digital signatures
·	Prescription PDF generation
Laboratory
·	Lab test catalog
·	Lab orders
·	Sample collection
·	Processing
·	Result upload
·	Automatic abnormal-result classification
·	Result approval
·	Patient visibility controls
Pharmacy & Inventory
·	Medicine management
·	Inventory batches
·	FIFO dispensing
·	Stock tracking
·	Expiry protection
·	Low-stock monitoring
·	Inventory ledger
·	Prescription dispensing
·	Concurrent dispensing protection
Billing & Payments
·	Invoice creation
·	Invoice items
·	Server-side total calculation
·	Invoice finalization/cancellation
·	Partial and full payments
·	Cash payments
·	Stripe/Razorpay payment abstractions
·	Webhook signature verification
·	Payment idempotency
·	Receipt PDF generation
Notifications
·	In-app notifications
·	Read/unread state
·	Socket.IO real-time notifications
·	User-specific notification rooms
·	Email/SMS provider abstractions
·	Background notification jobs
Patient Portal
Patients can access their own:
·	Profile
·	Appointments
·	Medical records
·	Prescriptions
·	Lab results
·	Invoices
·	Payments
·	Notifications
Dashboards & Analytics
Role-specific dashboards for:
·	SUPER_ADMIN
·	HOSPITAL_ADMIN
·	DOCTOR
·	NURSE
·	RECEPTIONIST
·	LAB_TECHNICIAN
·	PHARMACIST
·	ACCOUNTANT
·	PATIENT
Also includes server-side analytics, global search, filtering, and pagination.
Technology Stack
Frontend
·	Next.js 15
·	React 19
·	TypeScript
·	Tailwind CSS
·	shadcn/ui
·	Framer Motion
·	React Hook Form
·	Zod
·	TanStack Query
·	Zustand
Backend
·	NestJS
·	TypeScript
·	Prisma ORM
·	PostgreSQL 16
·	Redis 7
·	Socket.IO
·	BullMQ
·	Swagger / OpenAPI
Infrastructure
·	Docker
·	Docker Compose
·	Nginx
·	GitHub Actions
Architecture
                 ┌───────────────────┐
                 │    Next.js 15     │
                 │     Frontend      │
                 └─────────┬─────────┘
                           │
                      HTTP / Socket.IO
                           │
                 ┌─────────▼─────────┐
                 │      NestJS       │
                 │      Backend      │
                 └──────┬─────┬──────┘
                        │     │
                 ┌──────▼─┐ ┌─▼──────┐
                 │Postgres│ │ Redis  │
                 │ Prisma │ │ BullMQ │
                 └────────┘ └────────┘

Multi-Tenancy
Hospital-scoped data is protected using hospital ownership and server-side tenant checks.
·	SUPER_ADMIN can operate across hospitals.
·	Other roles are restricted to their permitted hospital and resources.
·	Patient data is isolated between patients and hospitals.
Project Structure
medcore-hms/
├── apps/
│   ├── frontend/
│   └── backend/
├── packages/
│   └── types/
├── docs/
├── nginx/
├── .github/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── README.md

Local Setup
1. Clone
git clone https://github.com/gauravking2/medcore-hms.git
cd medcore-hms

2. Install dependencies
npm install

3. Configure environment
Create the required environment files from .env.example.
Do not commit .env or real secrets to GitHub.
4. Start PostgreSQL and Redis
docker compose up -d postgres redis

5. Prepare Prisma
npx prisma generate
npx prisma migrate deploy

6. Seed demo data
npm run prisma:seed

7. Start backend
npm run dev:backend

Backend: http://localhost:3001
Health: http://localhost:3001/health
Swagger: http://localhost:3001/api/docs
8. Start frontend
npm run dev:frontend

Frontend: http://localhost:3000
Testing
npm run typecheck
npm run lint
npm test
npx playwright test
npm run build

QA
The final QA pass covered authentication, all 9 roles, RBAC, tenant isolation, appointments, EMR, prescriptions, laboratory, pharmacy, billing, payments, notifications, patient portal, search, analytics, responsive layouts, themes, accessibility, browser console/network checks, and fresh database migration/seed verification.
The previous rounded-card text overflow issue was fixed and verified across responsive viewports.
Deployment
Planned deployment architecture:
Railway
├── Frontend
├── Backend
├── PostgreSQL
└── Redis

Deployment environment variables must be configured in Railway and must not be committed to GitHub.
After deployment, re-test the frontend, backend, database migrations, authentication, RBAC, tenant isolation, appointments, EMR, prescriptions, laboratory, pharmacy, billing, notifications, and patient portal.
Documentation
Additional documentation is available in docs/.
Important QA report:
docs/QA-REPORT.md
Repository
https://github.com/gauravking2/medcore-hms
Important Notes
·	Payment integrations are suitable for development/test or sandbox use unless production provider credentials are configured.
·	Production deployment requires production-safe environment variables and secrets.
·	Never commit passwords, API keys, JWT secrets, database credentials, or other sensitive values.
License
Academic / project implementation of a Hospital Management System.
MedCore HMS
MedCore HMS is a full-stack, multi-tenant Hospital Management System built with Next.js, NestJS, PostgreSQL, Prisma, Redis, Socket.IO, BullMQ, and Docker.
Project Status
Development and local QA completed. Deployment pending.
Final local verification:
·	Backend tests: 110/110 passed
·	Playwright: 36/36 passed (Desktop 12/12, Tablet 12/12, Mobile 12/12)
·	UI audit: 45/45 passed
·	TypeScript: PASS
·	Lint: PASS
·	Frontend production build: PASS
·	Backend production build: PASS
·	Fresh database migrations: 7/7 passed
·	Seed: PASS
·	Authentication/RBAC: PASS
·	Tenant isolation: PASS
·	Appointment concurrency: PASS
·	Pharmacy concurrency: PASS
The remaining project work is deployment and final live-environment verification.
Features
Authentication & Security
·	JWT authentication
·	Refresh-token rotation and reuse protection
·	bcrypt password hashing
·	Password reset
·	Role-based access control
·	Hospital-level tenant isolation
·	Audit logging
·	Rate limiting
·	Secure HTTP-only refresh cookies
·	Helmet and CORS protection
·	Safe file-upload validation
·	Encrypted sensitive medical data
·	Broken OTP / 2FA / verification-code flow removed
Hospital Management
·	Hospital management
·	Hospital lifecycle
·	Departments
·	Doctors
·	Staff
·	Role assignment
Patients
·	Patient registration
·	Patient profiles
·	Patient search
·	Tenant-safe patient access
Appointments
·	Doctor availability
·	Slot generation
·	Appointment booking
·	Conflict detection
·	Patient double-booking protection
·	Emergency appointments
·	Appointment status lifecycle
·	Concurrent booking protection
EMR
·	Medical records
·	Medical history
·	Vitals
·	Automatic BMI calculation
·	Allergies
·	Medications
·	Vaccinations
·	Family history
·	Append-only record history
·	Protected diagnosis data
·	Medical attachments
Prescriptions
·	Prescription creation
·	Medicine items
·	Dosage and instructions
·	Digital signatures
·	Prescription PDF generation
Laboratory
·	Lab test catalog
·	Lab orders
·	Sample collection
·	Processing
·	Result upload
·	Automatic abnormal-result classification
·	Result approval
·	Patient visibility controls
Pharmacy & Inventory
·	Medicine management
·	Inventory batches
·	FIFO dispensing
·	Stock tracking
·	Expiry protection
·	Low-stock monitoring
·	Inventory ledger
·	Prescription dispensing
·	Concurrent dispensing protection
Billing & Payments
·	Invoice creation
·	Invoice items
·	Server-side total calculation
·	Invoice finalization/cancellation
·	Partial and full payments
·	Cash payments
·	Stripe/Razorpay payment abstractions
·	Webhook signature verification
·	Payment idempotency
·	Receipt PDF generation
Notifications
·	In-app notifications
·	Read/unread state
·	Socket.IO real-time notifications
·	User-specific notification rooms
·	Email/SMS provider abstractions
·	Background notification jobs
Patient Portal
Patients can access their own:
·	Profile
·	Appointments
·	Medical records
·	Prescriptions
·	Lab results
·	Invoices
·	Payments
·	Notifications
Dashboards & Analytics
Role-specific dashboards for:
·	SUPER_ADMIN
·	HOSPITAL_ADMIN
·	DOCTOR
·	NURSE
·	RECEPTIONIST
·	LAB_TECHNICIAN
·	PHARMACIST
·	ACCOUNTANT
·	PATIENT
Also includes server-side analytics, global search, filtering, and pagination.
Technology Stack
Frontend
·	Next.js 15
·	React 19
·	TypeScript
·	Tailwind CSS
·	shadcn/ui
·	Framer Motion
·	React Hook Form
·	Zod
·	TanStack Query
·	Zustand
Backend
·	NestJS
·	TypeScript
·	Prisma ORM
·	PostgreSQL 16
·	Redis 7
·	Socket.IO
·	BullMQ
·	Swagger / OpenAPI
Infrastructure
·	Docker
·	Docker Compose
·	Nginx
·	GitHub Actions
Architecture
                 ┌───────────────────┐
                 │    Next.js 15     │
                 │     Frontend      │
                 └─────────┬─────────┘
                           │
                      HTTP / Socket.IO
                           │
                 ┌─────────▼─────────┐
                 │      NestJS       │
                 │      Backend      │
                 └──────┬─────┬──────┘
                        │     │
                 ┌──────▼─┐ ┌─▼──────┐
                 │Postgres│ │ Redis  │
                 │ Prisma │ │ BullMQ │
                 └────────┘ └────────┘

Multi-Tenancy
Hospital-scoped data is protected using hospital ownership and server-side tenant checks.
·	SUPER_ADMIN can operate across hospitals.
·	Other roles are restricted to their permitted hospital and resources.
·	Patient data is isolated between patients and hospitals.
Project Structure
medcore-hms/
├── apps/
│   ├── frontend/
│   └── backend/
├── packages/
│   └── types/
├── docs/
├── nginx/
├── .github/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── README.md

Local Setup
1. Clone
git clone https://github.com/gauravking2/medcore-hms.git
cd medcore-hms

2. Install dependencies
npm install

3. Configure environment
Create the required environment files from .env.example.
Do not commit .env or real secrets to GitHub.
4. Start PostgreSQL and Redis
docker compose up -d postgres redis

5. Prepare Prisma
npx prisma generate
npx prisma migrate deploy

6. Seed demo data
npm run prisma:seed

7. Start backend
npm run dev:backend

Backend: http://localhost:3001
Health: http://localhost:3001/health
Swagger: http://localhost:3001/api/docs
8. Start frontend
npm run dev:frontend

Frontend: http://localhost:3000
Testing
npm run typecheck
npm run lint
npm test
npx playwright test
npm run build

QA
The final QA pass covered authentication, all 9 roles, RBAC, tenant isolation, appointments, EMR, prescriptions, laboratory, pharmacy, billing, payments, notifications, patient portal, search, analytics, responsive layouts, themes, accessibility, browser console/network checks, and fresh database migration/seed verification.
The previous rounded-card text overflow issue was fixed and verified across responsive viewports.
Deployment
Planned deployment architecture:
Railway
├── Frontend
├── Backend
├── PostgreSQL
└── Redis

Deployment environment variables must be configured in Railway and must not be committed to GitHub.
After deployment, re-test the frontend, backend, database migrations, authentication, RBAC, tenant isolation, appointments, EMR, prescriptions, laboratory, pharmacy, billing, notifications, and patient portal.
Documentation
Additional documentation is available in docs/.
Important QA report:
docs/QA-REPORT.md
Repository
https://github.com/gauravking2/medcore-hms
Important Notes
·	Payment integrations are suitable for development/test or sandbox use unless production provider credentials are configured.
·	Production deployment requires production-safe environment variables and secrets.
·	Never commit passwords, API keys, JWT secrets, database credentials, or other sensitive values.
License
Academic / project implementation of a Hospital Management System.
