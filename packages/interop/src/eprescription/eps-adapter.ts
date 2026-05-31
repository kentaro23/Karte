/**
 * IF-EXT-03 電子処方箋 — 電子処方箋管理サービス(EPS) アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * 自社決定論安全エンジン(FR-RXSAFE)と相補で、全国横断の重複/併用禁忌チェックを
 * 後で実装する前提。
 *
 * スタブは「型付きの代表ペイロード(data)」を同梱して返す(status は常に 'STUB')。
 * これにより DB/本番接続が無い段階でも、呼び出し側(サーバーアクション/画面)が
 * 処方登録結果・調剤結果の型どおりの値を受け取り fail-soft に描画できる。
 * 本番化時は EPS Web API(HPKI署名/電子処方箋ID採番/全国横断チェック)に置換する。
 */
import type { IntegrationResult } from '../types.js';
import type {
  DispenseResult,
  EPrescriptionRequest,
  EPrescriptionResult,
} from './types.js';

/**
 * status:'STUB' を保ったまま型付きの代表 data を同梱する内部ヘルパ。
 * (共有 stubResult は error のみのため、data 付与はアダプタ内で構築する。)
 */
function stubData<T>(data: T): IntegrationResult<T> {
  return { status: 'STUB', data, error: 'not-implemented: STUB adapter' };
}

/**
 * 要求から、全国横断チェック結果(本スタブでは指摘なし)を組み立てる。
 * 自社安全エンジンの院内判定と相補のため、ここでは EPS 由来(他院処方含む)の
 * 指摘のみを表現する。スタブは findings 空・overall:'OK' を既定とする。
 */
function buildResult(req: EPrescriptionRequest): EPrescriptionResult {
  return {
    overall: 'OK',
    findings: [],
    registeredAt: req.issuedDate,
  };
}

/** 院外処方を電子処方箋として登録し、重複/併用禁忌チェック結果を得る。 */
export async function registerEPrescription(
  req: EPrescriptionRequest,
): Promise<IntegrationResult<EPrescriptionResult>> {
  return stubData<EPrescriptionResult>({
    ...buildResult(req),
    prescriptionId: 'STUB-EPS-PRESCRIPTION-ID',
    accessCode: 'STUB-ACCESS-CODE',
  });
}

/** 重複投薬・併用禁忌チェックのみを要求する(登録前の事前確認)。 */
export async function checkDuplicationAndInteraction(
  req: EPrescriptionRequest,
): Promise<IntegrationResult<EPrescriptionResult>> {
  // 登録せず判定のみ。スタブは指摘なし(自社エンジンの院内判定と相補)。
  return stubData<EPrescriptionResult>(buildResult(req));
}

/** 調剤結果リストを取得する。 */
export async function fetchDispenseResults(
  _prescriptionId: string,
): Promise<IntegrationResult<DispenseResult[]>> {
  // スタブは空配列(未調剤)を返し、画面が「調剤待ち」を fail-soft 表示できる形にする。
  return stubData<DispenseResult[]>([]);
}
