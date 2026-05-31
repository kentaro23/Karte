/* ──────────────────────────────────────────────────────────────────────────
   orders/rx 共有定数・純関数（client / server 双方から import 可能）。
   ─────────────────────────────────────────────────────────────────────────
   WIRE-RX1: 用法は本来 UsageMaster（DB）から読み込む。ここに置くのは
   - UI/サーバ双方で使う用法の型（UsageOption）
   - DB 未接続(フロントのみモード)・UsageMaster 未整備時の決定論フォールバック
   - 用法コードから「頓服か(isAsNeeded)」「1日回数」を引く純関数
   本ファイルは 'use server' を持たない通常モジュール。副作用なし・決定論。
   ────────────────────────────────────────────────────────────────────────── */

/** UI に渡す用法 1 件（UsageMaster を UI 向けに最小整形したもの）。 */
export interface UsageOption {
  /** UsageMaster.code（PrescriptionItem.usageCode / OrderSetItem.usageCode に格納） */
  value: string;
  /** 画面表示ラベル（group + 補足を含む） */
  label: string;
  /** 表示グルーピング（内服/頓服/外用 等） */
  group: '内服' | '頓服' | '外用' | 'その他';
  /** 頓服（日数任意判定に使用＝UsageMaster.isAsNeeded） */
  isAsNeeded: boolean;
  /** 既定の 1 日回数（UsageMaster.defaultTimesPerDay） */
  defaultTimesPerDay?: number;
}

/** UsageCategory → 表示グループ。 */
export function groupForCategory(category: string): UsageOption['group'] {
  switch (category) {
    case 'INTERNAL':
      return '内服';
    case 'AS_NEEDED':
      return '頓服';
    case 'EXTERNAL':
      return '外用';
    default:
      return 'その他';
  }
}

/**
 * UsageMaster 未整備/未接続時の決定論フォールバック用法。
 * 旧 UI のハードコード用法と同一の挙動（code/表示/頓服/回数）を保ち、
 * DB から読めない環境でも処方が組めるようにする。
 */
export const FALLBACK_USAGES: UsageOption[] = [
  { value: '毎食後', label: '内服・毎食後（1日3回）', group: '内服', isAsNeeded: false, defaultTimesPerDay: 3 },
  { value: '毎食前', label: '内服・毎食前（1日3回）', group: '内服', isAsNeeded: false, defaultTimesPerDay: 3 },
  { value: '朝食後', label: '内服・朝食後（1日1回）', group: '内服', isAsNeeded: false, defaultTimesPerDay: 1 },
  { value: '朝夕食後', label: '内服・朝夕食後（1日2回）', group: '内服', isAsNeeded: false, defaultTimesPerDay: 2 },
  { value: '就寝前', label: '内服・就寝前（1日1回）', group: '内服', isAsNeeded: false, defaultTimesPerDay: 1 },
  { value: '8時間毎', label: '内服・8時間毎（1日3回）', group: '内服', isAsNeeded: false, defaultTimesPerDay: 3 },
  { value: '頓用', label: '頓服・頓用', group: '頓服', isAsNeeded: true },
  { value: '発熱時頓用', label: '頓服・発熱時', group: '頓服', isAsNeeded: true },
  { value: '疼痛時頓用', label: '頓服・疼痛時', group: '頓服', isAsNeeded: true },
  { value: '外用', label: '外用', group: '外用', isAsNeeded: false },
];

/**
 * 用法コード→頓服か。第一の真実は UsageMaster.isAsNeeded（usages 引数）。
 * usages に未収載のコードは「頓」を含むかのヒューリスティックにフォールバック
 * （旧挙動互換 — マスタ未整備でも院外内服日数必須判定が壊れない）。
 */
export function usageIsAsNeeded(usageCode: string, usages?: UsageOption[]): boolean {
  const u = usages?.find((x) => x.value === usageCode);
  if (u) return u.isAsNeeded;
  return (usageCode ?? '').includes('頓');
}

/** 用法コード→既定 1 日回数（無ければ undefined）。 */
export function usageDefaultTpd(usageCode: string, usages: UsageOption[]): number | undefined {
  return usages.find((x) => x.value === usageCode)?.defaultTimesPerDay;
}
