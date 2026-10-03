# MEDCORE HMS — FINAL QA REPORT

**Test date/time:** 2026-10-03, ~22:19–23:00 +03 (Africa/Nairobi)
**Tester:** Senior QA engineer (automated + live verification)
**Code change during QA:** 1 safe defect fix only (`apps/backend/src/directory/directory.service.ts`, patient-number generation + retry). Rebuilt backend (`npm run build`) and re-tested. No redesigns, no weakened security.

---

## 1. Environment

| Component | Status | Evidence |
|---|---|---|
| PostgreSQL (localhost:5432) | RESPONDING | TCP OK; Prisma connect OK; 28 tables; `migrate status` → "Database schema is up to date!" |
| Redis (localhost:6379) | RESPONDING | Raw `PING` → `+PONG`; refresh sessions + reset tokens stored/rotated correctly |
| Backend (localhost:3001, `node dist/main.js`) | RESPONDING | `GET /health` → `{"status":"ok"}`; `GET /api/docs` → 200; Socket.IO gateway logs connect/disconnect |
| Frontend (localhost:3000, `next start -p 3000`, production build) | RESPONDING | `GET /login` → 200; `GET /dashboard` → 200; `/register` HTML contains "Create an account" |
| BullMQ/workers | PRESENT (in-process) | `bullmq` dependency wired; `reminder.queue.ts`, `expiry.job.ts` present; reminder scheduling covered by scheduling integration tests (16-17 PASS) |
| Socket.IO | RESPONDING | Server logs `Socket connected for user …` / `disconnected`; targeted-delivery + auth covered by engage tests NOTIF-26/27 (PASS) |
| Browser | Chromium (Playwright 1.63.0, chromium-1243, `--no-sandbox`) | E2E + custom audit harness executed for real |

No service was reported PASS on start-only: every row above was verified with a live response.

---

## 2. Overall Result

**PASS**

Rationale: all application functionality verified working — backend **110/110**, Playwright **36/36 (12/12 Desktop, 12/12 Tablet, 12/12 Mobile)**, layout/console/network audit **45/45**, all 9 roles live, all major workflows live or integration-verified, production builds verified. Two findings occurred during QA and both are closed:

1. One genuine application defect (patient-number collision → HTTP 500). Fixed with a minimal safe change and re-verified (see §11 BUG-001).
2. One test-side stale credential in `apps/frontend/e2e/auth.spec.ts` (`superadmin@example.test` + `QaTest!1234`; the dedicated QA super-admin is `qa-super-admin@example.test`). Fixed by aligning the test with the project's existing `qa-*` + `QaTest!1234` seed pattern — **no application, authentication, or login behavior changed** (see §11 BUG-002). Rerun: 12/12 on all viewports.

---

## 3. Authentication

| Test | Result | Evidence |
|---|---|---|
| Registration | PASS | Live `POST /api/auth/register` → 201 (patient, northstar-demo); duplicate → 409 `DUPLICATE_EMAIL`; E2E register-validation flow passes (desktop/tablet/mobile) |
| Login | PASS | All 9 roles live 200 + `/api/auth/me` role match (see §4) |
| Invalid login | PASS | Wrong password → 401 `INVALID_CREDENTIALS` |
| Logout | PASS | `POST /api/auth/logout` → 200; refresh-after-logout → 401 `SESSION_EXPIRED` |
| Session refresh | PASS | Rotation issues new access+refresh tokens; 200 |
| Current-user/session | PASS | `GET /api/auth/me` 200 with correct role/hospitalId; no-auth → 401 `UNAUTHENTICATED` |
| Forgot password | PASS | 200 `{expiresIn: 3600}`, enumeration-safe message; full reset cycle covered by auth integration tests 14–15 (PASS) |
| Password reset | PASS | Integration tests 14–15 PASS (valid + expired/invalid rejected) |
| Protected route without auth | PASS | `/api/auth/me`, `/api/patients` without token → 401 |
| Expired access token | PASS | Forged/expired JWT → 401 `UNAUTHENTICATED` |
| Refresh-token rotation | PASS | Refresh #1 → 200 with new tokens |
| Refresh-token reuse protection | PASS | Reuse of old token → 401 `REFRESH_REUSED` and session revoked (subsequent rotated-token use → `SESSION_EXPIRED`, correct revocation semantics) |
| RBAC | PASS | PATIENT `GET /api/patients` → 403; SUPER_ADMIN sees 4 hospitals vs HOSPITAL_ADMIN 1 (tenant-scoped) |
| Tenant isolation | PASS | Cross-hospital doctor/patient/lab access rejected (directory + integration tests 4,6,7,9,14,18 PASS; live PATIENT hospitals vs SUPER_ADMIN verified) |
| OTP/2FA Removed | PASS | `request-email-otp` / `verify-email` / `request-phone-otp` / `verify-phone-public` → 404 (live + integration test 11 PASS); frontend `src` grep: zero OTP/2FA/MFA/verification-code pages, modals, or flows (only unrelated "verified webhooks" copy + `PENDING_VERIFICATION` hospital status); removal migration `20260930130127_remove_otp_verification_columns` applied |

JWT/refresh security was not weakened: bcrypt cost 12, refresh hashes (sha256) in Redis, reuse revokes session, logout revokes, reset tokens hashed with TTL.

---

## 4. Role Testing

Live: login + `/api/auth/me` for every role (final regression after clean restart). Dashboards: E2E `workflows.spec.ts` "all nine roles see their dashboard workspace" (correct `qa-*` accounts) **passes** on all viewports; custom audit harness swept role routes at 9 breakpoints with 0 failures.

| Role | Result | Notes |
|---|---|---|
| SUPER_ADMIN | PASS | Live login/me OK (`qa-super-admin` + demo `superadmin` both 200); platform analytics 200; sees all hospitals; E2E role-dashboard case 12/12 after BUG-002 test-credential fix |
| HOSPITAL_ADMIN | PASS | Login/me OK; hospital overview; tenant-scoped to own hospital |
| DOCTOR | PASS | Login/me OK; doctor workspace; availability + booking verified live |
| NURSE | PASS | Login/me OK; nursing operations dashboard (E2E PASS) |
| RECEPTIONIST | PASS | Login/me OK; front-desk dashboard (E2E PASS) |
| LAB_TECHNICIAN | PASS | Login/me OK; lab work queue (E2E PASS) |
| PHARMACIST | PASS | Login/me OK; low-stock alerts; expiring-report lists 2021-expired batch |
| ACCOUNTANT | PASS | Login/me OK; revenue/appointment analytics 200 |
| PATIENT | PASS | Login/me OK; health summary; patient-only scoping enforced (cross-patient 403 in integration tests; live patient-list 403) |

Internal matrix (LOGIN / DASHBOARD / NAVIGATION / AUTHORIZATION / TENANT ISOLATION): PASS in every cell for all 9 roles, with the single noted E2E credential exception for SUPER_ADMIN in `auth.spec.ts` only.

---

## 5. Feature Testing

| Feature | Result | Notes |
|---|---|---|
| Hospital | PASS | Create/verify/list tenant-scoped (directory tests 1–4 PASS); lifecycle statuses intact |
| Departments | PASS | CRUD + cross-hospital denied (tests 5–7 PASS); live dept list OK |
| Doctors | PASS | Creation/edit/profile/department assignment; cross-hospital denied; self-promotion/SUPER_ADMIN-grant denied (tests 8–14 PASS) |
| Staff | PASS | Invite + role-change guards (tests 11–14 PASS) |
| Patients | PASS | Creation/view/edit/search; ownership + cross-hospital isolation (tests 15–18 PASS). **Defect found & fixed** (§11 BUG-001); live retest 3×201 with incrementing numbers |
| Availability | PASS | Weekly CRUD, time validation, slot generation, overlap rejection (scheduling tests 1–4 PASS); live availability create 201 + `available-slots` listing |
| Appointments | PASS | Booking/view/cancel/status/emergency/conflicts (tests 5–17 PASS). **Live concurrent booking: exactly 1×201 + 1×409 `SLOT_UNAVAILABLE`** on a free UTC slot; DB holds one appointment |
| EMR | PASS | Create/view/update, append-only entries, vitals + BMI, attachments, AES-256-GCM diagnosis encryption at rest (emr tests 1–12, 20 PASS) |
| Prescriptions | PASS | Create with items/dosage/instructions, validation, cross-hospital medicine rejected, patient-create rejected, signature validation (tests 13–17 PASS) |
| Prescription PDF | PASS | **Live: 2 PDFs → 200 `application/pdf`, 1348 bytes, `%PDF-` header**; unauthorized download rejected (test 19 PASS) |
| Laboratory | PASS | Catalog/order/collect/process/result/abnormal-flag/approve/reject; unauthorized + cross-hospital rejected; **unapproved results hidden, approved visible** (care LAB-1–12 PASS) |
| Pharmacy | PASS | Medicine CRUD, batches, FIFO + spillover, non-negative stock, concurrent-dispense safe, low-stock/expiring detection, fulfilment + audit (care RX-13–26 PASS). Expired batch present (2021); expired/quarantined dispense rejected per RX-16/17 |
| Inventory | PASS | Ledger entries, quarantine, expiry report (live `/api/pharmacy/expiring` 200 with expired batch listed) |
| Billing | PASS | Creation, **server-side totals**, finalize/cancel, transitions, cross-hospital + patient-own scoping (engage BILL-1–7 PASS). **Live: client `total`/`subtotal` rejected 400 (whitelist) — frontend cannot manipulate totals** |
| Payments | PASS | Stripe + Razorpay sandbox initiation, cash flow, **invalid webhook signature → 401 `WEBHOOK_SIGNATURE_INVALID` (live)**, idempotency + duplicate handling, verified-only paid status, receipt (engage PAY-8–17 PASS). No prod credentials — sandbox only, as required |
| Notifications | PASS | In-app list/unread/read, event fan-out, staff-only low-stock, emergency-to-doctor, isolation + socket targeted delivery + retry idempotency (engage NOTIF-18–29 PASS); live `/api/notifications/me` 200; Socket.IO connect/disconnect observed in server logs |
| Patient Portal | PASS | Own appointments/records/prescriptions/labs/invoices/payments; cross-patient blocked (engage PORTAL-30–38 PASS) |
| Search | PASS | **Live `GET /api/search?entity=patients|doctors|medicines&q=a` → 200 (totals 30/23/6)**; empty → 200 total 0; role-entity matrix enforced (PATIENT none; e.g. ACCOUNTANT medicines-only); tenant isolation (insights SEARCH/FILTERS/ACTIVITY PASS). Note: singular `entity=patient` correctly 403 — plural nouns are the API contract |
| Analytics | PASS | Overview/revenue/appointments per role + tenant scope, occupancy, low-stock, date filtering (insights DASH/ANALYTICS PASS); live overview 200 with revenue/appointment/patient/doctor/bed/department/lowStock keys |

---

## 6. UI / Responsive Testing

Custom Chromium harness (`.qa-tools/audit.mjs`) walks **every element** on guest + all 9 role route sets, measuring page overflow, elements crossing the viewport, and children painted above rounded-container content boxes (the reported "Find and book" / "Today's signal" corner-escape class), plus console/pageerror and non-backend network failures.

- Full sweep: **45/45 checks, 0 overflow, 0 escaped-rounded, 0 outside-viewport, 0 console, 0 network**
- Quick sweep: 15/15, same zeros
- Breakpoints covered: 320, 360, 390, 430, 768, 1024, 1280, 1440, 1920
- Long-content handling: verified by code + audit — `.mc-card/.mc-glass/.mc-stat/.mc-state/.mc-error/.mc-timeline-card` use `min-width:0 + overflow:hidden` **combined with** `overflow-wrap:break-word`, grid `minmax(0,1fr)`, ellipsis meters, and `.table-scroll{overflow-x:auto}` for tables (no blind clipping; truncation only on meter labels/buttons with ellipsis)
- Horizontal scrolling: PASS (0 overflow issues across all breakpoints)
- Mobile (390×844): PASS · Tablet (768×1024): PASS · Desktop (1440×900): PASS (also 320/360/430/1024/1920: PASS)
- Dark mode: PASS · Light mode: PASS · Persistence: **PASS** (toggle dark→light, `localStorage medcore-theme=light`, reload keeps light, body colors switch dark navy ↔ light `rgb(238,242,249)/rgb(15,28,52)`, 0 page errors)
- Accessibility: PASS (labeled inputs — E2E register/login flows use `getByLabel` and pass; `aria-label` on theme toggle; `sr-only` helper present)
- Every major page rendered for real (login, register, forgot/reset, dashboard ×9 roles, appointments, records, lab-pharmacy, billing, notifications, search, portal, hospitals, encounters, schedule) — not merely load-checked: audit waits `networkidle` + 300ms per page/breakpoint and records live DOM metrics

---

## 7. Browser QA

| Check | Result |
|---|---|
| Console errors | **None** — 0 across 45-check full audit (console + pageerror listeners on every page) |
| Hydration errors | None observed |
| Unexpected network errors | **None** — 0 (4xx on purpose-tested business rules only, e.g. 403/409/401 negatives documented in §3/§5) |
| Broken resources | None (all Playwright page loads + audit `networkidle` navigations succeeded) |
| Broken navigation | None (guest + role route sweeps all navigated; E2E navigation tests pass except the one credential case) |

Expected business-rule errors during negative testing (401/403/404/409) are documented in §3/§5 and were not counted as failures.

---

## 8. Security

| Control | Result |
|---|---|
| RBAC | PASS — role guards + per-entity search matrix; patient list 403; unauthorized invoice/lab/prescription actions rejected (integration PASS) |
| Tenant isolation | PASS — `hospitalId` server-derived (`resolveHospitalScope`), composite FKs, cross-hospital 403s everywhere incl. live checks |
| Patient isolation | PASS — patients see only own profile/records/portal data |
| JWT | PASS — short-lived access, bearer + `passport-jwt`, bad/expired → 401 |
| Refresh rotation + reuse rejection | PASS — live verified (§3) |
| Password hashing | PASS — bcrypt cost 12 (`BCRYPT_COST=12`, `isBcryptHash` test PASS); no plaintext in DB or responses (`passwordHash` undefined in API payloads) |
| Validation | PASS — global `ValidationPipe {whitelist, transform, forbidNonWhitelisted}`; invoice `total` injection → 400; appointment `hospitalId` injection → 400 |
| Rate limiting | PASS — observed 429 under parallel load; `ThrottlerGuard` on auth controller; E2E harness retries 429 with backoff |
| CORS | PASS — explicit origins (`http://localhost:3000`), `credentials:true` |
| Helmet | PASS — live headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` |
| Audit logs | PASS — login/register/patient/appointment/EMR/pharmacy writes recorded (tests assert counts; live DB holds 99+ audit rows) |
| Safe file uploads | PASS — allowlist MIME + extension map, 20MB EMR / 2MB signature caps, memory storage + abstraction layer (tests 10–12, 17 PASS) |
| Encrypted medical data | PASS — AES-256-GCM (`gcm:iv:tag:data`) for diagnosis, key from `JWT_SECRET`; encrypted-at-rest test PASS |
| Appointment concurrency | PASS — live 1×201 + 1×409; integration critical test PASS |
| Pharmacy concurrency | PASS — integration RX-20/21 PASS (stock never negative, concurrent dispense safe) |
| Payment signatures + idempotency | PASS — invalid signature live 401; idempotent webhooks (tests PAY-12–14 PASS) |
| Invoice integrity | PASS — server-computed totals; client total rejected (§5) |
| Secret exposure | PASS — no passwords/JWTs/refresh tokens/API keys in logs or responses (integration test 17/20b PASS; server logs contain no tokens) |

---

## 9. Database

| Check | Result |
|---|---|
| Prisma validation | PASS — `prisma validate` → "valid 🚀" |
| Migration status | PASS — 7 migrations, "Database schema is up to date!" |
| Fresh-database migration | PASS — temp DB `medcore_qa_fresh`: `migrate deploy` applied **7/7** cleanly (phase2_init, phase3_auth_fields, phase5_slot_protection, phase6_emr_attachments, phase7_lab_pharmacy, phase8_billing_payments, remove_otp_verification_columns). Temp DB dropped afterwards; **main DB never reset** |
| Seed | PASS — fresh DB seed exit 0 → 21 users / 2 hospitals / 62 patients |
| Connectivity | PASS — Prisma connect OK; 28 tables; main DB live counts (users 57+, hospitals 4, departments 22, doctors 15–20, patients 63+, appointments 56+, records/prescriptions/lab/invoices present, audit 99+) |
| Relations/indexes | PASS — `schema-invariants.spec.ts` PASS; composite tenant FKs + `@@unique([hospitalId, …])` + indexes verified in schema |

---

## 10. Automated Tests

| Suite | Result (exact) |
|---|---|
| Backend unit + integration (`npx jest --runInBand`) | **110 passed / 110 total, 9/9 suites** (after BUG-001 fix). Before fix: 35 passed / 110 (75 failed, all from the patient-number defect) |
| Frontend tests | No component tests configured (`test` script echoes placeholder) — honestly N/A |
| Playwright desktop (1440×900) | **12 passed / 12** |
| Playwright tablet (768×1024) | **12 passed / 12** |
| Playwright mobile (390×844) | **12 passed / 12** (combined **36/36**; closure rerun after BUG-002 test-credential fix: auth.spec.ts 2/2, then full suites 12/12 per viewport) |
| Custom Chromium audit (9 breakpoints × all roles) | **45/45 checks, 0 failures** |
| TypeScript backend (`tsc --noEmit`) | PASS, 0 errors (before and after fix) |
| TypeScript frontend | PASS, 0 errors |
| Lint backend | PASS, 0 problems |
| Lint frontend | PASS — 0 errors, 2 warnings (both `import/no-anonymous-default-export` on config files, pre-existing) |
| Frontend production build (`next build`) | PASS — all 17 routes built (static + dynamic) |
| Backend production build (`nest build`) | PASS |
| Production start (both) | PASS — backend (production env) `/health` OK; frontend serves fresh build, login/dashboard 200 |

No failing test was deleted, skipped, disabled, or weakened. One full-suite Playwright run observed during an earlier rebuild showed 12 transient failures (client-side chunk mismatch while `next start` served a replaced `.next`); after clean restart the stable pre-closure result was 11/12 per viewport (single stale-credential case), and after the one-line BUG-002 test fix the final rerun is 12/12 per viewport as reported. No test was bypassed to obtain this: the fix used the seeded QA account and the failure was re-executed to green.

---

## 11. Bugs Found

### BUG-001 — Patient creation returns 500 on populated databases (HIGH, FIXED)
- **Page/module:** `POST /api/patients` (Directory → `nextPatientNumber`)
- **Description:** Creating a patient failed with `500 INTERNAL_ERROR` (`Unique constraint failed on (hospitalId, patientNumber)`) on the main database, failing 75/110 backend tests when run against real data.
- **Root cause:** `nextPatientNumber` used `findFirst … orderBy: { patientNumber: 'desc' }` (lexical string sort) and parsed only the last row's trailing number. Legacy mixed-format numbers (`QA-1`, `1-030`, `CMUS-0002`) sort lexically with `QA-1` first, yielding `CMUS-0002` — already taken. No retry on `P2002`, and the exception filter maps unknown Prisma errors to 500.
- **Fix:** Scan all `patientNumber`s for the hospital, take the max **numeric** trailing suffix, skip taken candidates, and retry up to 5× on `P2002` (concurrency-safe); persistent collision surfaces as 409 `PATIENT_NUMBER_CONFLICT` via `ConflictException`. File: `apps/backend/src/directory/directory.service.ts` (+`ConflictException` import). Backend rebuilt.
- **Retest:** Live `POST /api/patients` ×3 → 201 with `CMUS-0031/0032/0033`; full backend suite **110/110** (was 35/110); final regression patient flows PASS.

### BUG-002 — E2E `auth.spec.ts` used wrong SUPER_ADMIN credential (LOW, TEST-SIDE, FIXED)
- **Page/module:** `apps/frontend/e2e/auth.spec.ts:81` ("all nine roles can reach role dashboards")
- **Description:** Test logged in as `superadmin@example.test` with password `QaTest!1234` → 401 `INVALID_CREDENTIALS`. Seed credentials: the dedicated QA account is `qa-super-admin@example.test` / `QaTest!1234` (see `seedQaAccounts()` — "Dedicated QA accounts used by the Playwright suites … All use the shared password `QaTest!1234`"); `superadmin@example.test` is the demo account (`MedCore!Demo1`).
- **Root cause:** Stale test data, not an application defect — the API correctly rejected the wrong password, and no login behavior was changed.
- **Fix (test-side only, one line):** `superadmin@example.test` → `qa-super-admin@example.test`, matching the existing `qa-*` + `QaTest!1234` pattern already used by `workflows.spec.ts` and the other 8 cases in the same test. No new secrets introduced (`QaTest!1234` was already used throughout the file), no application code touched, authentication strength unchanged. Verified via diff: exactly 1 line differs.
- **Retest:** `auth.spec.ts` 2/2 on desktop; full suites **12/12 Desktop, 12/12 Tablet, 12/12 Mobile (36/36)**. Regression: `qa-super-admin` login 200 SUPER_ADMIN, demo `superadmin` login still 200, platform analytics 200, patient RBAC 403, tenant scoping 8 vs 1 hospitals; backend `auth.integration.spec.ts` 14/14.

---

## 12. Remaining Issues

1. **Rate limiting is aggressive under parallel load** — live probes hit 429 when jest/Playwright/audit run concurrently. This is by-design protection (auth endpoints throttled), not a defect; harnesses retry with backoff. Worth noting for CI parallelism tuning.
2. **Payments verified in sandbox/test mode only** — Stripe/Razorpay flows use simulate/test paths; no production credentials exist, so real-money delivery is (correctly) unclaimed.
3. **Environmental limitation:** Docker daemon unavailable in this environment (`permission denied /var/run/docker.sock`), so containerized `docker compose` startup was not exercised; services were started directly (`node dist/main.js`, `next start`) with equivalent env. Native PostgreSQL/Redis were used.
4. Frontend `lint` carries 2 pre-existing config-file warnings (no errors).

No other issues found during the executed verification.

---

## 13. Final Recommendation

**The application passes final acceptance: Playwright Desktop 12/12, Tablet 12/12, Mobile 12/12 (36/36), backend 110/110, audit 45/45.** All 9 roles authenticate and operate within tenant/patient isolation (closure regression: `qa-super-admin` 200, platform analytics 200, patient RBAC 403, tenant scoping 8 vs 1 hospitals; backend auth suite 14/14). All major clinical, inventory, billing, payment, notification, portal, search, and analytics workflows are verified by live probing plus fully green suites, and production builds start and serve correctly. Both QA findings are closed: the patient-number defect was fixed with a minimal safe change and re-verified end-to-end, and the E2E credential was aligned to the seeded QA account with a one-line test-only change (no application or authentication behavior altered). Recommended next steps before production: provision production payment credentials and re-verify webhooks, and run the suite once more in CI with Docker Compose.

---

## 14. CI Closure (2026-10-04)

- **Workflow:** `.github/workflows/ci.yml` (`quality` job) — added PostgreSQL 16 + Redis 7 service containers (ports 5433:5432 / 6380:6379, health checks), CI-only `DATABASE_URL`/`REDIS_URL`/`JWT_SECRET`, and ordered steps: `npm ci` → Prisma generate → migrate deploy (7/7) → seed → lint → typecheck → test → build.
- **BUG-003 (HIGH, FIXED):** concurrent pharmacy dispense could abort with Postgres 40001 under `Serializable` isolation and surface HTTP 500 (CI run 37145141585: 109/110, RX-20/21). Fix in `apps/backend/src/care/care.service.ts`: bounded retry (×3) on serialization failure with stock re-check; genuine shortage → 409 `INSUFFICIENT_STOCK`, sustained contention → 409 `CONCURRENT_UPDATE_CONFLICT`. No test changed; isolation level unchanged.
- **GitHub Actions run 37145682803 (commit `2e4b3b6`): PASS** — PG healthy, Redis healthy, migrate 7/7, seed PASS, backend **110/110**, lint PASS, typecheck PASS, build PASS.
