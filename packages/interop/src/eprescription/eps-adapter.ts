/**
 * IF-EXT-03 電子処方箋 — 電子処方箋管理サービス(EPS) アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * 自社決定論安全エンジン(FR-RXSAFE)と相補で、全国横断の重複/併用禁忌チェックを
 * 後で実装する前提。
 */
import { stubResult, type IntegrationResult } from '../types.js';
import type {
  DispenseResult,
  EPrescriptionRequest,
  EPrescriptionResult,
} from './types.js';

/** 院外処方を電子処方箋として登録し、重複/併用禁忌チェック結果を得る。 */
export async function registerEPrescription(
  _req: EPrescriptionRequest,
): Promise<IntegrationResult<EPrescriptionResult>> {
  return stubResult<EPrescriptionResult>();
}

/** 重複投薬・併用禁忌チェックのみを要求する(登録前の事前確認)。 */
export async function checkDuplicationAndInteraction(
  _req: EPrescriptionRequest,
): Promise<IntegrationResult<EPrescriptionResult>> {
  return stubResult<EPrescriptionResult>();
}

/** 調剤結果リストを取得する。 */
export async function fetchDispenseResults(
  _prescriptionId: string,
): Promise<IntegrationResult<DispenseResult[]>> {
  return stubResult<DispenseResult[]>();
}
