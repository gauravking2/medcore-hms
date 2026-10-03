-- AlterEnum
BEGIN;
CREATE TYPE "LabOrderStatus_new" AS ENUM ('ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'RESULT_UPLOADED', 'APPROVED', 'REJECTED', 'CANCELLED');
ALTER TABLE "public"."LabOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "LabOrder" ALTER COLUMN "status" TYPE "LabOrderStatus_new" USING ("status"::text::"LabOrderStatus_new");
ALTER TYPE "LabOrderStatus" RENAME TO "LabOrderStatus_old";
ALTER TYPE "LabOrderStatus_new" RENAME TO "LabOrderStatus";
DROP TYPE "public"."LabOrderStatus_old";
ALTER TABLE "LabOrder" ALTER COLUMN "status" SET DEFAULT 'ORDERED';
COMMIT;

-- AlterTable
ALTER TABLE "InventoryBatch" ADD COLUMN     "quarantined" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LabOrder" ADD COLUMN     "abnormalFlag" TEXT,
ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "reportMimeType" TEXT,
ADD COLUMN     "reportPath" TEXT,
ADD COLUMN     "reportSizeBytes" INTEGER,
ADD COLUMN     "resultNumeric" DECIMAL(12,4),
ADD COLUMN     "resultUnit" TEXT;

-- AlterTable
ALTER TABLE "LabTest" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rangeHigh" DECIMAL(12,4),
ADD COLUMN     "rangeLow" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "Medicine" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantityDelta" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispensation" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "dispensedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispensation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryLedger_hospitalId_idx" ON "InventoryLedger"("hospitalId");

-- CreateIndex
CREATE INDEX "InventoryLedger_hospitalId_medicineId_createdAt_idx" ON "InventoryLedger"("hospitalId", "medicineId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryLedger_hospitalId_batchId_createdAt_idx" ON "InventoryLedger"("hospitalId", "batchId", "createdAt");

-- CreateIndex
CREATE INDEX "Dispensation_hospitalId_idx" ON "Dispensation"("hospitalId");

-- CreateIndex
CREATE INDEX "Dispensation_hospitalId_prescriptionId_idx" ON "Dispensation"("hospitalId", "prescriptionId");

-- CreateIndex
CREATE INDEX "Dispensation_hospitalId_medicineId_idx" ON "Dispensation"("hospitalId", "medicineId");

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_medicineId_hospitalId_fkey" FOREIGN KEY ("medicineId", "hospitalId") REFERENCES "Medicine"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_medicineId_hospitalId_fkey" FOREIGN KEY ("medicineId", "hospitalId") REFERENCES "Medicine"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispensation" ADD CONSTRAINT "Dispensation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

