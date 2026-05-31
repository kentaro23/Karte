/**
 * IF-EXT-07 データポータビリティ(エクスポート) (G27) — アダプタ (STUB)。
 *
 * FHIR/SS-MIX2 形式でのフルエクスポート＋共通データ移行レイアウト準拠。
 * 「ロックインしない電子カルテ」を担保する (要件定義書 IF-EXT-07 / P8)。
 * 本番接続(ファイル生成)は行わず status:'STUB' を返す型安全スタブ。
 */
import { type IntegrationResult } from '../types.js';
import type { PatientRef } from '../types.js';
import { toFhirBundle, type SixInfoSource } from '../fhir/jpcore-mapping.js';
import type { FhirBundle } from '../fhir/resources.js';
import {
  buildHl7v25Message,
  ssMix2Path,
  type SsMix2Record,
} from '../ssmix2/storage.js';

/** エクスポート形式。 */
export type PortabilityFormat = 'FHIR' | 'SS_MIX2' | 'COMMON_MIGRATION_LAYOUT';

/** エクスポート要求。 */
export interface PortabilityExportRequest {
  /** 患者単位(指定) or 全件(undefined)。 */
  patientRef?: PatientRef;
  format: PortabilityFormat;
  /** 期間指定 (任意)。 */
  from?: string;
  to?: string;
}

/** エクスポート結果メタ (生成物の所在等)。 */
export interface PortabilityExportResult {
  format: PortabilityFormat;
  recordCount: number;
  /** 生成アーカイブの参照 (本番化時)。 */
  artifactUri?: string;
}

/**
 * 1患者分のエクスポート対象データ (6情報 + SS-MIX2 蓄積レコード)。
 * 全件エクスポートはこの配列を患者ごとに連結する。
 */
export interface ExportDataset {
  patients: SixInfoSource[];
  /** SS-MIX2 蓄積対象の生レコード (任意)。 */
  ssmix2Records?: SsMix2Record[];
}

/* ── FHIR フルエクスポート ───────────────────────────────────────────────── */

/**
 * 全患者の6情報を 1つの FHIR Bundle (collection) に束ねる純変換。
 * 患者ごとの collection を 1束にまとめ、recordCount は総リソース数。
 */
export function buildFhirExport(dataset: ExportDataset): {
  bundle: FhirBundle;
  recordCount: number;
} {
  const entry = dataset.patients.flatMap((p) => toFhirBundle(p).entry);
  return {
    bundle: {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: new Date().toISOString(),
      entry,
    },
    recordCount: entry.length,
  };
}

/* ── SS-MIX2 フルエクスポート ─────────────────────────────────────────────── */

/** SS-MIX2 エクスポートの1ファイル相当 (蓄積パス + HL7 v2.5 本文)。 */
export interface SsMix2ExportFile {
  path: string;
  hl7Message: string;
}

/**
 * SS-MIX2 蓄積レコードを (path, HL7 v2.5 メッセージ) の列に変換する純関数。
 * record.hl7Message があれば尊重し、無ければ buildHl7v25Message で生成する。
 */
export function buildSsMix2Export(records: SsMix2Record[]): {
  files: SsMix2ExportFile[];
  recordCount: number;
} {
  const files = records.map((r) => ({
    path: ssMix2Path(r),
    hl7Message: r.hl7Message ?? buildHl7v25Message(r),
  }));
  return { files, recordCount: files.length };
}

/* ── 共通データ移行レイアウト ─────────────────────────────────────────────── */

/** 共通移行レイアウトの1テーブル (区分 + ヘッダ + 行)。MIG-01 取込互換。 */
export interface MigrationTable {
  /** テーブル区分 (PATIENT/DIAGNOSIS/ALLERGY/MEDICATION/LAB/INFECTION)。 */
  section: string;
  columns: string[];
  rows: (string | number | null)[][];
}

/**
 * 6情報 → 共通データ移行レイアウト (区分別テーブル) を組み立てる純変換。
 * 「ロックインしない電子カルテ」(P8) のための機種非依存タブ区切り互換出力。
 * 列はコード体系キー(ICD-10/J-FAGY/YJ/JLAC10)を含め、他EMRへ取込可能にする。
 * (要件定義書 IF-EXT-07 AC(2) / MIG-01)。
 */
export function buildCommonMigrationLayout(patients: SixInfoSource[]): MigrationTable[] {
  const patientRows: (string | number | null)[][] = [];
  const dxRows: (string | number | null)[][] = [];
  const allergyRows: (string | number | null)[][] = [];
  const medRows: (string | number | null)[][] = [];
  const labRows: (string | number | null)[][] = [];
  const infRows: (string | number | null)[][] = [];

  for (const p of patients) {
    const ref = p.patient.patientRef;
    patientRows.push([
      ref,
      p.patient.familyName ?? null,
      p.patient.givenName ?? null,
      p.patient.sex ?? null,
      p.patient.birthDate ?? null,
    ]);
    for (const d of p.diagnoses ?? []) {
      dxRows.push([
        ref,
        d.standardDiseaseCode ?? null,
        d.icd10 ?? null,
        d.name,
        d.isSuspected ? '疑い' : '確定',
        d.startDate ?? null,
        d.active === false ? '転帰' : '継続',
      ]);
    }
    for (const a of p.allergies ?? []) {
      allergyRows.push([
        ref,
        a.category === 'DRUG' ? '薬剤アレルギー等' : 'その他アレルギー等',
        a.jFagy ?? null,
        a.substance,
        a.reaction ?? null,
      ]);
    }
    for (const m of p.prescriptions ?? []) {
      medRows.push([
        ref,
        m.yjCode ?? null,
        m.isGenericName ? '一般名処方' : '銘柄',
        m.drugName,
        m.dosageText ?? null,
        m.authoredOn ?? null,
      ]);
    }
    for (const l of p.labResults ?? []) {
      labRows.push([
        ref,
        l.jlac10 ?? null,
        l.name,
        l.value ?? l.valueText ?? null,
        l.unit ?? null,
        l.flag ?? null,
        l.effectiveDate ?? null,
      ]);
    }
    for (const inf of p.infections ?? []) {
      infRows.push([
        ref,
        inf.jlac10 ?? null,
        inf.name,
        inf.positive === undefined ? null : inf.positive ? '陽性' : '陰性',
        inf.examDate ?? null,
      ]);
    }
  }

  return [
    { section: 'PATIENT', columns: ['patientRef', 'familyName', 'givenName', 'sex', 'birthDate'], rows: patientRows },
    { section: 'DIAGNOSIS', columns: ['patientRef', 'standardDiseaseCode', 'icd10', 'name', 'certainty', 'startDate', 'outcome'], rows: dxRows },
    { section: 'ALLERGY', columns: ['patientRef', 'category', 'jFagy', 'substance', 'reaction'], rows: allergyRows },
    { section: 'MEDICATION', columns: ['patientRef', 'yjCode', 'kind', 'drugName', 'dosage', 'authoredOn'], rows: medRows },
    { section: 'LAB', columns: ['patientRef', 'jlac10', 'name', 'value', 'unit', 'flag', 'effectiveDate'], rows: labRows },
    { section: 'INFECTION', columns: ['patientRef', 'jlac10', 'name', 'result', 'examDate'], rows: infRows },
  ];
}

/** 共通移行レイアウトの総行数 (区分ヘッダを除く)。recordCount 用。 */
export function countMigrationRows(tables: MigrationTable[]): number {
  return tables.reduce((n, t) => n + t.rows.length, 0);
}

/* ── ディスパッチ ─────────────────────────────────────────────────────────── */

/**
 * 形式別にエクスポート成果物を組み立てる純関数 (本番化時の生成本体)。
 * recordCount を返し、artifact はメモリ上の構造化データとして返す。
 */
export function buildExport(
  format: PortabilityFormat,
  dataset: ExportDataset,
):
  | { format: 'FHIR'; recordCount: number; bundle: FhirBundle }
  | { format: 'SS_MIX2'; recordCount: number; files: SsMix2ExportFile[] }
  | { format: 'COMMON_MIGRATION_LAYOUT'; recordCount: number; tables: MigrationTable[] } {
  if (format === 'FHIR') {
    const { bundle, recordCount } = buildFhirExport(dataset);
    return { format, recordCount, bundle };
  }
  if (format === 'SS_MIX2') {
    const { files, recordCount } = buildSsMix2Export(dataset.ssmix2Records ?? []);
    return { format, recordCount, files };
  }
  const tables = buildCommonMigrationLayout(dataset.patients);
  return { format, recordCount: countMigrationRows(tables), tables };
}

/**
 * 患者データを FHIR/SS-MIX2/共通移行レイアウトでエクスポートする (STUB)。
 * 本番接続(アーカイブ生成・配信)は行わないが、純関数の生成ロジックは
 * buildExport / buildFhirExport / buildSsMix2Export / buildCommonMigrationLayout に
 * 実装済み。後で IOP がデータ取得を結線して artifactUri を返す。
 */
export async function exportData(
  req: PortabilityExportRequest,
): Promise<IntegrationResult<PortabilityExportResult>> {
  // データ取得は未結線のため、空データセットで形式だけ確定して STUB を返す。
  const built = buildExport(req.format, { patients: [] });
  return { status: 'STUB', data: { format: built.format, recordCount: built.recordCount } };
}
