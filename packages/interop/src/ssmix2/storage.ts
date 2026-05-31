/**
 * IF-EXT-06 SS-MIX2・地域連携 (G26 / HS026, IHE HS025) — 標準化ストレージ アダプタ (STUB)。
 *
 * 患者・アレルギー・病名・処方・注射・検体検査・放射線等を SS-MIX2 標準化ストレージ
 * (HL7 v2.5 メッセージ + 階層フォルダ) に蓄積し、地域医療連携ネットワーク(IHE-ITI)で
 * 多施設共有する。本番接続は行わず status:'STUB' を返す型安全スタブ。
 */
import { type IntegrationResult } from '../types.js';
import type { PatientRef } from '../types.js';

/** SS-MIX2 に蓄積するデータ種別 (HL7 v2.5 メッセージ種別に対応)。 */
export type SsMix2DataType =
  | 'PATIENT' // ADT (患者基本)
  | 'ALLERGY' // 患者禁忌・アレルギー
  | 'DIAGNOSIS' // 病名
  | 'PRESCRIPTION' // 処方 (RDE/RAS)
  | 'INJECTION' // 注射
  | 'LAB' // 検体検査 (OUL)
  | 'RADIOLOGY'; // 放射線

/** SS-MIX2 標準化ストレージへ蓄積する1レコード。 */
export interface SsMix2Record {
  patientRef: PatientRef;
  dataType: SsMix2DataType;
  /** 観測/発生日時 (フォルダ階層キー)。ISO 8601。 */
  observedAt: string;
  /** HL7 v2.5 メッセージ本文 (本番化時に生成)。 */
  hl7Message?: string;
  /** 任意の正規化済みペイロード (HL7生成前の中間表現)。 */
  payload?: unknown;
}

/** データ種別 → HL7 v2.5 メッセージ型 (MSH-9)。 */
const HL7_MESSAGE_TYPE: Record<SsMix2DataType, string> = {
  PATIENT: 'ADT^A08', // 患者基本情報更新
  ALLERGY: 'ADT^A60', // アレルギー/禁忌情報
  DIAGNOSIS: 'PPR^PC1', // 問題(病名)
  PRESCRIPTION: 'RDE^O11', // 処方オーダ
  INJECTION: 'RAS^O17', // 注射実施
  LAB: 'OUL^R22', // 検体検査結果
  RADIOLOGY: 'ORU^R01', // 放射線レポート
};

/** ISO 8601 → HL7 タイムスタンプ (yyyyMMddHHmmss)。不正値は現在時刻。 */
function hl7Timestamp(iso: string): string {
  const d = new Date(iso);
  const base = isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${base.getUTCFullYear()}${p(base.getUTCMonth() + 1)}${p(base.getUTCDate())}` +
    `${p(base.getUTCHours())}${p(base.getUTCMinutes())}${p(base.getUTCSeconds())}`
  );
}

/** observedAt の日付部 (yyyyMMdd)。パス階層キー。 */
function yyyymmdd(iso: string): string {
  return hl7Timestamp(iso).slice(0, 8);
}

/**
 * SS-MIX2 標準化ストレージの階層パスを組み立てる(純関数)。
 * 仕様: 患者ID(SHA-1ハッシュ)先頭3桁/先頭4桁/患者ID/yyyyMMdd/データ種別.
 * 本実装はハッシュ計算を伴わない簡易版 (患者IDをそのまま分割キーに使用)。
 * 本番化時に SHA-1 ハッシュ分割へ置換する。
 */
export function ssMix2Path(record: Pick<SsMix2Record, 'patientRef' | 'dataType' | 'observedAt'>): string {
  const pid = record.patientRef || 'UNKNOWN';
  const k1 = pid.slice(0, 3).padEnd(3, '0');
  const k2 = pid.slice(0, 4).padEnd(4, '0');
  return `/${k1}/${k2}/${pid}/${yyyymmdd(record.observedAt)}/${record.dataType}`;
}

/**
 * 1レコード → HL7 v2.5 メッセージ(最小)を組み立てる純関数。
 * MSH + PID を必ず含め、payload があれば ZXP(独自Zセグメント)に要約を載せる。
 * 本番化時に種別別の標準セグメント(PRD/RXE/OBX 等)へ拡張する。
 */
export function buildHl7v25Message(record: SsMix2Record): string {
  const ts = hl7Timestamp(record.observedAt);
  const msgType = HL7_MESSAGE_TYPE[record.dataType];
  const ctrlId = `${record.dataType}-${ts}`;
  const lines = [
    `MSH|^~\\&|MEDIXUS|MEDIXUS|||${ts}||${msgType}|${ctrlId}|P|2.5`,
    `PID|1||${record.patientRef}`,
  ];
  if (record.payload !== undefined) {
    let summary: string;
    try {
      summary = JSON.stringify(record.payload);
    } catch {
      summary = String(record.payload);
    }
    // パイプ等のHL7区切り文字を無害化。
    lines.push(`ZXP|1|${summary.replace(/[|^~\\&\r\n]/g, ' ')}`);
  }
  return lines.join('\r');
}

/**
 * SS-MIX2 標準化ストレージへ蓄積する (STUB)。
 * 本番接続(ファイル生成)は行わないが、蓄積先パスと HL7 v2.5 メッセージは純関数で
 * 組み立てて結果に載せる (status は 'STUB' のまま)。
 */
export async function storeRecord(
  record: SsMix2Record,
): Promise<IntegrationResult<{ stored: boolean; path?: string }>> {
  try {
    const path = ssMix2Path(record);
    return { status: 'STUB', data: { stored: false, path } };
  } catch (e) {
    return { status: 'STUB', error: e instanceof Error ? e.message : 'ssmix2 build failed' };
  }
}

/** 地域連携基盤(IHE-ITI)へ患者データを提供/同期する (STUB)。 */
export async function shareToRegionalNetwork(
  _patientRef: PatientRef,
): Promise<IntegrationResult<{ shared: boolean }>> {
  return { status: 'STUB', data: { shared: false } };
}
