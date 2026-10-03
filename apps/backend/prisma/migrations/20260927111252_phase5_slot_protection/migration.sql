-- Phase 5: concurrency-safe appointment slot protection + reminder columns.
--
-- DECISION: Postgres EXCLUDE constraints are the ideal guard, but Prisma's
-- shadow-database introspection cannot reproduce gist exclusion constraints
-- (functions in index expression must be marked IMMUTABLE under the connector),
-- so P3006 blocks `migrate dev` even though the live database would accept it.
-- Instead the protection is implemented as:
--   1. a SERIALIZABLE transaction that takes a per-doctor advisory lock
--      (pg_advisory_xact_lock over hashtext(doctorId + slot)), then
--   2. re-checks overlap inside the same transaction before INSERT.
-- The DATABASE remains the source of truth: the advisory lock serializes all
-- concurrent writers for the same slot, and a defensive overlap re-check
-- inside the transaction turns losers into structured SLOT_UNAVAILABLE errors.
-- No JavaScript/in-memory locking is used as the primary protection.
--
-- Reminder columns let the BullMQ scheduler store stable job ids (idempotent
-- scheduling via fixed jobId) and record when each reminder was delivered.
ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "reminder24hJobId" TEXT,
  ADD COLUMN IF NOT EXISTS "reminder1hJobId" TEXT,
  ADD COLUMN IF NOT EXISTS "reminder24hSentAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "reminder1hSentAt" TIMESTAMPTZ(6);
