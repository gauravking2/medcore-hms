# MedCore HMS — Local setup (Phase 1 + Phase 2)

## Requirements

- Node.js 22+, npm 10+
- Docker Engine with Compose (for containerized startup)
- A reachable PostgreSQL 16 instance for migrations and seed

## Environment

1. Copy `.env.example` to `.env` (never commit `.env`).
2. The Compose `DATABASE_URL` targets the `postgres` service hostname.
   For host-local Prisma commands, override on the command line:

```cmd
set DATABASE_URL=postgresql://medcore:change-me-locally@localhost:5432/medcore?schema=public
npx prisma migrate dev --schema apps/backend/prisma/schema.prisma
```

## Install and verify

```cmd
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

## Database

```cmd
npx prisma validate --schema apps/backend/prisma/schema.prisma
npx prisma generate --schema apps/backend/prisma/schema.prisma
npx prisma migrate dev --schema apps/backend/prisma/schema.prisma
npm run db:seed --workspace=@medcore/backend
```

The seed creates fictional demo data only: 2 hospitals, departments,
8 doctors across 8 specialisations, 30 patients per hospital,
2 weeks of appointment history, medicines with inventory batches,
lab tests, plus sample prescriptions, lab orders, and invoices.

## Docker

```cmd
docker compose config
docker compose up --build
```

App: `http://localhost:3000` · API health: `http://localhost:3001/health`.

## Notes

- Nginx (`nginx/nginx.conf`) is a plain-HTTP reverse-proxy scaffold.
  TLS is deployment-specific and deliberately not configured.
- Redis 7 is configured via `REDIS_URL`; queue/business use arrives later.
- Do not enter real patient or sensitive health information.
