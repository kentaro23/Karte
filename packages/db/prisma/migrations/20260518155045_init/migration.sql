-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DOCTOR', 'RESIDENT', 'NURSE', 'PHARMACIST', 'CLERK', 'TECHNOLOGIST', 'THERAPIST', 'DIETITIAN', 'MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ABO" AS ENUM ('A', 'B', 'O', 'AB', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Rh" AS ENUM ('POSITIVE', 'NEGATIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EncounterType" AS ENUM ('OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'CHECKUP', 'HOMECARE');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('FIRST', 'RETURN');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('FACE', 'PHONE', 'ONLINE', 'NON_CONSULT');

-- CreateEnum
CREATE TYPE "ReceptionStatus" AS ENUM ('UNRECEIVED', 'ARRIVED', 'QUESTIONNAIRE_IN_PROGRESS', 'QUESTIONNAIRE_DONE', 'READY', 'IN_CONSULTATION', 'SUSPENDED', 'CONSULTATION_DONE', 'BILLING_DONE', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "TriageLevel" AS ENUM ('L1_RESUSCITATION', 'L2_EMERGENT', 'L3_URGENT', 'L4_LESS_URGENT', 'L5_NON_URGENT');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'ARRIVED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "NoteType" AS ENUM ('PROGRESS', 'NURSING', 'NUTRITION', 'REPORT', 'REHAB', 'ER', 'ASSESSMENT', 'SYMPTOM_DETAIL');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('EDITING', 'SAVED', 'LOCKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CountersignStatus" AS ENUM ('UNAPPROVED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StickyScope" AS ENUM ('PRIVATE', 'CLINIC_WIDE');

-- CreateEnum
CREATE TYPE "TemplateScope" AS ENUM ('COMMON', 'DEPARTMENT', 'DOCTOR');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('RX', 'INJECTION', 'TREATMENT', 'LAB', 'BACTERIOLOGY', 'PATHOLOGY', 'PHYSIOLOGY', 'RADIOLOGY', 'ENDOSCOPY', 'DIALYSIS', 'REHAB', 'GUIDANCE', 'CHEMO', 'SURGERY', 'TRANSFUSION', 'MEAL', 'REFERRAL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'REQUESTED', 'RECEIVED', 'IN_PROGRESS', 'PARTIALLY_DONE', 'DONE', 'RESULT_ARRIVED', 'APPROVED', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "DispenseType" AS ENUM ('IN_HOUSE', 'OUT_OF_HOUSE');

-- CreateEnum
CREATE TYPE "AllergyType" AS ENUM ('DRUG', 'FOOD', 'OTHER');

-- CreateEnum
CREATE TYPE "DrugDataSource" AS ENUM ('MHLW_RECEIPT', 'MEDIS', 'PMDA_PI_STRUCTURED', 'PMDA_PI_XML', 'PHARMACIST_VERIFIED', 'CURATED_SEED');

-- CreateEnum
CREATE TYPE "DrugTargetKind" AS ENUM ('PRODUCT', 'INGREDIENT');

-- CreateEnum
CREATE TYPE "ContraSeverity" AS ENUM ('ABSOLUTE', 'RELATIVE');

-- CreateEnum
CREATE TYPE "ContraConditionType" AS ENUM ('DISEASE', 'STATE', 'AGE', 'PREGNANCY', 'LACTATION', 'LAB', 'CO_ADMINISTRATION', 'HYPERSENSITIVITY');

-- CreateEnum
CREATE TYPE "InteractionCounterpart" AS ENUM ('DRUG_INGREDIENT', 'ATC_CLASS', 'FOOD', 'DRUG_PRODUCT');

-- CreateEnum
CREATE TYPE "InteractionSeverity" AS ENUM ('CONTRAINDICATED_COMBO', 'CAUTION_COMBO');

-- CreateEnum
CREATE TYPE "DosagePopulation" AS ENUM ('ADULT', 'PEDIATRIC', 'ELDERLY', 'NEONATE', 'PREGNANT');

-- CreateEnum
CREATE TYPE "RuleCheckType" AS ENUM ('CONTRAINDICATION', 'INTERACTION', 'DOSE_MAX', 'DUPLICATE', 'ALLERGY', 'DISEASE_CONTRA', 'PREGNANCY_LACTATION', 'RENAL', 'HEPATIC', 'AGE', 'INFECTION');

-- CreateEnum
CREATE TYPE "RuleResult" AS ENUM ('PASS', 'WARNING', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RuleCheckedBy" AS ENUM ('STATIC_DB', 'PHARMACIST_REVIEW');

-- CreateEnum
CREATE TYPE "AclLevel" AS ENUM ('NO_ACCESS', 'PASSWORD_REQUIRED', 'VIEW_ONLY', 'VIEW_AND_WRITE');

-- CreateEnum
CREATE TYPE "AclScope" AS ENUM ('ALL', 'CARE_TEAM_ONLY');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'USER_SWITCH', 'SCREENSAVER_UNLOCK', 'PATIENT_SELECT', 'CHART_OPEN', 'CHART_VIEW', 'CHART_WRITE', 'CHART_AMEND', 'ORDER_ISSUE', 'ORDER_CHECK', 'PRESCRIPTION_OVERRIDE', 'COUNTERSIGN', 'PRINT', 'FILE_EXPORT', 'RESTRICTED_ACCESS', 'MASTER_IMPORT', 'PATIENT_MERGE');

-- CreateEnum
CREATE TYPE "MasterType" AS ENUM ('DRUG', 'DISEASE', 'EXAM', 'MEDICAL_FEE', 'MATERIAL', 'GENERIC');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CLINIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ward" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "genderPolicy" TEXT NOT NULL DEFAULT 'MIXED',

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bed" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Bed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "staffNo" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKana" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "mustChange" BOOLEAN NOT NULL DEFAULT false,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MfaFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "userId" TEXT,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "terminalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "terminalId" TEXT,
    "prevLoginAt" TIMESTAMP(3),
    "prevTerminal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "allow" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "allow" BOOLEAN NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAccessControl" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "level" "AclLevel" NOT NULL DEFAULT 'VIEW_AND_WRITE',
    "scope" "AclScope" NOT NULL DEFAULT 'ALL',
    "jobType" "JobType",

    CONSTRAINT "PatientAccessControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "actorUserId" TEXT,
    "patientId" TEXT,
    "action" "AuditAction" NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "terminalId" TEXT,
    "ip" TEXT,
    "result" TEXT NOT NULL DEFAULT 'OK',
    "detail" JSONB,
    "prevHash" TEXT,
    "rowHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartLock" (
    "id" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "lockedByUserId" TEXT NOT NULL,
    "lockedByName" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "contact" TEXT,
    "lockType" TEXT NOT NULL DEFAULT 'WRITE',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChartLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFavoriteTool" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserFavoriteTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearchCondition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "screenKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conditionJson" JSONB NOT NULL,

    CONSTRAINT "SavedSearchCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientNo" TEXT NOT NULL,
    "kanaLastName" TEXT NOT NULL,
    "kanaFirstName" TEXT NOT NULL,
    "kanjiLastName" TEXT NOT NULL,
    "kanjiFirstName" TEXT NOT NULL,
    "formerName" TEXT,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" "Gender" NOT NULL,
    "bloodTypeABO" "ABO" NOT NULL DEFAULT 'UNKNOWN',
    "bloodTypeRh" "Rh" NOT NULL DEFAULT 'UNKNOWN',
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "vipPasswordHash" TEXT,
    "isTemporaryId" BOOLEAN NOT NULL DEFAULT false,
    "photoUrl" TEXT,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "AllergyType" NOT NULL,
    "substance" TEXT NOT NULL,
    "ingredientCode" TEXT,
    "reaction" TEXT,
    "severity" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Infection" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "pathogen" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "testedAt" TIMESTAMP(3),

    CONSTRAINT "Infection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalHistory" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occurredOn" TIMESTAMP(3),

    CONSTRAINT "MedicalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "relatedPatientId" TEXT,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insurance" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "payerType" TEXT NOT NULL,
    "payerNo" TEXT,
    "symbol" TEXT,
    "number" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),

    CONSTRAINT "Insurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProfile" (
    "patientId" TEXT NOT NULL,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "egfr" DOUBLE PRECISION,
    "hepaticClass" TEXT,
    "isPregnant" BOOLEAN NOT NULL DEFAULT false,
    "isLactating" BOOLEAN NOT NULL DEFAULT false,
    "smoking" JSONB,
    "drinking" JSONB,
    "customFields" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("patientId")
);

-- CreateTable
CREATE TABLE "PatientSelectionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientSelectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentSlot" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "doctorUserId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AppointmentSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "doctorUserId" TEXT,
    "slotId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CONSULT',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "encounterType" "EncounterType" NOT NULL,
    "visitType" "VisitType",
    "contactType" "ContactType" NOT NULL DEFAULT 'FACE',
    "departmentId" TEXT NOT NULL,
    "wardId" TEXT,
    "insuranceId" TEXT,
    "receptionNo" INTEGER,
    "receptionStatus" "ReceptionStatus" NOT NULL DEFAULT 'UNRECEIVED',
    "triageLevel" "TriageLevel",
    "arrivalMethod" TEXT,
    "isTemporaryId" BOOLEAN NOT NULL DEFAULT false,
    "arrivedAt" TIMESTAMP(3),
    "openedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterStatusTransition" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "fromStatus" "ReceptionStatus" NOT NULL,
    "toStatus" "ReceptionStatus" NOT NULL,
    "byUserId" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterStatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalSession" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "recordedDate" TIMESTAMP(3) NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "noteType" "NoteType" NOT NULL DEFAULT 'PROGRESS',
    "recordedDate" TIMESTAMP(3) NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorJobType" "JobType" NOT NULL,
    "departmentId" TEXT NOT NULL,
    "wardId" TEXT,
    "insuranceId" TEXT,
    "isProxyInput" BOOLEAN NOT NULL DEFAULT false,
    "proxyAuthorUserId" TEXT,
    "responsibleUserId" TEXT,
    "blocks" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rootNoteId" TEXT,
    "previousVersionId" TEXT,
    "supersededById" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'EDITING',
    "lockedAt" TIMESTAMP(3),
    "amendReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteAttachment" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "caption" TEXT,
    "displayScale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NoteAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Countersign" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "superviseDoctorId" TEXT NOT NULL,
    "status" "CountersignStatus" NOT NULL DEFAULT 'UNAPPROVED',
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Countersign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sticky" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#fff7df',
    "scope" "StickyScope" NOT NULL DEFAULT 'PRIVATE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sticky_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "s" TEXT NOT NULL DEFAULT '',
    "o" TEXT NOT NULL DEFAULT '',
    "a" TEXT NOT NULL DEFAULT '',
    "p" TEXT NOT NULL DEFAULT '',
    "icd10Codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "scope" "TemplateScope" NOT NULL DEFAULT 'COMMON',
    "departmentId" TEXT,
    "ownerUserId" TEXT,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateInstance" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "noteId" TEXT,
    "values" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "sessionId" TEXT,
    "orderType" "OrderType" NOT NULL,
    "classification" TEXT,
    "departmentId" TEXT NOT NULL,
    "ordererUserId" TEXT NOT NULL,
    "responsibleUserId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "scheduledDate" TIMESTAMP(3),
    "detail" JSONB NOT NULL,
    "doSourceOrderId" TEXT,
    "setId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" TEXT,
    "supersededById" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "consentDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderReception" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderExecution" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "executedByUserId" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "threePointAuth" JSONB,

    CONSTRAINT "OrderExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "dispenseType" "DispenseType" NOT NULL DEFAULT 'IN_HOUSE',
    "issuedByUserId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "drugProductId" TEXT NOT NULL,
    "dosePerTime" DOUBLE PRECISION NOT NULL,
    "doseUnit" TEXT NOT NULL,
    "timesPerDay" DOUBLE PRECISION NOT NULL,
    "days" INTEGER NOT NULL,
    "route" TEXT NOT NULL,
    "usageCode" TEXT,
    "comment" TEXT,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleCheckResult" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "orderId" TEXT,
    "checkType" "RuleCheckType" NOT NULL,
    "result" "RuleResult" NOT NULL,
    "checkedBy" "RuleCheckedBy" NOT NULL DEFAULT 'STATIC_DB',
    "severityNote" TEXT,
    "details" JSONB NOT NULL,
    "masterVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionOverride" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "ruleCheckResultId" TEXT NOT NULL,
    "overriddenByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "countersignByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugProduct" (
    "id" TEXT NOT NULL,
    "receiptCode" TEXT NOT NULL,
    "yjCode" TEXT,
    "hotCode" TEXT,
    "gs1Code" TEXT,
    "gtinUnit" TEXT,
    "brandName" TEXT NOT NULL,
    "brandNameKana" TEXT,
    "genericName" TEXT,
    "strengthValue" DOUBLE PRECISION,
    "strengthUnit" TEXT,
    "dosageForm" TEXT NOT NULL,
    "administrationRoute" TEXT NOT NULL,
    "unitCode" TEXT,
    "nhiPrice" DOUBLE PRECISION,
    "nhiPriceDate" TIMESTAMP(3),
    "isGeneric" BOOLEAN NOT NULL DEFAULT false,
    "isNarcotic" BOOLEAN NOT NULL DEFAULT false,
    "isPsychotropic" BOOLEAN NOT NULL DEFAULT false,
    "isPoison" BOOLEAN NOT NULL DEFAULT false,
    "isPowerfulDrug" BOOLEAN NOT NULL DEFAULT false,
    "isBiological" BOOLEAN NOT NULL DEFAULT false,
    "atcCode" TEXT,
    "marketingStatus" TEXT NOT NULL DEFAULT 'ON_MARKET',
    "sourceMasterVersion" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugIngredient" (
    "id" TEXT NOT NULL,
    "ingredientCode" TEXT NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "ingredientNameKana" TEXT,
    "ingredientNameEn" TEXT,
    "keggDrugId" TEXT,
    "saltVariantOfId" TEXT,

    CONSTRAINT "DrugIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugProductIngredient" (
    "id" TEXT NOT NULL,
    "drugProductId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "amountValue" DOUBLE PRECISION,
    "amountUnit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DrugProductIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugCodeCrosswalk" (
    "id" TEXT NOT NULL,
    "receiptCode" TEXT NOT NULL,
    "hotCode" TEXT,
    "yjCode" TEXT,
    "ingredientCode" TEXT,
    "matchMethod" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "verifiedByUserId" TEXT,
    "provenance" JSONB NOT NULL,

    CONSTRAINT "DrugCodeCrosswalk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugIndication" (
    "id" TEXT NOT NULL,
    "targetKind" "DrugTargetKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "indicationText" TEXT NOT NULL,
    "icd10Codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isInsuranceApplicable" BOOLEAN NOT NULL DEFAULT true,
    "conditionNote" TEXT,
    "source" "DrugDataSource" NOT NULL,
    "sourceCitation" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isSeed" BOOLEAN NOT NULL DEFAULT false,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugIndication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugDosage" (
    "id" TEXT NOT NULL,
    "targetKind" "DrugTargetKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "population" "DosagePopulation" NOT NULL DEFAULT 'ADULT',
    "route" TEXT NOT NULL,
    "usualDoseSingle" DOUBLE PRECISION,
    "usualDoseDaily" DOUBLE PRECISION,
    "maxDoseSingle" DOUBLE PRECISION,
    "maxDoseDaily" DOUBLE PRECISION,
    "maxDosePeriod" DOUBLE PRECISION,
    "periodUnit" TEXT,
    "weightBased" BOOLEAN NOT NULL DEFAULT false,
    "dosePerKgSingle" DOUBLE PRECISION,
    "dosePerKgDaily" DOUBLE PRECISION,
    "ageMinDays" INTEGER,
    "ageMaxDays" INTEGER,
    "renalAdjustment" JSONB,
    "hepaticAdjustment" JSONB,
    "dosageText" TEXT,
    "source" "DrugDataSource" NOT NULL,
    "sourceCitation" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isSeed" BOOLEAN NOT NULL DEFAULT false,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugDosage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugContraindication" (
    "id" TEXT NOT NULL,
    "targetKind" "DrugTargetKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "severity" "ContraSeverity" NOT NULL,
    "conditionType" "ContraConditionType" NOT NULL,
    "icd10Codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ageMinDays" INTEGER,
    "ageMaxDays" INTEGER,
    "targetDrugOrClass" JSONB,
    "conditionText" TEXT NOT NULL,
    "rationale" TEXT,
    "source" "DrugDataSource" NOT NULL,
    "sourceCitation" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isSeed" BOOLEAN NOT NULL DEFAULT false,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugContraindication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugInteraction" (
    "id" TEXT NOT NULL,
    "subjectKind" "DrugTargetKind" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "counterpartType" "InteractionCounterpart" NOT NULL,
    "counterpartRef" JSONB NOT NULL,
    "severity" "InteractionSeverity" NOT NULL,
    "mechanism" TEXT,
    "clinicalEffect" TEXT,
    "management" TEXT,
    "source" "DrugDataSource" NOT NULL,
    "sourceCitation" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isSeed" BOOLEAN NOT NULL DEFAULT false,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugSafetyReviewLog" (
    "id" TEXT NOT NULL,
    "entityTable" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reviewedByUserId" TEXT,
    "reason" TEXT,
    "sourceCitation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugSafetyReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jlac10" TEXT,
    "category" TEXT NOT NULL,
    "specimenType" TEXT,
    "refLow" DOUBLE PRECISION,
    "refHigh" DOUBLE PRECISION,
    "unit" TEXT,
    "sourceMasterVersion" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,

    CONSTRAINT "ExamMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiseaseMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icd10" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isConfidential" BOOLEAN NOT NULL DEFAULT false,
    "source" "DrugDataSource" NOT NULL,
    "sourceMasterVersion" TEXT NOT NULL,

    CONSTRAINT "DiseaseMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterVersion" (
    "id" TEXT NOT NULL,
    "masterType" "MasterType" NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRelease" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checksum" TEXT,

    CONSTRAINT "MasterVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "counts" JSONB,
    "checksum" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_clinicId_code_key" ON "Department"("clinicId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Ward_clinicId_code_key" ON "Ward"("clinicId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Room_wardId_code_key" ON "Room"("wardId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Bed_roomId_code_key" ON "Bed"("roomId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_staffNo_key" ON "StaffUser"("staffNo");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_loginId_key" ON "StaffUser"("loginId");

-- CreateIndex
CREATE INDEX "StaffUser_clinicId_jobType_idx" ON "StaffUser"("clinicId", "jobType");

-- CreateIndex
CREATE INDEX "LoginAttempt_identifier_createdAt_idx" ON "LoginAttempt"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_jobType_resource_action_key" ON "RolePermission"("jobType", "resource", "action");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_resource_action_key" ON "UserPermission"("userId", "resource", "action");

-- CreateIndex
CREATE INDEX "PatientAccessControl_patientId_idx" ON "PatientAccessControl"("patientId");

-- CreateIndex
CREATE INDEX "AuditEvent_patientId_createdAt_idx" ON "AuditEvent"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChartLock_resourceType_resourceId_key" ON "ChartLock"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFavoriteTool_userId_toolKey_key" ON "UserFavoriteTool"("userId", "toolKey");

-- CreateIndex
CREATE INDEX "SavedSearchCondition_userId_screenKey_idx" ON "SavedSearchCondition"("userId", "screenKey");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_patientNo_key" ON "Patient"("patientNo");

-- CreateIndex
CREATE INDEX "Patient_clinicId_idx" ON "Patient"("clinicId");

-- CreateIndex
CREATE INDEX "Patient_kanaLastName_kanaFirstName_idx" ON "Patient"("kanaLastName", "kanaFirstName");

-- CreateIndex
CREATE INDEX "Patient_kanjiLastName_kanjiFirstName_idx" ON "Patient"("kanjiLastName", "kanjiFirstName");

-- CreateIndex
CREATE INDEX "Allergy_patientId_idx" ON "Allergy"("patientId");

-- CreateIndex
CREATE INDEX "Infection_patientId_idx" ON "Infection"("patientId");

-- CreateIndex
CREATE INDEX "MedicalHistory_patientId_idx" ON "MedicalHistory"("patientId");

-- CreateIndex
CREATE INDEX "FamilyMember_patientId_idx" ON "FamilyMember"("patientId");

-- CreateIndex
CREATE INDEX "Insurance_patientId_idx" ON "Insurance"("patientId");

-- CreateIndex
CREATE INDEX "PatientSelectionLog_userId_selectedAt_idx" ON "PatientSelectionLog"("userId", "selectedAt");

-- CreateIndex
CREATE INDEX "AppointmentSlot_departmentId_startAt_idx" ON "AppointmentSlot"("departmentId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_departmentId_scheduledAt_idx" ON "Appointment"("departmentId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_appointmentId_key" ON "Encounter"("appointmentId");

-- CreateIndex
CREATE INDEX "Encounter_receptionStatus_departmentId_idx" ON "Encounter"("receptionStatus", "departmentId");

-- CreateIndex
CREATE INDEX "Encounter_patientId_idx" ON "Encounter"("patientId");

-- CreateIndex
CREATE INDEX "EncounterStatusTransition_encounterId_createdAt_idx" ON "EncounterStatusTransition"("encounterId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalSession_encounterId_recordedDate_idx" ON "ClinicalSession"("encounterId", "recordedDate");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalNote_previousVersionId_key" ON "ClinicalNote"("previousVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalNote_supersededById_key" ON "ClinicalNote"("supersededById");

-- CreateIndex
CREATE INDEX "ClinicalNote_encounterId_recordedDate_idx" ON "ClinicalNote"("encounterId", "recordedDate");

-- CreateIndex
CREATE INDEX "ClinicalNote_patientId_isLatest_idx" ON "ClinicalNote"("patientId", "isLatest");

-- CreateIndex
CREATE INDEX "ClinicalNote_rootNoteId_version_idx" ON "ClinicalNote"("rootNoteId", "version");

-- CreateIndex
CREATE INDEX "NoteAttachment_noteId_idx" ON "NoteAttachment"("noteId");

-- CreateIndex
CREATE UNIQUE INDEX "Countersign_noteId_key" ON "Countersign"("noteId");

-- CreateIndex
CREATE INDEX "Countersign_superviseDoctorId_status_idx" ON "Countersign"("superviseDoctorId", "status");

-- CreateIndex
CREATE INDEX "Sticky_patientId_idx" ON "Sticky"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalRecord_sessionId_key" ON "ClinicalRecord"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Order_previousVersionId_key" ON "Order"("previousVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_supersededById_key" ON "Order"("supersededById");

-- CreateIndex
CREATE INDEX "Order_encounterId_orderType_scheduledDate_idx" ON "Order"("encounterId", "orderType", "scheduledDate");

-- CreateIndex
CREATE INDEX "Order_status_departmentId_idx" ON "Order"("status", "departmentId");

-- CreateIndex
CREATE INDEX "Order_patientId_isLatest_idx" ON "Order"("patientId", "isLatest");

-- CreateIndex
CREATE UNIQUE INDEX "OrderReception_orderId_key" ON "OrderReception"("orderId");

-- CreateIndex
CREATE INDEX "OrderExecution_orderId_idx" ON "OrderExecution"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_orderId_key" ON "Prescription"("orderId");

-- CreateIndex
CREATE INDEX "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");

-- CreateIndex
CREATE INDEX "RuleCheckResult_prescriptionId_idx" ON "RuleCheckResult"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionOverride_prescriptionId_idx" ON "PrescriptionOverride"("prescriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "DrugProduct_receiptCode_key" ON "DrugProduct"("receiptCode");

-- CreateIndex
CREATE INDEX "DrugProduct_yjCode_idx" ON "DrugProduct"("yjCode");

-- CreateIndex
CREATE INDEX "DrugProduct_hotCode_idx" ON "DrugProduct"("hotCode");

-- CreateIndex
CREATE INDEX "DrugProduct_atcCode_idx" ON "DrugProduct"("atcCode");

-- CreateIndex
CREATE UNIQUE INDEX "DrugIngredient_ingredientCode_key" ON "DrugIngredient"("ingredientCode");

-- CreateIndex
CREATE UNIQUE INDEX "DrugProductIngredient_drugProductId_ingredientId_key" ON "DrugProductIngredient"("drugProductId", "ingredientId");

-- CreateIndex
CREATE INDEX "DrugCodeCrosswalk_receiptCode_idx" ON "DrugCodeCrosswalk"("receiptCode");

-- CreateIndex
CREATE INDEX "DrugIndication_targetKind_targetId_idx" ON "DrugIndication"("targetKind", "targetId");

-- CreateIndex
CREATE INDEX "DrugDosage_targetKind_targetId_idx" ON "DrugDosage"("targetKind", "targetId");

-- CreateIndex
CREATE INDEX "DrugContraindication_targetKind_targetId_idx" ON "DrugContraindication"("targetKind", "targetId");

-- CreateIndex
CREATE INDEX "DrugInteraction_subjectKind_subjectId_idx" ON "DrugInteraction"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "DrugSafetyReviewLog_entityTable_entityId_idx" ON "DrugSafetyReviewLog"("entityTable", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamMaster_code_key" ON "ExamMaster"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiseaseMaster_code_key" ON "DiseaseMaster"("code");

-- CreateIndex
CREATE INDEX "MasterVersion_masterType_validFrom_idx" ON "MasterVersion"("masterType", "validFrom");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaFactor" ADD CONSTRAINT "MfaFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAccessControl" ADD CONSTRAINT "PatientAccessControl_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavoriteTool" ADD CONSTRAINT "UserFavoriteTool_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Infection" ADD CONSTRAINT "Infection_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalHistory" ADD CONSTRAINT "MedicalHistory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insurance" ADD CONSTRAINT "Insurance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AppointmentSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterStatusTransition" ADD CONSTRAINT "EncounterStatusTransition_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalSession" ADD CONSTRAINT "ClinicalSession_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClinicalSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "ClinicalNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAttachment" ADD CONSTRAINT "NoteAttachment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ClinicalNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Countersign" ADD CONSTRAINT "Countersign_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ClinicalNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalRecord" ADD CONSTRAINT "ClinicalRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClinicalSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInstance" ADD CONSTRAINT "TemplateInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReception" ADD CONSTRAINT "OrderReception_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderExecution" ADD CONSTRAINT "OrderExecution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_drugProductId_fkey" FOREIGN KEY ("drugProductId") REFERENCES "DrugProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleCheckResult" ADD CONSTRAINT "RuleCheckResult_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionOverride" ADD CONSTRAINT "PrescriptionOverride_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugIngredient" ADD CONSTRAINT "DrugIngredient_saltVariantOfId_fkey" FOREIGN KEY ("saltVariantOfId") REFERENCES "DrugIngredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugProductIngredient" ADD CONSTRAINT "DrugProductIngredient_drugProductId_fkey" FOREIGN KEY ("drugProductId") REFERENCES "DrugProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugProductIngredient" ADD CONSTRAINT "DrugProductIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "DrugIngredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
