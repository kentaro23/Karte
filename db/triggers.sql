-- Medixus カルテ — regulatory enforcement at the database layer (the hard guarantee).
-- 電子保存の三原則: 真正性 (no tamper / append-only) ・ 見読性 ・ 保存性.
-- Prisma default naming: table = "ModelName", column = "fieldName" (case-sensitive).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Append-only / version-chain guard ─────────────────────────────────────
-- Clinical content is immutable. Only supersede/lock transition columns may change.
-- Correction = mark old row SUPERSEDED + INSERT a new version (previousVersionId chain).

CREATE OR REPLACE FUNCTION medixus_guard_clinical_note() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only violation: DELETE on "ClinicalNote" forbidden (真正性). Supersede instead.';
  END IF;
  IF (to_jsonb(NEW) - 'isLatest' - 'status' - 'supersededById' - 'lockedAt')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'isLatest' - 'status' - 'supersededById' - 'lockedAt') THEN
    RAISE EXCEPTION 'append-only violation: clinical content of "ClinicalNote" is immutable (真正性). Amend by superseding.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_clinical_note ON "ClinicalNote";
CREATE TRIGGER trg_guard_clinical_note
  BEFORE UPDATE OR DELETE ON "ClinicalNote"
  FOR EACH ROW EXECUTE FUNCTION medixus_guard_clinical_note();

CREATE OR REPLACE FUNCTION medixus_guard_order() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only violation: DELETE on "Order" forbidden (指示歴 版数管理). Supersede instead.';
  END IF;
  IF (to_jsonb(NEW) - 'isLatest' - 'status' - 'supersededById')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'isLatest' - 'status' - 'supersededById') THEN
    RAISE EXCEPTION 'append-only violation: order content of "Order" is immutable. Amend by superseding (新版 INSERT).';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_order ON "Order";
CREATE TRIGGER trg_guard_order
  BEFORE UPDATE OR DELETE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION medixus_guard_order();

-- Drug-safety rows: only validTo may change (supersede close-out). Never deleted.
CREATE OR REPLACE FUNCTION medixus_guard_safety() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only violation: DELETE on safety table "%" forbidden (患者安全・保存性).', TG_TABLE_NAME;
  END IF;
  IF (to_jsonb(NEW) - 'validTo') IS DISTINCT FROM (to_jsonb(OLD) - 'validTo') THEN
    RAISE EXCEPTION 'append-only violation: safety data "%" is immutable except validTo (supersede only).', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_indication ON "DrugIndication";
CREATE TRIGGER trg_guard_indication BEFORE UPDATE OR DELETE ON "DrugIndication"
  FOR EACH ROW EXECUTE FUNCTION medixus_guard_safety();
DROP TRIGGER IF EXISTS trg_guard_dosage ON "DrugDosage";
CREATE TRIGGER trg_guard_dosage BEFORE UPDATE OR DELETE ON "DrugDosage"
  FOR EACH ROW EXECUTE FUNCTION medixus_guard_safety();
DROP TRIGGER IF EXISTS trg_guard_contra ON "DrugContraindication";
CREATE TRIGGER trg_guard_contra BEFORE UPDATE OR DELETE ON "DrugContraindication"
  FOR EACH ROW EXECUTE FUNCTION medixus_guard_safety();
DROP TRIGGER IF EXISTS trg_guard_interaction ON "DrugInteraction";
CREATE TRIGGER trg_guard_interaction BEFORE UPDATE OR DELETE ON "DrugInteraction"
  FOR EACH ROW EXECUTE FUNCTION medixus_guard_safety();

-- Strictly immutable tables (no UPDATE, no DELETE ever).
CREATE OR REPLACE FUNCTION medixus_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only violation: "%" is strictly immutable (% forbidden).', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_review_log ON "DrugSafetyReviewLog";
CREATE TRIGGER trg_immutable_review_log BEFORE UPDATE OR DELETE ON "DrugSafetyReviewLog"
  FOR EACH ROW EXECUTE FUNCTION medixus_immutable();
DROP TRIGGER IF EXISTS trg_immutable_rulecheck ON "RuleCheckResult";
CREATE TRIGGER trg_immutable_rulecheck BEFORE UPDATE OR DELETE ON "RuleCheckResult"
  FOR EACH ROW EXECUTE FUNCTION medixus_immutable();
DROP TRIGGER IF EXISTS trg_immutable_override ON "PrescriptionOverride";
CREATE TRIGGER trg_immutable_override BEFORE UPDATE OR DELETE ON "PrescriptionOverride"
  FOR EACH ROW EXECUTE FUNCTION medixus_immutable();
DROP TRIGGER IF EXISTS trg_immutable_enc_transition ON "EncounterStatusTransition";
CREATE TRIGGER trg_immutable_enc_transition BEFORE UPDATE OR DELETE ON "EncounterStatusTransition"
  FOR EACH ROW EXECUTE FUNCTION medixus_immutable();

-- ── 2. Tamper-evident audit hash-chain ───────────────────────────────────────
-- 別紙3 #25-30. Each row's hash binds the previous row's hash (sha256).

CREATE OR REPLACE FUNCTION medixus_audit_chain() RETURNS trigger AS $$
DECLARE
  prev TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'append-only violation: "AuditEvent" is immutable (% forbidden).', TG_OP;
  END IF;
  SELECT "rowHash" INTO prev FROM "AuditEvent" ORDER BY "seq" DESC LIMIT 1;
  NEW."prevHash" := prev;
  NEW."rowHash" := encode(
    digest(
      coalesce(prev, '') || '|' || NEW."seq"::text || '|' || NEW."action"::text || '|' ||
      coalesce(NEW."actorUserId", '') || '|' || coalesce(NEW."patientId", '') || '|' ||
      coalesce(NEW."resource", '') || '|' || coalesce(NEW."resourceId", '') || '|' ||
      coalesce(NEW."detail"::text, '') || '|' || NEW."createdAt"::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_chain_ins ON "AuditEvent";
CREATE TRIGGER trg_audit_chain_ins
  BEFORE INSERT ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION medixus_audit_chain();

DROP TRIGGER IF EXISTS trg_audit_chain_mut ON "AuditEvent";
CREATE TRIGGER trg_audit_chain_mut
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION medixus_immutable();

-- ── 3. pg_trgm for kana/kanji partial-match patient search (別紙1 §2.3) ──────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_patient_kana_trgm
  ON "Patient" USING gin (("kanaLastName" || "kanaFirstName") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_patient_kanji_trgm
  ON "Patient" USING gin (("kanjiLastName" || "kanjiFirstName") gin_trgm_ops);
