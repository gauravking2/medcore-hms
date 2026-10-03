-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "reminder24hSentAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "reminder1hSentAt" SET DATA TYPE TIMESTAMP(3);

-- Phase 6: EMR append-only history, attachments, vitals; doctor signature.
ALTER TABLE "Doctor" ADD COLUMN "signaturePath" TEXT;

CREATE TABLE "MedicalRecordEntry" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "medicalRecordId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalRecordEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MedicalRecordAttachment" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "medicalRecordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalRecordAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VitalSign" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "medicalRecordId" TEXT NOT NULL,
    "systolicBp" INTEGER,
    "diastolicBp" INTEGER,
    "pulse" INTEGER,
    "temperatureCelsius" DECIMAL(4,1),
    "spo2" DECIMAL(4,1),
    "heightCm" DECIMAL(5,2),
    "weightKg" DECIMAL(5,2),
    "bmi" DECIMAL(4,1),
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VitalSign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MedicalRecordEntry_hospitalId_idx" ON "MedicalRecordEntry"("hospitalId");
CREATE INDEX "MedicalRecordEntry_hospitalId_medicalRecordId_createdAt_idx" ON "MedicalRecordEntry"("hospitalId", "medicalRecordId", "createdAt");
CREATE INDEX "MedicalRecordAttachment_hospitalId_idx" ON "MedicalRecordAttachment"("hospitalId");
CREATE INDEX "MedicalRecordAttachment_hospitalId_medicalRecordId_idx" ON "MedicalRecordAttachment"("hospitalId", "medicalRecordId");
CREATE INDEX "VitalSign_hospitalId_idx" ON "VitalSign"("hospitalId");
CREATE INDEX "VitalSign_hospitalId_medicalRecordId_createdAt_idx" ON "VitalSign"("hospitalId", "medicalRecordId", "createdAt");

ALTER TABLE "MedicalRecordEntry" ADD CONSTRAINT "MedicalRecordEntry_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicalRecordEntry" ADD CONSTRAINT "MedicalRecordEntry_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "MedicalRecord"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicalRecordAttachment" ADD CONSTRAINT "MedicalRecordAttachment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicalRecordAttachment" ADD CONSTRAINT "MedicalRecordAttachment_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "MedicalRecord"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "MedicalRecord"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;
