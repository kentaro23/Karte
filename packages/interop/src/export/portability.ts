/**
 * IF-EXT-07 データポータビリティ(エクスポート) (G27) — アダプタ (STUB)。
 *
 * FHIR/SS-MIX2 形式でのフルエクスポート＋共通データ移行レイアウト準拠。
 * 「ロックインしない電子カルテ」を担保する (要件定義書 IF-EXT-07 / P8)。
 * 本番接続(ファイル生成)は行わず status:'STUB' を返す型安全スタブ。
 */
import { stubResult, type IntegrationResult } from '../types.js';
import type { PatientRef } from '../types.js';

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

/** 患者データを FHIR/SS-MIX2/共通移行レイアウトでエクスポートする。 */
export async function exportData(
  _req: PortabilityExportRequest,
): Promise<IntegrationResult<PortabilityExportResult>> {
  return stubResult<PortabilityExportResult>();
}
