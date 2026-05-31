/**
 * IF-EXT-04 外注検査 — JAHIS臨床検査データ交換規約(HS012/JLAC) アダプタ (STUB)。
 *
 * 本番接続は行わず IntegrationResult を status:'STUB' で返す型安全スタブ。
 * 検査依頼自動連携(送信)・結果取込(受信)を後で実装する前提。
 *
 * スタブは「型付きの代表ペイロード(data)」を同梱して返す(status は常に 'STUB')。
 * これにより DB/本番接続が無い段階でも、呼び出し側が検査依頼の受理応答・結果取込の
 * 型どおりの値を受け取り fail-soft に描画できる。本番化時は検査会社の HS012 メッセージ
 * 送受信に置換する。
 */
import type { IntegrationResult } from '../types.js';
import type { LabOrderOut, LabResultIn } from './types.js';

/** status:'STUB' を保ったまま型付きの代表 data を同梱する内部ヘルパ。 */
function stubData<T>(data: T): IntegrationResult<T> {
  return { status: 'STUB', data, error: 'not-implemented: STUB adapter' };
}

/** 外注検査オーダを検査会社へ送信する (FR-EXM-01)。 */
export async function sendLabOrder(
  order: LabOrderOut,
): Promise<IntegrationResult<{ accepted: boolean; orderNo: string }>> {
  // スタブは受理応答(accepted=true・依頼番号エコー)を返す。
  return stubData<{ accepted: boolean; orderNo: string }>({
    accepted: true,
    orderNo: order.orderNo,
  });
}

/** 外注検査結果を取込む (JAHIS HS012 受信)。 */
export async function fetchLabResults(
  orderNo: string,
): Promise<IntegrationResult<LabResultIn>> {
  // スタブは当該依頼番号の「結果待ち(results 空・PENDING)」を返す。
  return stubData<LabResultIn>({
    orderNo,
    patientRef: '',
    reportedDate: '',
    status: 'PENDING',
    results: [],
  });
}
