'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import {
  formatOrderNo,
  assertOrderTransition,
  judgeLabFlag,
  type OrderStatus,
  type ExamItem,
} from '@medixus/domain';
import { sendLabOrder, fetchLabResults } from '@medixus/interop';
import { requireSession } from '@/lib/session';

/* ──────────────────────────────────────────────────────────────────────────
   FR-EXM-01 検体検査オーダ・結果連携・承認（増築）— orders/exam 単独画面。
   フロー: 検体検査オーダ(ExamMaster/JLAC) → interop lab-link(sendLabOrder)で外注送信
          → 結果取込で OrderStatus.RESULT_ARRIVED → 医師承認で APPROVED。
   状態機械（order.ts）の正規遷移のみを使用:
     DRAFT→REQUESTED→RECEIVED→IN_PROGRESS→DONE→RESULT_ARRIVED→APPROVED
   外部連携は @medixus/interop の lab-link スタブ（status:'STUB'）経由（要件 6章共通方針）。
   全工程 fail-soft / null 安全。DB 未接続でも画面が出る（{error} 返却）。
   ────────────────────────────────────────────────────────────────────────── */

/** 検体検査の検査項目候補（ExamMaster の最小形 + JLAC10）。 */
export interface ExamCandidate {
  /** ExamMaster.id（フリー入力時は undefined）。 */
  examMasterId?: string;
  code: string;
  name: string;
  /** JLAC10/11 コード（外注連携キー / 6情報 検査）。 */
  jlac10?: string;
  category?: string;
  specimenType?: string;
  refLow?: number;
  refHigh?: number;
  unit?: string;
  /** 概算点数（display-only / 算定はレセコン委譲＝正本ではない）。 */
  points?: number;
}

/** 検体検査オーダの1行（画面の確定値）。 */
export interface ExamOrderLineInput {
  examMasterId?: string;
  code?: string;
  name: string;
  jlac10?: string;
  specimenType?: string;
  points?: number;
}

export interface ExamOrderInput {
  patientId: string;
  lines: ExamOrderLineInput[];
  /** 検体（血清/全血/尿 等）。 */
  specimen?: string;
  /** 外注先検査会社コード（約170社／IF-EXT-04）。 */
  laboratoryCode?: string;
  urgent?: boolean;
}

export interface ExamOrderResult {
  ok: boolean;
  error?: string;
  orderId?: string | null;
  orderNo?: string | null;
  /** 外注送信の連携結果ステータス（STUB 固定だが導線確認用）。 */
  sendStatus?: string;
  note?: string;
}

/**
 * ExamMaster.points を正本とした点数解決（display-only / 算定はレセコン委譲）。
 * 段階移行: マスタ拡張カラム ExamMaster.points を最優先し、未投入(null)の旧データは
 * 従来のカテゴリ概算へフォールバックする（マスタ整備が進めば概算は使われなくなる）。
 * WIRE-EXM1: ハードコード概算からの本永続化（ExamMaster.points 直読）への昇格。
 */
const EXAM_CATEGORY_POINTS: Record<string, number> = {
  生化学: 11,
  血液学: 21,
  血算: 21,
  免疫: 35,
  感染症: 35,
  内分泌: 95,
  腫瘍マーカー: 100,
  細菌: 60,
  病理: 150,
  生理: 130,
  尿: 26,
  一般: 26,
};
/** 旧データ用のカテゴリ概算（ExamMaster.points が null のときだけ使う後方互換フォールバック）。 */
function examPointsFromCategory(category?: string | null): number {
  if (!category) return 11;
  for (const [key, points] of Object.entries(EXAM_CATEGORY_POINTS)) {
    if (category.includes(key)) return points;
  }
  return 11;
}
/**
 * 点数解決（段階移行）: ExamMaster.points を優先し、null なら従来のカテゴリ概算へ。
 * @param points ExamMaster.points（保険点数概算カラム / 正本ではない）
 * @param category points が無い旧データのフォールバック判定に使用
 */
function resolveExamPoints(points: number | null | undefined, category?: string | null): number {
  return points ?? examPointsFromCategory(category);
}

/**
 * 検体検査マスタ候補（fail-soft）。ExamMaster をキーワード検索して JLAC10 付きで返す。
 * DB 未接続でも空配列を返す（画面側はサンプルにフォールバック）。
 */
export async function searchExamMaster(q: string): Promise<ExamCandidate[]> {
  const term = (q ?? '').trim();
  try {
    const exams = await prisma.examMaster.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { code: { contains: term, mode: 'insensitive' } },
              { jlac10: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: { name: 'asc' },
      take: 50,
      select: {
        id: true,
        code: true,
        name: true,
        jlac10: true,
        category: true,
        specimenType: true,
        refLow: true,
        refHigh: true,
        unit: true,
        points: true,
      },
    });
    return exams.map((e) => ({
      examMasterId: e.id,
      code: e.code,
      name: e.name,
      jlac10: e.jlac10 ?? undefined,
      category: e.category,
      specimenType: e.specimenType ?? undefined,
      refLow: e.refLow ?? undefined,
      refHigh: e.refHigh ?? undefined,
      unit: e.unit ?? undefined,
      // 段階移行: ExamMaster.points を正本に、未投入(null)はカテゴリ概算へフォールバック。
      points: resolveExamPoints(e.points, e.category),
    }));
  } catch (err) {
    console.error('[orders/exam] searchExamMaster failed (fail-soft):', err);
    return [];
  }
}

/**
 * 検体検査オーダの発行 + 外注送信（FR-EXM-01 AC1）。
 * 1) Order(LAB) を EXAM detail（ExamItem[] / JLAC）で作成し DRAFT→REQUESTED。
 * 2) interop lab-link.sendLabOrder で外注へ送信（STUB / 抽象IF経由）。
 * 全工程 fail-soft。DB 未接続でもデモとして発行できた前提で返す。
 */
export async function createExamOrder(input: ExamOrderInput): Promise<ExamOrderResult> {
  const lines = (input.lines ?? []).filter((l) => l.name && l.name.trim());
  if (!input.patientId) return { ok: false, error: '患者を選択してください' };
  if (lines.length === 0) return { ok: false, error: '検査項目が1件もありません' };

  try {
    const s = await requireSession();
    const patient = await prisma.patient.findUnique({ where: { id: input.patientId } });
    if (!patient) {
      return {
        ok: true,
        orderId: null,
        orderNo: null,
        sendStatus: 'STUB',
        note: '患者が見つかりません（デモ表示）。',
      };
    }
    const dept = await prisma.department.findFirst({ where: { clinicId: patient.clinicId } });

    // 紐付ける受診（開いているものを再利用、無ければ外来を作成）。
    let enc = await prisma.encounter.findFirst({
      where: {
        patientId: input.patientId,
        receptionStatus: { notIn: ['BILLING_DONE', 'CANCELLED', 'NO_SHOW'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!enc) {
      enc = await prisma.encounter.create({
        data: {
          patientId: input.patientId,
          encounterType: 'OUTPATIENT',
          visitType: 'RETURN',
          contactType: 'FACE',
          departmentId: dept?.id ?? 'unknown',
          receptionStatus: 'IN_CONSULTATION',
          arrivedAt: new Date(),
        },
      });
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const seq = (await prisma.order.count({ where: { createdAt: { gte: dayStart } } })) + 1;
    const orderNo = formatOrderNo(new Date(), seq);

    // 点数は ExamMaster.points を正とする（段階移行）。examMasterId 付きの行は
    // クライアント入力値に依らずマスタの拡張カラムから再解決し、null は概算へフォールバック。
    // fail-soft: 取得失敗時はクライアント値→概算の順で温存（算定はレセコン委譲＝display-only）。
    const masterIds = Array.from(
      new Set(lines.map((l) => l.examMasterId).filter((id): id is string => !!id)),
    );
    const masterById = new Map<string, { category: string; points: number | null }>();
    if (masterIds.length > 0) {
      try {
        const masters = await prisma.examMaster.findMany({
          where: { id: { in: masterIds } },
          select: { id: true, category: true, points: true },
        });
        for (const m of masters) masterById.set(m.id, { category: m.category, points: m.points });
      } catch (err) {
        console.error('[createExamOrder] examMaster.findMany failed (fail-soft):', err);
      }
    }
    /** 行の点数を ExamMaster.points 正本で解決（マスタ未取得時はクライアント値→概算）。 */
    const pointsForLine = (l: ExamOrderLineInput): number => {
      const m = l.examMasterId ? masterById.get(l.examMasterId) : undefined;
      if (m) return resolveExamPoints(m.points, m.category);
      return l.points ?? examPointsFromCategory(undefined);
    };

    // EXAM 判別共用体（order-detail）— JLAC を items に保持。points は ExamMaster.points 正本。
    const items: ExamItem[] = lines.map((l) => ({
      examMasterId: l.examMasterId,
      examName: l.name,
      points: pointsForLine(l),
    }));

    const order = await prisma.order.create({
      data: {
        orderNo,
        patientId: input.patientId,
        encounterId: enc.id,
        orderType: 'LAB',
        departmentId: enc.departmentId,
        ordererUserId: s.userId,
        status: 'DRAFT',
        isUrgent: input.urgent ?? false,
        version: 1,
        isLatest: true,
        detail: {
          kind: 'EXAM',
          specimen: input.specimen,
          laboratoryCode: input.laboratoryCode,
          // JLAC は外注連携キーとして detail にも保持（ExamItem は points のみのため）。
          jlac10: lines.map((l) => l.jlac10).filter(Boolean),
          items,
        } as object,
      },
    });
    // DRAFT → REQUESTED（状態機械ガード；不正遷移は throw）。
    assertOrderTransition('DRAFT', 'REQUESTED');
    await prisma.order.update({ where: { id: order.id }, data: { status: 'REQUESTED' } });

    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'ORDER_ISSUE',
      resource: 'Order:LAB',
      resourceId: order.id,
      detail: { kind: 'EXAM', lines: lines.length, jlac: lines.map((l) => l.jlac10) },
    });

    // ── 外注送信（IF-EXT-04 / lab-link スタブ。呼ぶだけ・fail-soft）──
    let sendStatus = 'STUB';
    try {
      const res = await sendLabOrder({
        patientRef: patient.id,
        orderNo,
        orderedDate: new Date().toISOString(),
        laboratoryCode: input.laboratoryCode,
        items: lines.map((l) => ({
          jlac10: l.jlac10 ?? '',
          testName: l.name,
          specimenType: l.specimenType ?? input.specimen,
        })),
      });
      sendStatus = res.status;
      await writeAudit({
        actorUserId: s.userId,
        patientId: input.patientId,
        action: 'ORDER_ISSUE',
        resource: 'LabLink.send',
        resourceId: order.id,
        result: res.status,
        detail: { orderNo, laboratoryCode: input.laboratoryCode ?? null },
      });
    } catch (err) {
      console.error('[createExamOrder] sendLabOrder failed (fail-soft):', err);
    }

    revalidatePath('/orders/exam');
    revalidatePath('/orders');
    return { ok: true, orderId: order.id, orderNo, sendStatus };
  } catch (err) {
    console.error('[createExamOrder] failed (fail-soft, demo mode?):', err);
    return {
      ok: true,
      orderId: null,
      orderNo: null,
      sendStatus: 'STUB',
      note: 'バックエンド未接続のため、発行と外注送信はデモ表示です。',
    };
  }
}

/** form action ラッパ（page.tsx の <form action=…> 用。FormData→createExamOrder）。 */
export async function createExamOrderForm(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') || '');
  const examMasterId = String(formData.get('examMasterId') || '') || undefined;
  const code = String(formData.get('code') || '') || undefined;
  const name = String(formData.get('name') || '').trim();
  const jlac10 = String(formData.get('jlac10') || '') || undefined;
  const specimen = String(formData.get('specimen') || '') || undefined;
  const specimenType = String(formData.get('specimenType') || '') || undefined;
  const laboratoryCode = String(formData.get('laboratoryCode') || '') || undefined;
  const pointsRaw = Number(formData.get('points'));
  const urgent = formData.get('urgent') === 'on';
  if (!patientId || !name) return;
  await createExamOrder({
    patientId,
    specimen,
    laboratoryCode,
    urgent,
    lines: [
      {
        examMasterId,
        code,
        name,
        jlac10,
        specimenType,
        points: Number.isFinite(pointsRaw) ? pointsRaw : undefined,
      },
    ],
  });
}

/**
 * 結果取込 → RESULT_ARRIVED（FR-EXM-01 AC2 前半）。
 * 1) interop lab-link.fetchLabResults で結果を取得（STUB / 抽象IF経由）。
 * 2) STUB（data 無）の場合はオーダ明細 + ExamMaster 基準値からデモ結果を生成。
 * 3) LabResult 行を作成し、状態機械を REQUESTED→…→DONE→RESULT_ARRIVED と正規遷移。
 * 全工程 fail-soft。
 */
export async function importLabResults(formData: FormData): Promise<void> {
  const orderId = String(formData.get('orderId') || '');
  if (!orderId) return;
  try {
    const s = await requireSession();
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;

    // ── 外注からの結果取込（呼ぶだけ・fail-soft）──
    let fetchStatus = 'STUB';
    try {
      const res = await fetchLabResults(order.orderNo);
      fetchStatus = res.status;
    } catch (err) {
      console.error('[importLabResults] fetchLabResults failed (fail-soft):', err);
    }

    // detail.items（ExamItem[]）から結果テンプレを起こす。
    const detail = (order.detail ?? {}) as {
      items?: { examMasterId?: string; examName?: string }[];
      specimen?: string;
    };
    const items = detail.items ?? [];

    // 各項目について ExamMaster の基準値を引き（fail-soft）、デモ実測値を生成して flag 判定。
    for (const it of items) {
      let refLow: number | null = null;
      let refHigh: number | null = null;
      let unit: string | null = null;
      if (it.examMasterId) {
        try {
          const m = await prisma.examMaster.findUnique({ where: { id: it.examMasterId } });
          refLow = m?.refLow ?? null;
          refHigh = m?.refHigh ?? null;
          unit = m?.unit ?? null;
        } catch {
          /* fail-soft */
        }
      }
      // デモ実測値: 基準範囲の中央付近（基準が無ければ既定値）。本番は外注結果で置換。
      const value = demoMeasuredValue(refLow, refHigh);
      const flag = judgeLabFlag(value, refLow, refHigh) ?? 'N';
      try {
        await prisma.labResult.create({
          data: {
            patientId: order.patientId,
            encounterId: order.encounterId,
            examMasterId: it.examMasterId ?? null,
            orderId: order.id,
            value,
            unit,
            refLow,
            refHigh,
            flag,
            collectedAt: new Date(),
            resultedAt: new Date(),
            status: 'FINAL',
          },
        });
      } catch (err) {
        console.error('[importLabResults] labResult.create failed (fail-soft):', err);
      }
    }

    // ── 状態機械: REQUESTED→RECEIVED→IN_PROGRESS→DONE→RESULT_ARRIVED（正規遷移のみ）──
    await advanceOrderTo(order.id, order.status as OrderStatus, 'RESULT_ARRIVED');

    await writeAudit({
      actorUserId: s.userId,
      patientId: order.patientId,
      action: 'ORDER_ISSUE',
      resource: 'Order.resultArrived',
      resourceId: order.id,
      result: fetchStatus,
      detail: { items: items.length },
    });

    revalidatePath('/orders/exam');
    revalidatePath('/orders');
  } catch (err) {
    console.error('[importLabResults] failed (fail-soft):', err);
  }
}

/**
 * 医師承認 → APPROVED（FR-EXM-01 AC2 後半）。
 * RESULT_ARRIVED → APPROVED（状態機械ガード）。OrderExecution に承認者・承認日時を記録。
 */
export async function approveLabResults(formData: FormData): Promise<void> {
  const orderId = String(formData.get('orderId') || '');
  if (!orderId) return;
  try {
    const s = await requireSession();
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    // RESULT_ARRIVED 以外からの承認は弾く（状態機械が throw）。
    assertOrderTransition(order.status as OrderStatus, 'APPROVED');
    await prisma.order.update({ where: { id: orderId }, data: { status: 'APPROVED' } });
    try {
      await prisma.orderExecution.create({
        data: {
          orderId,
          executedByUserId: s.userId,
          approvedByUserId: s.userId,
          approvedAt: new Date(),
          result: { approved: true } as object,
        },
      });
    } catch (err) {
      console.error('[approveLabResults] orderExecution.create failed (fail-soft):', err);
    }
    await writeAudit({
      actorUserId: s.userId,
      patientId: order.patientId,
      action: 'ORDER_ISSUE',
      resource: 'Order.approve',
      resourceId: orderId,
    });
    revalidatePath('/orders/exam');
    revalidatePath('/orders');
  } catch (err) {
    console.error('[approveLabResults] failed (fail-soft):', err);
  }
}

/**
 * 状態機械の正規遷移のみで from→target まで段階的に進める。
 * 各 hop は assertOrderTransition でガードし、不正経路なら停止（fail-soft）。
 */
async function advanceOrderTo(
  orderId: string,
  from: OrderStatus,
  target: OrderStatus,
): Promise<void> {
  // RESULT_ARRIVED への正規経路（order.ts の ORDER_TRANSITIONS と一致）。
  const PATH_TO_RESULT: OrderStatus[] = [
    'REQUESTED',
    'RECEIVED',
    'IN_PROGRESS',
    'DONE',
    'RESULT_ARRIVED',
  ];
  if (target !== 'RESULT_ARRIVED') return;
  let cur = from;
  const startIdx = PATH_TO_RESULT.indexOf(cur);
  if (startIdx < 0) return; // 既に DONE 以降など → 何もしない
  for (let i = startIdx + 1; i < PATH_TO_RESULT.length; i++) {
    const next = PATH_TO_RESULT[i];
    if (!next) break;
    try {
      assertOrderTransition(cur, next);
      await prisma.order.update({ where: { id: orderId }, data: { status: next } });
      cur = next;
    } catch (err) {
      console.error(`[advanceOrderTo] transition ${cur}→${next} failed (fail-soft):`, err);
      break;
    }
  }
}

/** デモ実測値（基準範囲の中央付近）。本番は外注結果で置換される display 用。 */
function demoMeasuredValue(refLow: number | null, refHigh: number | null): number {
  if (refLow !== null && refHigh !== null) {
    return Math.round(((refLow + refHigh) / 2) * 10) / 10;
  }
  if (refHigh !== null) return Math.round(refHigh * 0.8 * 10) / 10;
  if (refLow !== null) return Math.round(refLow * 1.2 * 10) / 10;
  return 0;
}
