/**
 * IF-EXT-01 レセコン/ORCA連携 — WebORCA/共通算定モジュール アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * 後で IOPスクワッドが WebAPI(日レセ HAORI/API 等) を実装する前提の最小実装。
 */
import { stubResult, type IntegrationResult } from '../types.js';
import type {
  ReceiptClaimPayload,
  ReceiptClaimResult,
  ReceiptMasterImportResult,
} from './types.js';

/** カルテ確定時に算定情報(患者/保険/病名/オーダ)をレセコンへ送る。 */
export async function sendClaim(
  _payload: ReceiptClaimPayload,
): Promise<IntegrationResult<ReceiptClaimResult>> {
  return stubResult<ReceiptClaimResult>();
}

/** 中途終了データをレセコンへ登録する。 */
export async function registerInterimClaim(
  _payload: ReceiptClaimPayload,
): Promise<IntegrationResult<ReceiptClaimResult>> {
  return stubResult<ReceiptClaimResult>();
}

/** レセコンの点数/医薬品マスタを取込む (ORCA→Medixus)。 */
export async function importReceiptMaster(
  _masterType: ReceiptMasterImportResult['masterType'],
): Promise<IntegrationResult<ReceiptMasterImportResult>> {
  return stubResult<ReceiptMasterImportResult>();
}
