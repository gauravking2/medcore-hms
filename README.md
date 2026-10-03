# MedCore HMS — Phase 1 foundation

A TypeScript monorepo foundation for a multi-hospital health management system. This phase intentionally delivers infrastructure and route/module scaffolding only; it does not implement authentication, patient data, clinical workflows, or production deployment.

## Stack
- Frontend: Next.js 15, React 19, TypeScript (strict), Tailwind CSS 4, shadcn/ui foundation (`src/components/ui`), Framer Motion, React Hook Form + Zod, TanStack Query, Zustand.
- Backend: NestJS 10, TypeScript, validation pipeline, health endpoint.
- Data/infrastructure: Prisma with PostgreSQL schema foundation, Redis URL configuration, Docker Compose, Nginx and GitHub Actions scaffolds.
- Shared contracts: role and API response types in `packages/types`.

## Requirements
Node.js 22+ and npm 10+ for local checks; Docker Engine with Compose for containerized startup.

## Local startup
1. Copy `.env.example` to `.env`. Values provided are development placeholders only; choose private local values and never reuse them in shared or production environments.
2. From the repository root run `docker compose up --build`.
3. Visit `http://localhost:3000`; backend health check is `http://localhost:3001/health`.
4. Stop with Ctrl+C; `docker compose down` stops containers. Add `-v` only if you explicitly intend to delete the local database volume.

The Compose database URL is constructed from the POSTGRES variables for container networking. No migrations or clinical models are included in Phase 1.

## Quality commands
`npm install`
`npx prisma generate --schema apps/backend/prisma/schema.prisma`
`npm run lint`
`npm run typecheck`
`npm test`
`npm run build`

## Layout
- `apps/frontend`: public, login, registration, dashboard, and portal starter routes (`/`, `/login`, `/register`, `/dashboard`, `/portal`).
- `apps/backend`: NestJS API, `GET /health`, empty extension modules (`auth`, `users`, `hospitals`, `departments`, `doctors`, `patients`, `appointments`, `medical-records`, `prescriptions`, `lab`, `pharmacy`, `billing`, `notifications`, `analytics`, `audit`), and Prisma schema.
- `packages/types`: shared role and response contracts.
- `apps/backend/prisma`: schema, migrations, and demo seed script.
- `nginx/nginx.conf`: reverse proxy scaffold; TLS is deliberately not configured.
- `docs/`: architecture and setup guides.

## Security and scope
This is not a production-ready medical system. Do not enter real patient or other sensitive health information. Before any real deployment, the system needs security/privacy review, real authentication and authorization, audit controls, data protection, TLS, operational monitoring, and jurisdiction-specific compliance work. See `docs/architecture.md` and `docs/setup.md` for details.
