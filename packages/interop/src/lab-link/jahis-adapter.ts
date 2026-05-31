/**
 * IF-EXT-04 外注検査 — JAHIS臨床検査データ交換規約(HS012/JLAC) アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * 検査依頼自動連携(送信)・結果取込(受信)を後で実装する前提。
 */
import { stubResult, type IntegrationResult } from '../types.js';
import type { LabOrderOut, LabResultIn } from './types.js';

/** 外注検査オーダを検査会社へ送信する (FR-EXM-01)。 */
export async function sendLabOrder(
  _order: LabOrderOut,
): Promise<IntegrationResult<{ accepted: boolean; orderNo: string }>> {
  return stubResult<{ accepted: boolean; orderNo: string }>();
}

/** 外注検査結果を取込む (JAHIS HS012 受信)。 */
export async function fetchLabResults(
  _orderNo: string,
): Promise<IntegrationResult<LabResultIn>> {
  return stubResult<LabResultIn>();
}
