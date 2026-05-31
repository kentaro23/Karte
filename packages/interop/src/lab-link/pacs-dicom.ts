/**
 * IF-EXT-04 PACS連携 — DICOM(HS011)/JJ1017(HS017)/JAHIS放射線(HS016) アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * PACS画像表示(WADO等)・キー画像登録を後で実装する前提。規格連携のみ
 * (モダリティ制御は対象外 / 要件定義書 2章 対象外)。
 */
import { stubResult, type IntegrationResult } from '../types.js';
import type { KeyImageRef, PacsStudyQuery, PacsStudyRef } from './types.js';

/** PACS のスタディを検索し画像参照メタを返す。 */
export async function queryStudies(
  _query: PacsStudyQuery,
): Promise<IntegrationResult<PacsStudyRef[]>> {
  return stubResult<PacsStudyRef[]>();
}

/** キー画像を診療録/紹介状に登録する。 */
export async function registerKeyImage(
  _ref: KeyImageRef,
): Promise<IntegrationResult<{ keyImageId: string }>> {
  return stubResult<{ keyImageId: string }>();
}
