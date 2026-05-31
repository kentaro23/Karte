'use server';
import { prisma } from '@medixus/db';
import { pointsToYen } from '@medixus/domain';

/**
 * FR-ANL（G28）経営ダッシュボード・統計 — データ集計（fail-soft）。
 *
 * DigiKar の内蔵統計は「月別受付回数のみ」で弱い。本モジュールは
 *   疾患別 / 医師別 / 月次点数推移 / 再診率 / 月次収益
 * を主要KPIとして可視化し、明確に凌駕する（要件定義書 3.2.2-1 / G28）。
 *
 * 算定本体はレセコン委譲（IF-EXT-01）。ここでは内製の点→円換算（domain.pointsToYen）
 * と Encounter / Order / PatientDiagnosis の集計で経営指標スナップショットを提示する。
 * すべて読み取り専用・追記専用原則を侵さない。DB 未接続・空でも決定論デモで必ず描画する。
 */

// ── 公開型（page / charts-client が消費）─────────────────────────────────────
export interface CategoryDatum {
  /** カテゴリ名（疾患名・医師名など） */
  label: string;
  /** 件数 */
  count: number;
}
export interface TrendDatum {
  /** X軸ラベル（YYYY/MM） */
  label: string;
  value: number;
}
export interface AnalyticsData {
  /** 集計対象月数（直近 N ヶ月） */
  rangeMonths: number;
  /** 実DB由来か（false=決定論デモ） */
  live: boolean;
  /** KPIサマリ */
  kpi: {
    /** 対象期間の延べ受診数 */
    totalVisits: number;
    /** 対象期間の延べオーダ数 */
    totalOrders: number;
    /** 再診率（0..1） */
    revisitRate: number;
    /** 初診数 */
    firstVisits: number;
    /** 再診数 */
    returnVisits: number;
    /** 対象期間の推計収益（円） */
    totalRevenueYen: number;
    /** 1受診あたり平均点数 */
    avgPointsPerVisit: number;
  };
  /** 疾患別 受診（病名）件数 上位 */
  byDisease: CategoryDatum[];
  /** 医師別 オーダ件数 上位 */
  byDoctor: CategoryDatum[];
  /** 月次 点数推移 */
  pointsTrend: TrendDatum[];
  /** 月次 収益推移（円） */
  revenueTrend: TrendDatum[];
  /** 月次 受診数推移（初診/再診の内訳付き） */
  visitTrend: { label: string; first: number; ret: number }[];
}

// ── ユーティリティ ───────────────────────────────────────────────────────────
function monthKey(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 直近 N ヶ月の月初リスト（古い→新しい）。 */
function lastMonths(n: number, now: Date = new Date()): { key: string; start: Date; end: Date }[] {
  const out: { key: string; start: Date; end: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({ key: monthKey(start), start, end });
  }
  return out;
}

/** Order.detail（Json）から点数を抽出。スキーマ差を吸収し、無ければ種別の概算点で代替。 */
function pointsOfOrder(orderType: string, detail: unknown): number {
  const d = (detail ?? {}) as Record<string, unknown>;
  for (const k of ['points', 'point', 'totalPoints', 'tensu']) {
    const v = d[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  // 明細配列を持つ場合（処方・検査）は明細点数を合算。
  const items = d['items'];
  if (Array.isArray(items)) {
    let sum = 0;
    for (const it of items) {
      const p = (it as Record<string, unknown>)?.['points'];
      if (typeof p === 'number' && Number.isFinite(p)) sum += p;
    }
    if (sum > 0) return sum;
  }
  // データ欠落時は種別概算（あくまで経営概況の目安。算定本体はレセコン）。
  return ORDER_TYPE_APPROX_POINTS[orderType] ?? 30;
}

const ORDER_TYPE_APPROX_POINTS: Record<string, number> = {
  RX: 68,
  INJECTION: 95,
  TREATMENT: 45,
  LAB: 110,
  RADIOLOGY: 210,
  ENDOSCOPY: 1140,
  REHAB: 245,
  GUIDANCE: 80,
  CHEMO: 600,
  SURGERY: 3200,
};

const DIAGNOSIS_INITIAL_POINTS = 291; // 初診料（要件定義書 3.2.1-3 で参照される基準）
const REVISIT_POINTS = 75; // 再診料の概算

/**
 * 経営ダッシュボードの全KPIを集計（fail-soft・null安全）。
 * DB 未接続/空のときは決定論デモ（demoAnalytics）にフォールバックして必ず値を返す。
 */
export async function loadAnalytics(rangeMonths = 6): Promise<AnalyticsData> {
  const months = clampRange(rangeMonths);
  try {
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const buckets = lastMonths(months, now);

    // 受診（Encounter）— 期間内・キャンセル/未受付を除く実受診。
    const encounters = await prisma.encounter.findMany({
      where: {
        createdAt: { gte: since },
        receptionStatus: { notIn: ['UNRECEIVED', 'CANCELLED', 'NO_SHOW'] },
      },
      select: { id: true, visitType: true, createdAt: true },
      take: 20000,
    });

    // 実データが皆無（新規DB・フロントのみ）ならデモへ。
    if (encounters.length === 0) return demoAnalytics(months);

    // オーダ — 最新版のみ・期間内。医師別/点数推移/収益の源泉。
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: since }, isLatest: true },
      select: { orderType: true, ordererUserId: true, detail: true, createdAt: true },
      take: 50000,
    });

    // 病名（PatientDiagnosis）— 期間内・有効。疾患別件数。
    const diagnoses = await prisma.patientDiagnosis.findMany({
      where: { startDate: { gte: since }, status: 'ACTIVE' },
      select: { displayName: true },
      take: 50000,
    });

    // 医師名解決（ordererUserId → StaffUser.name）。失敗しても ID で代替。
    const doctorIds = [...new Set(orders.map((o) => o.ordererUserId).filter(Boolean))];
    let doctorName = new Map<string, string>();
    if (doctorIds.length > 0) {
      const staff = await prisma.staffUser.findMany({
        where: { id: { in: doctorIds } },
        select: { id: true, name: true },
      });
      doctorName = new Map(staff.map((s) => [s.id, s.name]));
    }

    // ── 集計 ──
    const firstVisits = encounters.filter((e) => e.visitType === 'FIRST').length;
    const returnVisits = encounters.filter((e) => e.visitType === 'RETURN').length;
    const totalVisits = encounters.length;
    const revisitRate = totalVisits > 0 ? returnVisits / totalVisits : 0;

    // 月次バケットへ受診を配分（初診/再診内訳）。
    const visitTrend = buckets.map((b) => {
      const inB = encounters.filter((e) => e.createdAt >= b.start && e.createdAt < b.end);
      return {
        label: b.key,
        first: inB.filter((e) => e.visitType === 'FIRST').length,
        ret: inB.filter((e) => e.visitType === 'RETURN').length,
      };
    });

    // 月次 点数・収益（オーダ点数 ＋ 受診の基本診療料概算）。
    const pointsTrend: TrendDatum[] = buckets.map((b) => {
      const ordPts = orders
        .filter((o) => o.createdAt >= b.start && o.createdAt < b.end)
        .reduce((s, o) => s + pointsOfOrder(o.orderType, o.detail), 0);
      const v = visitTrend.find((x) => x.label === b.key);
      const basePts = (v ? v.first : 0) * DIAGNOSIS_INITIAL_POINTS + (v ? v.ret : 0) * REVISIT_POINTS;
      return { label: b.key, value: ordPts + basePts };
    });
    const revenueTrend: TrendDatum[] = pointsTrend.map((p) => ({ label: p.label, value: pointsToYen(p.value) }));

    const totalPoints = pointsTrend.reduce((s, p) => s + p.value, 0);
    const totalRevenueYen = pointsToYen(totalPoints);
    const avgPointsPerVisit = totalVisits > 0 ? Math.round(totalPoints / totalVisits) : 0;

    // 疾患別 上位（病名表記でグルーピング）。
    const byDisease = topCategories(diagnoses.map((d) => d.displayName), 8);

    // 医師別 上位（オーダ起票者）。
    const byDoctor = topCategories(
      orders.map((o) => doctorName.get(o.ordererUserId) ?? `医師 ${o.ordererUserId.slice(0, 6)}`),
      8,
    );

    return {
      rangeMonths: months,
      live: true,
      kpi: {
        totalVisits,
        totalOrders: orders.length,
        revisitRate,
        firstVisits,
        returnVisits,
        totalRevenueYen,
        avgPointsPerVisit,
      },
      byDisease,
      byDoctor,
      pointsTrend,
      revenueTrend,
      visitTrend,
    };
  } catch (err) {
    // DB 未接続でもダッシュボードは描画する（フロントのみモード）。
    console.error('[analytics.loadAnalytics] failed, demo fallback:', err);
    return demoAnalytics(months);
  }
}

function clampRange(n: number): number {
  if (!Number.isFinite(n)) return 6;
  return Math.min(12, Math.max(3, Math.round(n)));
}

/** ラベル配列を件数集計し上位 k 件（残りは「その他」へ畳む）。 */
function topCategories(labels: string[], k: number): CategoryDatum[] {
  const map = new Map<string, number>();
  for (const raw of labels) {
    const label = (raw || '不明').trim() || '不明';
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  if (sorted.length <= k) return sorted;
  const head = sorted.slice(0, k);
  const restCount = sorted.slice(k).reduce((s, c) => s + c.count, 0);
  if (restCount > 0) head.push({ label: 'その他', count: restCount });
  return head;
}

// ── 決定論デモ（DB未接続/空でも経営ダッシュボードを提示）──────────────────────
function demoAnalytics(months: number): AnalyticsData {
  const buckets = lastMonths(months);
  // 月ごとに緩やかな季節変動を持つ受診数（決定論）。
  const visitTrend = buckets.map((b, i) => {
    const seasonal = 1 + 0.18 * Math.sin((i / Math.max(1, months)) * Math.PI * 2);
    const total = Math.round(620 * seasonal);
    const ret = Math.round(total * 0.68); // 再診率 ≒ 68%
    return { label: b.key, first: total - ret, ret };
  });

  const pointsTrend: TrendDatum[] = visitTrend.map((v) => {
    const visits = v.first + v.ret;
    // 1受診あたり ≒ 540点（基本診療料＋投薬/検査の概況）。
    const pts = Math.round(visits * (520 + 40 * Math.sin(v.first)) );
    return { label: v.label, value: pts };
  });
  const revenueTrend: TrendDatum[] = pointsTrend.map((p) => ({ label: p.label, value: pointsToYen(p.value) }));

  const firstVisits = visitTrend.reduce((s, v) => s + v.first, 0);
  const returnVisits = visitTrend.reduce((s, v) => s + v.ret, 0);
  const totalVisits = firstVisits + returnVisits;
  const totalPoints = pointsTrend.reduce((s, p) => s + p.value, 0);

  // 外来診療所で頻度の高い病名（疾患別 上位 — デモ）。
  const byDisease: CategoryDatum[] = [
    { label: '高血圧症', count: 312 },
    { label: '2型糖尿病', count: 241 },
    { label: '脂質異常症', count: 198 },
    { label: '急性上気道炎', count: 176 },
    { label: '胃食道逆流症', count: 121 },
    { label: 'アレルギー性鼻炎', count: 104 },
    { label: '気管支喘息', count: 88 },
    { label: '慢性腎臓病', count: 67 },
    { label: 'その他', count: 410 },
  ];

  const byDoctor: CategoryDatum[] = [
    { label: '内科 田中', count: 842 },
    { label: '内科 佐藤', count: 731 },
    { label: '循環器 鈴木', count: 540 },
    { label: '消化器 高橋', count: 498 },
    { label: '呼吸器 伊藤', count: 356 },
    { label: '小児科 渡辺', count: 287 },
  ];

  return {
    rangeMonths: months,
    live: false,
    kpi: {
      totalVisits,
      totalOrders: Math.round(totalVisits * 2.4),
      revisitRate: totalVisits > 0 ? returnVisits / totalVisits : 0,
      firstVisits,
      returnVisits,
      totalRevenueYen: pointsToYen(totalPoints),
      avgPointsPerVisit: totalVisits > 0 ? Math.round(totalPoints / totalVisits) : 0,
    },
    byDisease,
    byDoctor,
    pointsTrend,
    revenueTrend,
    visitTrend,
  };
}
