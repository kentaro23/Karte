/**
 * 会計 点→円・自己負担計算 — FR-BIL-01 / 別紙1 §会計 / 174項 102.
 * Framework-free pure functions. 1点=10円。保険本体算定はレセコン委譲だが、
 * 点数合計→請求額・自己負担の即時表示は内製で行う。
 */

/** 1点あたりの円。診療報酬の固定換算。 */
export const YEN_PER_POINT = 10;

/** 自己負担割合（保険）。0.0〜1.0 で表現（3割=0.3）。 */
export type CopayRatio = 0 | 0.1 | 0.2 | 0.3;

/** 点数を円へ換算（純関数）。1点=10円。 */
export function pointsToYen(points: number): number {
  return points * YEN_PER_POINT;
}

/**
 * 自己負担額の計算（純関数）.
 * 総点数→総額（円）→負担割合を乗じ、保険会計の慣行に従い 10円未満を四捨五入。
 * ratio が範囲外（<0 または >1）は Error。
 */
export function calcCopay(totalPoints: number, ratio: number): number {
  if (ratio < 0 || ratio > 1) {
    throw new Error(`不正な自己負担割合: ${ratio}`);
  }
  const totalYen = pointsToYen(totalPoints);
  return roundTo10Yen(totalYen * ratio);
}

/** 10円単位の四捨五入（保険一部負担金の端数処理）。 */
export function roundTo10Yen(yen: number): number {
  return Math.round(yen / 10) * 10;
}

/** 会計内訳（保険分＋自費分＋繰越・調整）。 */
export interface BillingBreakdown {
  /** 保険対象の総点数。 */
  totalPoints: number;
  /** 総点数を円換算した総額（10割相当）。 */
  totalYen: number;
  /** 自己負担割合。 */
  copayRatio: number;
  /** 自己負担額（保険分・端数処理後）。 */
  copayYen: number;
  /** 保険者負担額（総額−自己負担）。 */
  insurerYen: number;
  /** 自費（保険外）金額。 */
  selfPayYen: number;
  /** 前回までの繰越額（＋で未収）。 */
  carryOverYen: number;
  /** 調整金（割引等。負で減算）。 */
  adjustmentYen: number;
  /** 今回請求額（自己負担＋自費＋繰越＋調整）。 */
  billedYen: number;
}

export interface BillingInput {
  totalPoints: number;
  copayRatio: number;
  selfPayYen?: number;
  carryOverYen?: number;
  adjustmentYen?: number;
}

/**
 * 会計内訳の算定（純関数）.
 * 点数合計と各種金額から自己負担・保険者負担・請求額を組み立てる。
 */
export function buildBillingBreakdown(input: BillingInput): BillingBreakdown {
  const totalYen = pointsToYen(input.totalPoints);
  const copayYen = calcCopay(input.totalPoints, input.copayRatio);
  const insurerYen = totalYen - copayYen;
  const selfPayYen = input.selfPayYen ?? 0;
  const carryOverYen = input.carryOverYen ?? 0;
  const adjustmentYen = input.adjustmentYen ?? 0;
  const billedYen = copayYen + selfPayYen + carryOverYen + adjustmentYen;
  return {
    totalPoints: input.totalPoints,
    totalYen,
    copayRatio: input.copayRatio,
    copayYen,
    insurerYen,
    selfPayYen,
    carryOverYen,
    adjustmentYen,
    billedYen,
  };
}
