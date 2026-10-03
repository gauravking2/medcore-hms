-- Remove OTP/verification tracking columns dropped with the 2-step flow.
-- AlterTable
ALTER TABLE "User" DROP COLUMN "emailVerifiedAt",
DROP COLUMN "phoneVerifiedAt";
