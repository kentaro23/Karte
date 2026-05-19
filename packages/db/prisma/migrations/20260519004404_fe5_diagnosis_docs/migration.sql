-- CreateEnum
CREATE TYPE "DiagnosisStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'DELETED');

-- CreateEnum
CREATE TYPE "DiseaseOutcome" AS ENUM ('CURED', 'IMPROVED', 'UNCHANGED', 'TRANSFERRED', 'DECEASED', 'STOPPED');

-- CreateEnum
CREATE TYPE "ReferralDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('DRAFT', 'PRINTED', 'SENT', 'AWAITING_REPLY', 'REPLY_RECEIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SummaryStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateTable
CREATE TABLE "PatientDiagnosis" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "masterCode" TEXT,
    "displayName" TEXT NOT NULL,
    "icd10" TEXT,
    "departmentId" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "isSuspected" BOOLEAN NOT NULL DEFAULT false,
    "acuteChronic" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "DiseaseOutcome",
    "outcomeDate" TIMESTAMP(3),
    "forBilling" BOOLEAN NOT NULL DEFAULT true,
    "status" "DiagnosisStatus" NOT NULL DEFAULT 'ACTIVE',
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "direction" "ReferralDirection" NOT NULL DEFAULT 'OUTBOUND',
    "partnerFacility" TEXT NOT NULL,
    "partnerDoctor" TEXT,
    "internalDeptId" TEXT,
    "internalUserId" TEXT,
    "purpose" TEXT NOT NULL,
    "chiefComplaint" TEXT,
    "diseaseState" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'DRAFT',
    "desiredVisitOn" TIMESTAMP(3),
    "replyText" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalDocument" (
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "encounterId" TEXT,
    "docType" TEXT NOT NULL,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "storageUrl" TEXT,
    "scannedPages" INTEGER,
    "ocrText" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DischargeSummary" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "admissionRef" TEXT,
    "status" "SummaryStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalStatus" TEXT NOT NULL DEFAULT 'UNAPPROVED',
    "authorUserId" TEXT NOT NULL,
    "approverUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "admissionCourse" TEXT,
    "presentIllness" TEXT,
    "hospitalCourse" TEXT,
    "dischargePlan" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DischargeSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientDiagnosis_patientId_status_idx" ON "PatientDiagnosis"("patientId", "status");

-- CreateIndex
CREATE INDEX "Referral_patientId_idx" ON "Referral"("patientId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE INDEX "ClinicalDocument_patientId_docType_idx" ON "ClinicalDocument"("patientId", "docType");

-- CreateIndex
CREATE INDEX "DischargeSummary_patientId_idx" ON "DischargeSummary"("patientId");

-- AddForeignKey
ALTER TABLE "PatientDiagnosis" ADD CONSTRAINT "PatientDiagnosis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
