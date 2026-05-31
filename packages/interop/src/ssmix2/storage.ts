/**
 * IF-EXT-06 SS-MIX2・地域連携 (G26 / HS026, IHE HS025) — 標準化ストレージ アダプタ (STUB)。
 *
 * 患者・アレルギー・病名・処方・注射・検体検査・放射線等を SS-MIX2 標準化ストレージ
 * (HL7 v2.5 メッセージ + 階層フォルダ) に蓄積し、地域医療連携ネットワーク(IHE-ITI)で
 * 多施設共有する。本番接続は行わず status:'STUB' を返す型安全スタブ。
 */
import { stubResult, type IntegrationResult } from '../types.js';
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

/** SS-MIX2 標準化ストレージへ蓄積する。 */
export async function storeRecord(
  _record: SsMix2Record,
): Promise<IntegrationResult<{ stored: boolean; path?: string }>> {
  return stubResult<{ stored: boolean; path?: string }>();
}

/** 地域連携基盤(IHE-ITI)へ患者データを提供/同期する。 */
export async function shareToRegionalNetwork(
  _patientRef: PatientRef,
): Promise<IntegrationResult<{ shared: boolean }>> {
  return stubResult<{ shared: boolean }>();
}
