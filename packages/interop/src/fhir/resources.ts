/**
 * IF-EXT-05 電子カルテ情報共有サービス (G25) — HL7 FHIR リソース型 (最小)。
 *
 * HL7 FHIR JP Core / CLINS-IG に基づく 3文書6情報の生成・登録・閲覧で用いる
 * リソースの最小型。本番化時に jpcore プロファイル(HS036-039)へ拡張する前提の
 * 枠 (要件定義書 IF-EXT-05)。外部依存を持たない純粋な型定義。
 *
 * 6情報 FHIRリソース対応 (要件定義書 6.5 / IF-EXT-05):
 *   傷病名         → Condition (病名管理番号=ICD-10対応標準病名マスター)
 *   感染症         → Observation (JLAC10/11)
 *   薬剤アレルギー等 → AllergyIntolerance (J-FAGYコード)
 *   その他アレルギー等→ AllergyIntolerance (J-FAGYコード)
 *   検査           → Observation (JLAC10/11)
 *   処方           → MedicationRequest (YJコード, 銘柄指定不可時 下3桁zzz)
 */

/** FHIR Coding (system/code/display)。 */
export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

/** FHIR CodeableConcept。 */
export interface FhirCodeableConcept {
  coding: FhirCoding[];
  text?: string;
}

/** FHIR リソース参照 (例 'Patient/123')。 */
export interface FhirReference {
  reference: string;
  display?: string;
}

/** 傷病名 → Condition (ICD-10対応標準病名 / 病名管理番号)。 */
export interface FhirCondition {
  resourceType: 'Condition';
  id?: string;
  subject: FhirReference;
  code: FhirCodeableConcept;
  clinicalStatus?: FhirCodeableConcept;
  verificationStatus?: FhirCodeableConcept; // confirmed / provisional(疑い)
  onsetDateTime?: string;
}

/** 感染症/検査 → Observation (JLAC10/11)。 */
export interface FhirObservation {
  resourceType: 'Observation';
  id?: string;
  subject: FhirReference;
  status: 'final' | 'preliminary' | 'registered';
  category?: FhirCodeableConcept[]; // laboratory 等
  code: FhirCodeableConcept;
  valueQuantity?: { value: number; unit?: string };
  valueString?: string;
  effectiveDateTime?: string;
  interpretation?: FhirCodeableConcept[]; // H/L/N
}

/** 薬剤アレルギー等/その他アレルギー等 → AllergyIntolerance (J-FAGY)。 */
export interface FhirAllergyIntolerance {
  resourceType: 'AllergyIntolerance';
  id?: string;
  patient: FhirReference;
  clinicalStatus?: FhirCodeableConcept; // active 等
  category?: ('medication' | 'food' | 'environment' | 'biologic')[];
  criticality?: 'low' | 'high' | 'unable-to-assess';
  code: FhirCodeableConcept;
  reaction?: { manifestation: FhirCodeableConcept[] }[];
}

/** 処方 → MedicationRequest (YJコード)。 */
export interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id?: string;
  subject: FhirReference;
  status: 'active' | 'completed' | 'stopped';
  intent: 'order' | 'plan';
  medicationCodeableConcept: FhirCodeableConcept;
  authoredOn?: string;
  dosageInstruction?: { text?: string }[];
}

/** 患者 → Patient (Bundle の subject)。 */
export interface FhirPatient {
  resourceType: 'Patient';
  id?: string;
  name?: { family?: string; given?: string[] }[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
}

/** 医療機関/診療科 → Organization (紹介元/紹介先・文書の custodian/author)。 */
export interface FhirOrganization {
  resourceType: 'Organization';
  id?: string;
  name?: string;
}

/**
 * 文書ヘッダ → Composition。3文書(HS037健診/HS038診療情報提供書/HS039退院サマリ)の
 * 構造化文書(type: 'document')の起点。section.entry が本文リソースを参照する。
 */
export interface FhirComposition {
  resourceType: 'Composition';
  id?: string;
  status: 'preliminary' | 'final' | 'amended';
  /** 文書種別 (LOINC + CLINS-IG 文書コード)。 */
  type: FhirCodeableConcept;
  subject: FhirReference;
  date?: string;
  title?: string;
  author?: FhirReference[];
  custodian?: FhirReference;
  section?: {
    title?: string;
    code?: FhirCodeableConcept;
    text?: { status: 'generated'; div: string };
    entry?: FhirReference[];
  }[];
}

/** Bundle に格納しうる全リソースのユニオン。 */
export type FhirResource =
  | FhirComposition
  | FhirPatient
  | FhirOrganization
  | FhirCondition
  | FhirObservation
  | FhirAllergyIntolerance
  | FhirMedicationRequest;

/** Bundle entry。document Bundle では fullUrl を付与してリソース内参照を解決する。 */
export interface FhirBundleEntry {
  fullUrl?: string;
  resource: FhirResource;
}

/** FHIR Bundle (collection/document)。3文書6情報の出力/取込の搬送形式。 */
export interface FhirBundle {
  resourceType: 'Bundle';
  type: 'collection' | 'document' | 'transaction';
  timestamp?: string;
  entry: FhirBundleEntry[];
}

/** 既知のコード体系 system URI / 内部識別子 (本番化時 公式URIに置換)。 */
export const FHIR_CODE_SYSTEMS = {
  icd10: 'urn:oid:1.2.392.200119.4.101.6', // ICD-10対応標準病名マスター(病名管理番号)
  jlac10: 'urn:oid:1.2.392.200119.4.501', // 臨床検査マスター JLAC10/11
  yj: 'urn:oid:1.2.392.100495.20.2.73', // YJコード
  hot: 'urn:oid:1.2.392.200119.4.403.1', // 医薬品HOTコード
  jFagy: 'urn:medixus:jfagy', // J-FAGY (本番化時 公式OIDへ)
  loinc: 'http://loinc.org', // 文書種別/検査(LOINC)
  conditionVerStatus: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
  conditionClinical: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
  observationCategory: 'http://terminology.hl7.org/CodeSystem/observation-category',
  observationInterpretation:
    'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
  allergyClinical: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
} as const;

/**
 * 3文書(CLINS-IG / HS037-039)の文書種別コード。
 * LOINC文書コード + 厚労省 HS番号 を併記する (本番化時 CLINS-IG 確定値へ)。
 */
export const FHIR_DOCUMENT_TYPES = {
  /** HS037 健康診断結果報告書。 */
  CHECKUP: { hs: 'HS037', loinc: '11502-2', display: '健康診断結果報告書' },
  /** HS038 診療情報提供書 (紹介状)。 */
  REFERRAL: { hs: 'HS038', loinc: '57133-1', display: '診療情報提供書' },
  /** HS039 退院時サマリー。 */
  DISCHARGE_SUMMARY: { hs: 'HS039', loinc: '18842-5', display: '退院時サマリー' },
} as const;
