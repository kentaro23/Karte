/**
 * IF-EXT-02 オンライン資格確認/マイナ保険証 — オン資アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * 院内ゲートウェイ/資格確認端末(オンライン資格確認等システム)連携は後で実装。
 */
import { stubResult, type IntegrationResult } from '../types.js';
import type {
  InsuranceVerifyRequest,
  InsuranceVerifyResult,
  OnshiPatientInfoResult,
} from './types.js';

/** 「保険証確認」で資格をリアルタイム取得する。 */
export async function verifyEligibility(
  _req: InsuranceVerifyRequest,
): Promise<IntegrationResult<InsuranceVerifyResult>> {
  return stubResult<InsuranceVerifyResult>();
}

/** オン資経由で薬剤情報・特定健診・6情報一覧を閲覧する。 */
export async function fetchPatientInfo(
  _req: InsuranceVerifyRequest,
): Promise<IntegrationResult<OnshiPatientInfoResult>> {
  return stubResult<OnshiPatientInfoResult>();
}
