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
  FHIR_DOCUMENT_TYPES,
  type FhirAllergyIntolerance,
  type FhirBundle,
  type FhirBundleEntry,
  type FhirCodeableConcept,
  type FhirCoding,
  type FhirComposition,
  type FhirCondition,
  type FhirMedicationRequest,
  type FhirObservation,
  type FhirOrganization,
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
  /** 内部ID (Composition からの参照に使用。未指定なら index 連番)。 */
  id?: string;
  standardDiseaseCode?: StandardDiseaseCode;
  icd10?: Icd10Code;
  name: string;
  isSuspected?: boolean;
  startDate?: string;
  /** 帰結日 (転帰確定で resolved になる)。 */
  endDate?: string;
  /** false で resolved/inactive 扱い。既定 (undefined) は active。 */
  active?: boolean;
}

/**
 * アレルギー (Allergy の最小ビュー / 薬剤アレルギー等・その他アレルギー等)。
 * category は 6情報の2分類 (DRUG=薬剤アレルギー等 / OTHER=その他アレルギー等)。
 * otherKind で その他 を FHIR の food/environment/biologic に細分できる。
 */
export interface AllergySource {
  id?: string;
  jFagy?: JFagyCode;
  category: 'DRUG' | 'OTHER';
  /** OTHER の細分 (省略時 environment)。 */
  otherKind?: 'food' | 'environment' | 'biologic';
  substance: string;
  reaction?: string;
  /** 重篤度 (high で criticality=high)。 */
  severity?: 'low' | 'high';
}

/** 感染症 (Infection の最小ビュー)。 */
export interface InfectionSource {
  id?: string;
  jlac10?: Jlac10Code;
  name: string;
  positive?: boolean;
  examDate?: string;
}

/** 検査結果 (LabResult の最小ビュー)。 */
export interface LabResultSource {
  id?: string;
  jlac10?: Jlac10Code;
  name: string;
  value?: number;
  valueText?: string;
  unit?: string;
  flag?: 'H' | 'L' | 'N';
  refLow?: number;
  refHigh?: number;
  effectiveDate?: string;
}

/** 処方 (Prescription の最小ビュー)。 */
export interface PrescriptionSource {
  id?: string;
  yjCode?: YjCode;
  /** 一般名処方時 true (YJ 下3桁 zzz 相当)。 */
  isGenericName?: boolean;
  drugName: string;
  dosageText?: string;
  authoredOn?: string;
  /** 中止済みなら stopped。既定は active。 */
  stopped?: boolean;
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

/* ── 純変換関数 ──────────────────────────────────────────────────────────── */

function patientReference(patientRef: PatientRef): FhirReference {
  return { reference: `Patient/${patientRef}` };
}

/**
 * YJコードの正規化。一般名処方(isGenericName)時は下3桁を 'ZZZ' に置換する
 * (銘柄指定不可＝一般名処方相当 / 要件定義書 6.5・IF-EXT-05)。
 */
export function normalizeYjCode(yjCode: string | undefined, isGenericName?: boolean): string | undefined {
  if (!yjCode) return undefined;
  if (!isGenericName) return yjCode;
  return yjCode.length >= 3 ? `${yjCode.slice(0, yjCode.length - 3)}ZZZ` : yjCode;
}

/** H/L/N → HL7 v3 ObservationInterpretation の CodeableConcept。 */
function interpretationConcept(flag: 'H' | 'L' | 'N'): FhirCodeableConcept {
  const display = flag === 'H' ? 'High' : flag === 'L' ? 'Low' : 'Normal';
  return {
    coding: [
      { system: FHIR_CODE_SYSTEMS.observationInterpretation, code: flag, display },
    ],
    text: display,
  };
}

/** Observation.category (laboratory 等) の CodeableConcept。 */
function observationCategory(code: string, display: string): FhirCodeableConcept {
  return {
    coding: [{ system: FHIR_CODE_SYSTEMS.observationCategory, code, display }],
    text: display,
  };
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
  const resolved = src.active === false || !!src.endDate;
  const coding: FhirCoding[] = [];
  if (src.standardDiseaseCode) {
    coding.push({
      system: FHIR_CODE_SYSTEMS.icd10,
      code: src.standardDiseaseCode,
      display: src.name,
    });
  } else if (src.icd10) {
    coding.push({ system: FHIR_CODE_SYSTEMS.icd10, code: src.icd10, display: src.name });
  }
  return {
    resourceType: 'Condition',
    id: src.id,
    subject: patientReference(ref),
    code: { coding, text: src.name },
    clinicalStatus: {
      coding: [
        {
          system: FHIR_CODE_SYSTEMS.conditionClinical,
          code: resolved ? 'resolved' : 'active',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: FHIR_CODE_SYSTEMS.conditionVerStatus,
          code: src.isSuspected ? 'provisional' : 'confirmed',
        },
      ],
    },
    onsetDateTime: src.startDate,
  };
}

/** アレルギー → AllergyIntolerance (J-FAGY / 薬剤アレルギー等・その他アレルギー等)。 */
export function toAllergyIntolerance(
  ref: PatientRef,
  src: AllergySource,
): FhirAllergyIntolerance {
  const category =
    src.category === 'DRUG' ? 'medication' : src.otherKind ?? 'environment';
  return {
    resourceType: 'AllergyIntolerance',
    id: src.id,
    patient: patientReference(ref),
    clinicalStatus: {
      coding: [{ system: FHIR_CODE_SYSTEMS.allergyClinical, code: 'active' }],
    },
    category: [category],
    criticality: src.severity === 'high' ? 'high' : src.severity === 'low' ? 'low' : undefined,
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

/** 感染症 → Observation (JLAC10/11, 梅毒/HBs/HCV/HIV 等)。 */
export function infectionToObservation(
  ref: PatientRef,
  src: InfectionSource,
): FhirObservation {
  return {
    resourceType: 'Observation',
    id: src.id,
    subject: patientReference(ref),
    status: 'final',
    category: [observationCategory('laboratory', 'Laboratory')],
    code: {
      coding: src.jlac10
        ? [{ system: FHIR_CODE_SYSTEMS.jlac10, code: src.jlac10, display: src.name }]
        : [],
      text: src.name,
    },
    valueString: src.positive === undefined ? undefined : src.positive ? '陽性' : '陰性',
    interpretation:
      src.positive === undefined ? undefined : [interpretationConcept(src.positive ? 'H' : 'N')],
    effectiveDateTime: src.examDate,
  };
}

/** 検査結果 → Observation (JLAC10/11, H/L/N 判定・基準範囲)。 */
export function labResultToObservation(
  ref: PatientRef,
  src: LabResultSource,
): FhirObservation {
  return {
    resourceType: 'Observation',
    id: src.id,
    subject: patientReference(ref),
    status: 'final',
    category: [observationCategory('laboratory', 'Laboratory')],
    code: {
      coding: src.jlac10
        ? [{ system: FHIR_CODE_SYSTEMS.jlac10, code: src.jlac10, display: src.name }]
        : [],
      text: src.name,
    },
    valueQuantity:
      src.value === undefined ? undefined : { value: src.value, unit: src.unit },
    valueString: src.valueText,
    interpretation: src.flag ? [interpretationConcept(src.flag)] : undefined,
    effectiveDateTime: src.effectiveDate,
  };
}

/** 処方 → MedicationRequest (YJコード, 一般名処方は下3桁 ZZZ 相当)。 */
export function toMedicationRequest(
  ref: PatientRef,
  src: PrescriptionSource,
): FhirMedicationRequest {
  const yj = normalizeYjCode(src.yjCode, src.isGenericName);
  return {
    resourceType: 'MedicationRequest',
    id: src.id,
    subject: patientReference(ref),
    status: src.stopped ? 'stopped' : 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: yj
        ? [{ system: FHIR_CODE_SYSTEMS.yj, code: yj, display: src.drugName }]
        : [],
      text: src.drugName,
    },
    authoredOn: src.authoredOn,
    dosageInstruction: src.dosageText ? [{ text: src.dosageText }] : undefined,
  };
}

/**
 * 6情報＋患者 → FHIR リソース配列 (患者を先頭に、6情報を順に正規化)。
 * id 未指定のリソースには `<種別>-<連番>` の安定 id を付与し、文書(document)化や
 * 参照整合に使えるようにする。collection/document の両 Bundle で共用する純変換。
 */
export function toSixInfoResources(src: SixInfoSource): FhirResource[] {
  const ref = src.patient.patientRef;
  const resources: FhirResource[] = [toPatient(src.patient)];
  (src.diagnoses ?? []).forEach((d, i) =>
    resources.push(withId(toCondition(ref, d), `cond-${i + 1}`)),
  );
  (src.allergies ?? []).forEach((a, i) =>
    resources.push(withId(toAllergyIntolerance(ref, a), `allergy-${i + 1}`)),
  );
  (src.infections ?? []).forEach((inf, i) =>
    resources.push(withId(infectionToObservation(ref, inf), `infection-${i + 1}`)),
  );
  (src.labResults ?? []).forEach((l, i) =>
    resources.push(withId(labResultToObservation(ref, l), `lab-${i + 1}`)),
  );
  (src.prescriptions ?? []).forEach((p, i) =>
    resources.push(withId(toMedicationRequest(ref, p), `med-${i + 1}`)),
  );
  return resources;
}

/** id 未設定なら付与する (既存 id は尊重)。 */
function withId<T extends { id?: string }>(resource: T, fallback: string): T {
  return resource.id ? resource : { ...resource, id: fallback };
}

/** リソース配列 → Bundle entry (document 種別は fullUrl=urn:uuid:<id> を付与)。 */
export function toBundleEntries(
  resources: FhirResource[],
  withFullUrl: boolean,
): FhirBundleEntry[] {
  return resources.map((resource) =>
    withFullUrl && resource.id
      ? { fullUrl: `urn:uuid:${resource.id}`, resource }
      : { resource },
  );
}

/**
 * 6情報＋患者 → FHIR Bundle (collection)。
 * 個別変換関数を束ねた純変換。文書(document)化は buildDocumentBundle で行う。
 */
export function toFhirBundle(src: SixInfoSource): FhirBundle {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: toBundleEntries(toSixInfoResources(src), false),
  };
}

/* ── 3文書 (HS037健診 / HS038診療情報提供書 / HS039退院サマリ) document Bundle ─── */

/** 3文書の種別キー (CLINS-IG / HS037-039)。 */
export type DocumentKind = keyof typeof FHIR_DOCUMENT_TYPES;

/** 文書共通メタ (発行日・タイトル・発行/宛先医療機関・本文)。 */
export interface DocumentMeta {
  /** 発行日時 (ISO 8601)。 */
  date?: string;
  /** 文書タイトル (省略時は種別の既定名)。 */
  title?: string;
  /** 発行医療機関 (custodian/author)。 */
  authorOrgName?: string;
  /** 宛先医療機関 (診療情報提供書の紹介先 等)。 */
  recipientOrgName?: string;
  /** 文書本文 (ナラティブ。署名済みプレーンテキスト)。 */
  narrative?: string;
  /** preliminary(下書き) か final(確定)。既定 final。 */
  finalized?: boolean;
}

/** 3文書生成の入力 = 文書メタ + 添付する6情報サブセット。 */
export interface DocumentSource extends DocumentMeta {
  kind: DocumentKind;
  six: SixInfoSource;
}

function documentTypeConcept(kind: DocumentKind): FhirCodeableConcept {
  const t = FHIR_DOCUMENT_TYPES[kind];
  return {
    coding: [
      { system: FHIR_CODE_SYSTEMS.loinc, code: t.loinc, display: t.display },
      { system: 'urn:medixus:mhlw-hs', code: t.hs, display: t.display },
    ],
    text: t.display,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 内部データ → 3文書 FHIR Bundle (type:'document')。
 * 先頭に Composition (文書ヘッダ) を置き、患者・6情報・発行/宛先 Organization を
 * supporting resource として束ねる純変換。section.entry が本文リソースを参照する。
 * (要件定義書 IF-EXT-05 / FR-DOC-02 HS038・HS039 出力源)。
 */
export function buildDocumentBundle(src: DocumentSource): FhirBundle {
  const patientRef = src.six.patient.patientRef;
  const sixResources = toSixInfoResources(src.six);
  const date = src.date ?? new Date().toISOString();

  const orgs: FhirOrganization[] = [];
  let custodian: FhirReference | undefined;
  let recipient: FhirReference | undefined;
  if (src.authorOrgName) {
    const id = 'org-author';
    orgs.push({ resourceType: 'Organization', id, name: src.authorOrgName });
    custodian = { reference: `Organization/${id}`, display: src.authorOrgName };
  }
  if (src.recipientOrgName) {
    const id = 'org-recipient';
    orgs.push({ resourceType: 'Organization', id, name: src.recipientOrgName });
    recipient = { reference: `Organization/${id}`, display: src.recipientOrgName };
  }

  // section.entry に本文(患者以外)の6情報リソース参照を列挙。
  const entryRefs: FhirReference[] = sixResources
    .filter((r) => r.resourceType !== 'Patient' && r.id)
    .map((r) => ({ reference: `${r.resourceType}/${r.id}` }));

  const narrativeText: { status: 'generated'; div: string } | undefined = src.narrative
    ? {
        status: 'generated',
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(src.narrative)}</div>`,
      }
    : undefined;

  const sections: NonNullable<FhirComposition['section']> = [
    {
      title: FHIR_DOCUMENT_TYPES[src.kind].display,
      code: documentTypeConcept(src.kind),
      text: narrativeText,
      entry: entryRefs.length ? entryRefs : undefined,
    },
  ];
  if (recipient) sections.push({ title: '紹介先', entry: [recipient] });

  const composition: FhirComposition = {
    resourceType: 'Composition',
    id: 'composition',
    status: src.finalized === false ? 'preliminary' : 'final',
    type: documentTypeConcept(src.kind),
    subject: { reference: `Patient/${patientRef}` },
    date,
    title: src.title ?? FHIR_DOCUMENT_TYPES[src.kind].display,
    author: custodian ? [custodian] : undefined,
    custodian,
    section: sections,
  };

  const resources: FhirResource[] = [composition, ...sixResources, ...orgs];
  return {
    resourceType: 'Bundle',
    type: 'document',
    timestamp: date,
    entry: toBundleEntries(resources, true),
  };
}
