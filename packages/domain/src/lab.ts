/**
 * 検査結果 基準値判定・トレンド整形 — FR-LAB-01 / 別紙1 §検査結果 / 174項 6情報.
 * Framework-free pure functions. ExamMaster.refLow/refHigh で H/L を判定し、
 * 同一項目の時系列をトレンド用に整形する（chart 結果タブ／経過表の source）。
 */
export type LabFlag = 'H' | 'L' | 'N';

export const LAB_FLAG_LABEL: Record<LabFlag, string> = {
  H: '高値',
  L: '低値',
  N: '基準内',
};

/**
 * 基準値判定（純関数）.
 * - 数値が無い場合は null（判定不能）。
 * - refHigh 超過 => 'H'、refLow 未満 => 'L'、それ以外 => 'N'。
 * - 片側のみ基準値が与えられた場合はその側のみで判定。
 * - 両側とも未指定なら 'N'（基準なし＝逸脱なし扱い）。
 */
export function judgeLabFlag(
  value: number | null | undefined,
  refLow?: number | null,
  refHigh?: number | null,
): LabFlag | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (refHigh !== null && refHigh !== undefined && value > refHigh) return 'H';
  if (refLow !== null && refLow !== undefined && value < refLow) return 'L';
  return 'N';
}

/** トレンド入力点（測定値＋採取日時＋任意の基準値）。 */
export interface LabPoint {
  value: number | null | undefined;
  collectedAt: Date | string;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
}

/** トレンド整形後の1点（採取日時昇順・flag 付与済み）。 */
export interface LabTrendPoint {
  value: number;
  collectedAt: Date;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: LabFlag;
}

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/**
 * トレンド整形（純関数）.
 * 数値の無い点を除外し、採取日時の昇順に並べ、各点へ H/L/N フラグを付与する。
 * グラフ描画・経過表の即時利用を意図した正規化済み配列を返す。
 */
export function buildLabTrend(points: readonly LabPoint[]): LabTrendPoint[] {
  return points
    .filter(
      (p): p is LabPoint & { value: number } =>
        p.value !== null && p.value !== undefined && !Number.isNaN(p.value),
    )
    .map((p) => {
      const collectedAt = toDate(p.collectedAt);
      const refLow = p.refLow ?? null;
      const refHigh = p.refHigh ?? null;
      return {
        value: p.value,
        collectedAt,
        unit: p.unit ?? null,
        refLow,
        refHigh,
        flag: judgeLabFlag(p.value, refLow, refHigh) ?? 'N',
      };
    })
    .sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());
}
