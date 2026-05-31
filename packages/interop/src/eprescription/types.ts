/**
 * IF-EXT-03 電子処方箋 (G23) — 型定義。
 *
 * 電子処方箋管理サービスへ院外処方箋登録、重複投薬・併用禁忌チェック要求/結果、
 * 調剤結果リスト取得。一般名処方・リフィル。自社決定論安全エンジン(FR-RXSAFE)と
 * 相補(管理サービスの全国横断チェックを併用)。
 */
import type { PatientRef, YjCode } from '../types.js';

/** 処方明細1行。一般名処方は YJ 下3桁 zzz 相当(銘柄指定不可)。 */
export interface EPrescriptionLine {
  yjCode?: YjCode;
  /** true=一般名処方。 */
  isGenericName?: boolean;
  drugName: string;
  dosePerTake?: number;
  unit?: string;
  frequency?: string;
  durationDays?: number;
}

/** 院外処方箋の登録要求。 */
export interface EPrescriptionRequest {
  patientRef: PatientRef;
  prescriberName: string;
  issuedDate: string; // ISO 8601
  lines: EPrescriptionLine[];
  /** リフィル回数 (0=通常)。 */
  refillCount?: number;
}

/** 重複投薬・併用禁忌チェックの指摘1件 (全国横断)。 */
export interface EPrescriptionCheckFinding {
  type: 'DUPLICATE' | 'INTERACTION';
  severity: 'CONTRAINDICATED' | 'CAUTION';
  message: string;
  counterpartDrug?: string;
  sourceFacility?: string;
}

/** 院外処方箋登録の結果。 */
export interface EPrescriptionResult {
  prescriptionId?: string;
  accessCode?: string; // 引換番号
  findings: EPrescriptionCheckFinding[];
}

/** 調剤結果リストの1件。 */
export interface DispenseResult {
  yjCode?: YjCode;
  drugName: string;
  dispensedQuantity?: number;
  dispensedDate?: string;
  pharmacyName?: string;
}
