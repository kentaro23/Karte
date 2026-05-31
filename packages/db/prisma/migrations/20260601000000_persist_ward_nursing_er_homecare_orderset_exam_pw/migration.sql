-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGED', 'TRANSFERRED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BedMoveReason" AS ENUM ('ADMISSION', 'WARD_TRANSFER', 'DEPARTMENT_TRANSFER', 'ROOM_TRANSFER', 'DISCHARGE');

-- CreateEnum
CREATE TYPE "NursingPlanStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'REVISED', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "NursingPlanItemKind" AS ENUM ('DIAGNOSIS', 'GOAL', 'INTERVENTION_O', 'INTERVENTION_T', 'INTERVENTION_E', 'EVALUATION');

-- CreateEnum
CREATE TYPE "PressureUlcerDepth" AS ENUM ('D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'DDTI', 'DU');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('EXPLICIT', 'IMPLIED', 'SURROGATE', 'EMERGENCY_EXCEPTION');

-- CreateEnum
CREATE TYPE "HomeVisitKind" AS ENUM ('DOCTOR', 'NURSE', 'HOME_CARE_GUIDANCE', 'REHAB', 'PHARMACIST', 'OTHER');

-- CreateEnum
CREATE TYPE "HomeVisitSyncState" AS ENUM ('SYNCED', 'OFFLINE_QUEUED');

-- CreateEnum
CREATE TYPE "OrderSetKind" AS ENUM ('RX', 'ORDER');

-- CreateEnum
CREATE TYPE "UsageCategory" AS ENUM ('INTERNAL', 'AS_NEEDED', 'EXTERNAL', 'INJECTION', 'OTHER');

-- AlterEnum
ALTER TYPE "NoteType" ADD VALUE 'HOMECARE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ADMISSION';
ALTER TYPE "AuditAction" ADD VALUE 'DISCHARGE';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER';
ALTER TYPE "AuditAction" ADD VALUE 'USER_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'USER_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'USER_DISABLE';
ALTER TYPE "AuditAction" ADD VALUE 'USER_ENABLE';
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_UNLOCK';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Encounter" ADD COLUMN     "currentBedId" TEXT;

-- AlterTable
ALTER TABLE "ExamMaster" ADD COLUMN     "points" INTEGER;

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dischargedAt" TIMESTAMP(3),
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "admissionReason" TEXT,
    "dischargeReason" TEXT,
    "admittedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedAssignment" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "roomId" TEXT,
    "bedId" TEXT,
    "bedCode" TEXT,
    "reason" "BedMoveReason" NOT NULL DEFAULT 'ADMISSION',
    "note" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BedAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NursingPlan" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "title" TEXT,
    "status" "NursingPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedOn" TIMESTAMP(3),
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NursingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NursingPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "NursingPlanItemKind" NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NursingPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PressureUlcer" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "site" TEXT,
    "depth" "PressureUlcerDepth" NOT NULL DEFAULT 'DU',
    "depthScore" INTEGER NOT NULL DEFAULT 0,
    "exudateScore" INTEGER NOT NULL DEFAULT 0,
    "sizeScore" INTEGER NOT NULL DEFAULT 0,
    "inflammationScore" INTEGER NOT NULL DEFAULT 0,
    "granulationScore" INTEGER NOT NULL DEFAULT 0,
    "necroticScore" INTEGER NOT NULL DEFAULT 0,
    "pocketScore" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "assessedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PressureUlcer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyVisit" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientId" TEXT,
    "chiefComplaint" TEXT,
    "arrivalMethod" TEXT,
    "triageLevelAtArrival" "TriageLevel",
    "consentType" "ConsentType",
    "isUnidentified" BOOLEAN NOT NULL DEFAULT false,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeVisit" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "appointmentId" TEXT,
    "visitKind" "HomeVisitKind" NOT NULL DEFAULT 'DOCTOR',
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "vitals" TEXT,
    "syncState" "HomeVisitSyncState" NOT NULL DEFAULT 'SYNCED',
    "clientId" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSet" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "departmentId" TEXT,
    "ownerUserId" TEXT,
    "kind" "OrderSetKind" NOT NULL DEFAULT 'RX',
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSetItem" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "orderType" "OrderType",
    "drugProductId" TEXT,
    "examMasterId" TEXT,
    "usageCode" TEXT,
    "dosePerTime" DOUBLE PRECISION,
    "doseUnit" TEXT,
    "timesPerDay" DOUBLE PRECISION,
    "days" INTEGER,
    "route" TEXT,
    "detail" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMaster" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" "UsageCategory" NOT NULL DEFAULT 'INTERNAL',
    "timing" TEXT,
    "defaultTimesPerDay" DOUBLE PRECISION,
    "isAsNeeded" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordChangeHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" TEXT,
    "reason" TEXT,
    "mustChangeSet" BOOLEAN NOT NULL DEFAULT false,
    "terminalId" TEXT,

    CONSTRAINT "PasswordChangeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admission_encounterId_key" ON "Admission"("encounterId");

-- CreateIndex
CREATE INDEX "Admission_patientId_status_idx" ON "Admission"("patientId", "status");

-- CreateIndex
CREATE INDEX "Admission_wardId_status_idx" ON "Admission"("wardId", "status");

-- CreateIndex
CREATE INDEX "BedAssignment_encounterId_assignedAt_idx" ON "BedAssignment"("encounterId", "assignedAt");

-- CreateIndex
CREATE INDEX "BedAssignment_patientId_assignedAt_idx" ON "BedAssignment"("patientId", "assignedAt");

-- CreateIndex
CREATE INDEX "BedAssignment_bedId_idx" ON "BedAssignment"("bedId");

-- CreateIndex
CREATE INDEX "NursingPlan_patientId_status_idx" ON "NursingPlan"("patientId", "status");

-- CreateIndex
CREATE INDEX "NursingPlanItem_planId_idx" ON "NursingPlanItem"("planId");

-- CreateIndex
CREATE INDEX "PressureUlcer_patientId_assessedOn_idx" ON "PressureUlcer"("patientId", "assessedOn");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyVisit_encounterId_key" ON "EmergencyVisit"("encounterId");

-- CreateIndex
CREATE INDEX "EmergencyVisit_patientId_idx" ON "EmergencyVisit"("patientId");

-- CreateIndex
CREATE INDEX "HomeVisit_patientId_visitedAt_idx" ON "HomeVisit"("patientId", "visitedAt");

-- CreateIndex
CREATE INDEX "HomeVisit_appointmentId_idx" ON "HomeVisit"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeVisit_clientId_key" ON "HomeVisit"("clientId");

-- CreateIndex
CREATE INDEX "OrderSet_clinicId_kind_idx" ON "OrderSet"("clinicId", "kind");

-- CreateIndex
CREATE INDEX "OrderSet_ownerUserId_idx" ON "OrderSet"("ownerUserId");

-- CreateIndex
CREATE INDEX "OrderSetItem_setId_idx" ON "OrderSetItem"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMaster_code_key" ON "UsageMaster"("code");

-- CreateIndex
CREATE INDEX "UsageMaster_clinicId_category_idx" ON "UsageMaster"("clinicId", "category");

-- CreateIndex
CREATE INDEX "PasswordChangeHistory_userId_changedAt_idx" ON "PasswordChangeHistory"("userId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_currentBedId_key" ON "Encounter"("currentBedId");

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_currentBedId_fkey" FOREIGN KEY ("currentBedId") REFERENCES "Bed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NursingPlan" ADD CONSTRAINT "NursingPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NursingPlanItem" ADD CONSTRAINT "NursingPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "NursingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PressureUlcer" ADD CONSTRAINT "PressureUlcer_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyVisit" ADD CONSTRAINT "EmergencyVisit_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeVisit" ADD CONSTRAINT "HomeVisit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeVisit" ADD CONSTRAINT "HomeVisit_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSetItem" ADD CONSTRAINT "OrderSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "OrderSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordChangeHistory" ADD CONSTRAINT "PasswordChangeHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordChangeHistory" ADD CONSTRAINT "PasswordChangeHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

