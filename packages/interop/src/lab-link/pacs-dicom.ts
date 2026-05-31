/**
 * IF-EXT-04 PACS連携 — DICOM(HS011)/JJ1017(HS017)/JAHIS放射線(HS016) アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * PACS画像表示(WADO等)・キー画像登録を後で実装する前提。規格連携のみ
 * (モダリティ制御は対象外 / 要件定義書 2章 対象外)。
 *
 * スタブは「型付きの代表ペイロード(data)」を同梱して返す(status は常に 'STUB')。
 * これにより DB/本番接続が無い段階でも、呼び出し側がスタディ一覧・キー画像登録結果の
 * 型どおりの値を受け取り fail-soft に描画できる。本番化時は PACS の WADO-RS/QIDO-RS 等に
 * 置換する。
 */
import type { IntegrationResult } from '../types.js';
import type { KeyImageRef, PacsStudyQuery, PacsStudyRef } from './types.js';

/** status:'STUB' を保ったまま型付きの代表 data を同梱する内部ヘルパ。 */
function stubData<T>(data: T): IntegrationResult<T> {
  return { status: 'STUB', data, error: 'not-implemented: STUB adapter' };
}

/** PACS のスタディを検索し画像参照メタを返す。 */
export async function queryStudies(
  _query: PacsStudyQuery,
): Promise<IntegrationResult<PacsStudyRef[]>> {
  // スタブは空配列(該当スタディなし)を返し、画面が空状態を fail-soft 表示できる形にする。
  return stubData<PacsStudyRef[]>([]);
}

/** キー画像を診療録/紹介状に登録する。 */
export async function registerKeyImage(
  _ref: KeyImageRef,
): Promise<IntegrationResult<{ keyImageId: string }>> {
  // スタブは採番済みキー画像IDを返す。
  return stubData<{ keyImageId: string }>({ keyImageId: 'STUB-KEY-IMAGE-ID' });
}
