/**
 * IF-EXT-05 — 内部データ → FHIR(JP Core) 純変換の枠 (STUB)。
 *
 * 内部モデル(PatientProfile/PatientDiagnosis/Allergy/Infection/LabResult/
 * Prescription 等)を 6情報の FHIR リソースに正規化する純関数群。本ファイルは
 * 副作用なし・外部接続なしの純変換で、コード体系(ICD-10/JLAC/YJ/J-FAGY)準拠の
 * 型枠を提供する。中身(プロファイル準拠の詳細マッピング)は IOPスクワッドが後で
 * 充実させる (要件定義書 6.5 / IF-EXT-05)。
 */
import {
  FHIR_CODE_SYSTEMS,
  type FhirAllergyIntolerance,
  type FhirBundle,
  type FhirCondition,
  type FhirMedicationRequest,
  type FhirObservation,
  type FhirPatient,
  type FhirReference,
  type FhirResource,
} from './resources.js';
import type {
  Icd10Code,
  JFagyCode,
  Jlac10Code,
  PatientRef,
  StandardDiseaseCode,
  YjCode,
} from '../types.js';

/* ── 変換ソース型 (内部データの最小ビュー) ───────────────────────────────── */

/** 患者基本 (PatientProfile の最小ビュー)。 */
export interface PatientSource {
  patientRef: PatientRef;
  familyName?: string;
  givenName?: string;
  sex?: 'M' | 'F' | 'U';
  birthDate?: string;
}

/** 傷病名 (PatientDiagnosis の最小ビュー)。 */
export interface DiagnosisSource {
  standardDiseaseCode?: StandardDiseaseCode;
  icd10?: Icd10Code;
  name: string;
  isSuspected?: boolean;
  startDate?: string;
  active?: boolean;
}

/** アレルギー (Allergy の最小ビュー / 薬剤アレルギー等・その他アレルギー等)。 */
export interface AllergySource {
  jFagy?: JFagyCode;
  category: 'DRUG' | 'OTHER';
  substance: string;
  reaction?: string;
}

/** 感染症 (Infection の最小ビュー)。 */
export interface InfectionSource {
  jlac10?: Jlac10Code;
  name: string;
  positive?: boolean;
  examDate?: string;
}

/** 検査結果 (LabResult の最小ビュー)。 */
export interface LabResultSource {
  jlac10?: Jlac10Code;
  name: string;
  value?: number;
  valueText?: string;
  unit?: string;
  flag?: 'H' | 'L' | 'N';
  effectiveDate?: string;
}

/** 処方 (Prescription の最小ビュー)。 */
export interface PrescriptionSource {
  yjCode?: YjCode;
  /** 一般名処方時 true (YJ 下3桁 zzz 相当)。 */
  isGenericName?: boolean;
  drugName: string;
  dosageText?: string;
  authoredOn?: string;
}

/** 6情報＋患者をまとめた変換入力。 */
export interface SixInfoSource {
  patient: PatientSource;
  diagnoses?: DiagnosisSource[];
  allergies?: AllergySource[];
  infections?: InfectionSource[];
  labResults?: LabResultSource[];
  prescriptions?: PrescriptionSource[];
}

/* ── 純変換関数 (枠 / 最小実装) ──────────────────────────────────────────── */

function patientReference(patientRef: PatientRef): FhirReference {
  return { reference: `Patient/${patientRef}` };
}

/** 患者 → Patient リソース。 */
export function toPatient(src: PatientSource): FhirPatient {
  const gender =
    src.sex === 'M' ? 'male' : src.sex === 'F' ? 'female' : 'unknown';
  return {
    resourceType: 'Patient',
    id: src.patientRef,
    name:
      src.familyName || src.givenName
        ? [{ family: src.familyName, given: src.givenName ? [src.givenName] : [] }]
        : undefined,
    gender,
    birthDate: src.birthDate,
  };
}

/** 傷病名 → Condition (ICD-10対応標準病名 / 病名管理番号)。 */
export function toCondition(ref: PatientRef, src: DiagnosisSource): FhirCondition {
  return {
    resourceType: 'Condition',
    subject: patientReference(ref),
    code: {
      coding: src.icd10
        ? [{ system: FHIR_CODE_SYSTEMS.icd10, code: src.icd10, display: src.name }]
        : [],
      text: src.name,
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: src.isSuspected ? 'provisional' : 'confirmed',
        },
      ],
    },
    onsetDateTime: src.startDate,
  };
}

/** アレルギー → AllergyIntolerance (J-FAGY / 薬剤・その他)。 */
export function toAllergyIntolerance(
  ref: PatientRef,
  src: AllergySource,
): FhirAllergyIntolerance {
  return {
    resourceType: 'AllergyIntolerance',
    patient: patientReference(ref),
    category: [src.category === 'DRUG' ? 'medication' : 'environment'],
    code: {
      coding: src.jFagy
        ? [{ system: FHIR_CODE_SYSTEMS.jFagy, code: src.jFagy, display: src.substance }]
        : [],
      text: src.substance,
    },
    reaction: src.reaction
      ? [{ manifestation: [{ coding: [], text: src.reaction }] }]
      : undefined,
  };
}

/** 感染症 → Observation (JLAC10/11)。 */
export function infectionToObservation(
  ref: PatientRef,
  src: InfectionSource,
): FhirObservation {
  return {
    resourceType: 'Observation',
    subject: patientReference(ref),
    status: 'final',
    category: [{ coding: [], text: 'infection' }],
    code: {
      coding: src.jlac10
        ? [{ system: FHIR_CODE_SYSTEMS.jlac10, code: src.jlac10, display: src.name }]
        : [],
      text: src.name,
    },
    valueString: src.positive === undefined ? undefined : src.positive ? '陽性' : '陰性',
    effectiveDateTime: src.examDate,
  };
}

/** 検査結果 → Observation (JLAC10/11, H/L 判定)。 */
export function labResultToObservation(
  ref: PatientRef,
  src: LabResultSource,
): FhirObservation {
  return {
    resourceType: 'Observation',
    subject: patientReference(ref),
    status: 'final',
    category: [{ coding: [], text: 'laboratory' }],
    code: {
      coding: src.jlac10
        ? [{ system: FHIR_CODE_SYSTEMS.jlac10, code: src.jlac10, display: src.name }]
        : [],
      text: src.name,
    },
    valueQuantity: src.value === undefined ? undefined : { value: src.value, unit: src.unit },
    valueString: src.valueText,
    interpretation: src.flag ? [{ coding: [], text: src.flag }] : undefined,
    effectiveDateTime: src.effectiveDate,
  };
}

/** 処方 → MedicationRequest (YJコード, 一般名処方は zzz 相当)。 */
export function toMedicationRequest(
  ref: PatientRef,
  src: PrescriptionSource,
): FhirMedicationRequest {
  return {
    resourceType: 'MedicationRequest',
    subject: patientReference(ref),
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: src.yjCode
        ? [{ system: FHIR_CODE_SYSTEMS.yj, code: src.yjCode, display: src.drugName }]
        : [],
      text: src.drugName,
    },
    authoredOn: src.authoredOn,
    dosageInstruction: src.dosageText ? [{ text: src.dosageText }] : undefined,
  };
}

/**
 * 6情報＋患者 → FHIR Bundle (collection)。
 * 個別変換関数を束ねた純変換。文書(document)化や CLINS-IG プロファイル付与は
 * 本番化時に拡張する。
 */
export function toFhirBundle(src: SixInfoSource): FhirBundle {
  const ref = src.patient.patientRef;
  const resources: FhirResource[] = [toPatient(src.patient)];
  for (const d of src.diagnoses ?? []) resources.push(toCondition(ref, d));
  for (const a of src.allergies ?? []) resources.push(toAllergyIntolerance(ref, a));
  for (const i of src.infections ?? []) resources.push(infectionToObservation(ref, i));
  for (const l of src.labResults ?? []) resources.push(labResultToObservation(ref, l));
  for (const p of src.prescriptions ?? []) resources.push(toMedicationRequest(ref, p));
  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: resources.map((resource) => ({ resource })),
  };
}
