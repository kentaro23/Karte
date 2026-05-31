'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import {
  formatOrderNo,
  assertOrderTransition,
  detailKindForOrderType,
  type OrderType,
  type OrderDetail,
  type RxLine,
  type InjectionItem,
  type ExamItem,
} from '@medixus/domain';
import { requireSession } from '@/lib/session';

/** Generic order creation for non-Rx types (Rx uses the safety-checked chart flow). */
export async function createOrder(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const orderType = String(formData.get('orderType')) as OrderType;
  const itemName = String(formData.get('itemName') || '').trim();
  const qty = Number(formData.get('qty') || 1);
  const note = String(formData.get('note') || '');
  const urgent = formData.get('urgent') === 'on';
  if (!patientId || !orderType || !itemName) return { error: '必須項目が未入力です' };

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) return { error: '患者が見つかりません' };
  const dept = await prisma.department.findFirst({ where: { clinicId: patient.clinicId } });

  // an encounter to attach to (reuse latest open, else create outpatient)
  let enc = await prisma.encounter.findFirst({
    where: { patientId, receptionStatus: { notIn: ['BILLING_DONE', 'CANCELLED', 'NO_SHOW'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!enc) {
    enc = await prisma.encounter.create({
      data: {
        patientId,
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

  const order = await prisma.order.create({
    data: {
      orderNo: formatOrderNo(new Date(), seq),
      patientId,
      encounterId: enc.id,
      orderType,
      departmentId: enc.departmentId,
      ordererUserId: s.userId,
      status: 'DRAFT',
      isUrgent: urgent,
      detail: { itemName, qty, note } as object,
    },
  });
  // DRAFT → REQUESTED (state machine guarded)
  assertOrderTransition('DRAFT', 'REQUESTED');
  await prisma.order.update({ where: { id: order.id }, data: { status: 'REQUESTED' } });
  await writeAudit({
    actorUserId: s.userId,
    patientId,
    action: 'ORDER_ISSUE',
    resource: `Order:${orderType}`,
    resourceId: order.id,
    detail: { itemName, qty },
  });
  revalidatePath('/orders');
  return { ok: true };
}

export async function receiveOrder(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const o = await prisma.order.findUniqueOrThrow({ where: { id } });
  assertOrderTransition(o.status as never, 'RECEIVED');
  await prisma.order.update({ where: { id }, data: { status: 'RECEIVED' } });
  await prisma.orderReception.create({ data: { orderId: id, receivedByUserId: s.userId } });
  await writeAudit({ actorUserId: s.userId, action: 'ORDER_ISSUE', resource: 'Order.receive', resourceId: id });
  revalidatePath('/orders');
}

// ──────────────────────────────────────────────────────────────────────────
// FR-ORD-02 マスタ実検索 → 候補 → 行内編集（order-detail 型）
//   キーワード→候補→行内編集（数量/単位/用法/院内外/日数）、検査は点数表示。
//   状態機械・版管理は createDetailedOrder（DRAFT→REQUESTED）で維持。
// ──────────────────────────────────────────────────────────────────────────

/** マスタ候補（種別共通の最小形）。kind=detailKind に応じ薬剤/検査を返す。 */
export interface OrderMasterCandidate {
  /** マスタ行ID（DrugProduct.id / ExamMaster.id）。フリー入力時は undefined。 */
  masterId?: string;
  code?: string;
  name?: string;
  /** 表示用サブ情報（一般名・剤形・検査カテゴリ等）。 */
  sub?: string;
  /** 既定単位（薬剤の strengthUnit / 検査は未設定）。 */
  unit?: string;
  /** 既定投与経路（薬剤の administrationRoute）。 */
  route?: string;
  /** 点数（検査のみ。診療報酬点数の概算表示用）。 */
  points?: number;
}

/**
 * 検査の概算点数（display-only）。ExamMaster は点数列を持たないため、
 * カテゴリ別の代表点数を表示用に充てる（査定・算定はレセコン委譲＝正本ではない）。
 * AC「検査候補に点数が表示される」を満たす最小実装。
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
function examPoints(category?: string | null): number {
  if (!category) return 11;
  for (const [key, points] of Object.entries(EXAM_CATEGORY_POINTS)) {
    if (category.includes(key)) return points;
  }
  return 11;
}

/**
 * オーダ種別 × キーワードでマスタ実検索（fail-soft）。
 * RX/INJECTION → DrugProduct、EXAM(検体/細菌/病理/生理) → ExamMaster。
 * PROCEDURE/IMAGE はマスタ無＝フリー入力（空配列）。DB 未接続でも [] を返す。
 */
export async function searchOrderMaster(
  orderType: OrderType,
  q: string,
): Promise<OrderMasterCandidate[]> {
  const term = (q ?? '').trim();
  const kind = detailKindForOrderType(orderType);
  if (!kind) return [];
  try {
    if (kind === 'RX' || kind === 'INJECTION') {
      const route = kind === 'INJECTION' ? '注射' : undefined;
      const drugs = await prisma.drugProduct.findMany({
        where: {
          ...(route ? { administrationRoute: route } : {}),
          ...(term
            ? {
                OR: [
                  { brandName: { contains: term, mode: 'insensitive' } },
                  { brandNameKana: { contains: term, mode: 'insensitive' } },
                  { genericName: { contains: term, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { brandName: 'asc' },
        take: 50,
        select: {
          id: true,
          receiptCode: true,
          brandName: true,
          genericName: true,
          strengthUnit: true,
          dosageForm: true,
          administrationRoute: true,
        },
      });
      return drugs.map((d) => ({
        masterId: d.id,
        code: d.receiptCode,
        name: d.brandName,
        sub: [d.genericName, d.dosageForm].filter(Boolean).join(' / ') || undefined,
        unit: d.strengthUnit ?? undefined,
        route: d.administrationRoute,
      }));
    }
    if (kind === 'EXAM') {
      const exams = await prisma.examMaster.findMany({
        where: term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { code: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {},
        orderBy: { name: 'asc' },
        take: 50,
        select: { id: true, code: true, name: true, category: true, specimenType: true },
      });
      return exams.map((e) => ({
        masterId: e.id,
        code: e.code,
        name: e.name,
        sub: [e.category, e.specimenType].filter(Boolean).join(' / ') || undefined,
        points: examPoints(e.category),
      }));
    }
    // PROCEDURE / IMAGE: マスタテーブル無し→フリー入力（候補なし）
    return [];
  } catch {
    // DB 未接続でも画面を出す（fail-soft）。
    return [];
  }
}

/** createDetailedOrder の行入力（クライアント編集後の確定値）。 */
export interface OrderLineInput {
  masterId?: string;
  code?: string;
  name: string;
  /** 数量 / 1回量。 */
  qty?: number;
  unit?: string;
  /** 用法（内服 用法 / 注射  route / 処置 部位 等の自由テキスト）。 */
  usage?: string;
  days?: number;
  amountPerDay?: number;
  points?: number;
  site?: string;
  modality?: string;
  bodyPart?: string;
}

export interface DetailedOrderInput {
  patientId: string;
  orderType: OrderType;
  lines: OrderLineInput[];
  /** RX のみ: 院内/院外。 */
  dispenseType?: 'IN_HOUSE' | 'OUTSIDE';
  specimen?: string;
  urgent?: boolean;
}

/** OrderLineInput[] を order-detail 判別共用体へ整形（種別ごとのスキーマ確定）。 */
function buildOrderDetail(input: DetailedOrderInput): OrderDetail | null {
  const kind = detailKindForOrderType(input.orderType);
  if (!kind) return null;
  const lines = input.lines.filter((l) => l.name.trim());
  switch (kind) {
    case 'RX':
      return {
        kind: 'RX',
        dispenseType: input.dispenseType ?? 'IN_HOUSE',
        rp: lines.map(
          (l): RxLine => ({
            drugCode: l.code,
            drugName: l.name,
            dose: l.qty,
            doseUnit: l.unit,
            usageText: l.usage,
            days: l.days,
            amountPerDay: l.amountPerDay,
          }),
        ),
      };
    case 'INJECTION':
      return {
        kind: 'INJECTION',
        items: lines.map(
          (l): InjectionItem => ({
            drugCode: l.code,
            drugName: l.name,
            dose: l.qty,
            doseUnit: l.unit,
          }),
        ),
      };
    case 'EXAM':
      return {
        kind: 'EXAM',
        specimen: input.specimen,
        items: lines.map(
          (l): ExamItem => ({
            examMasterId: l.masterId,
            examName: l.name,
            points: l.points,
          }),
        ),
      };
    case 'PROCEDURE':
      return {
        kind: 'PROCEDURE',
        procedureCode: lines[0]?.code,
        procedureName: lines[0]?.name ?? '',
        points: lines[0]?.points,
        site: lines[0]?.site ?? lines[0]?.usage,
      };
    case 'IMAGE':
      return {
        kind: 'IMAGE',
        modality: lines[0]?.modality,
        bodyPart: lines[0]?.bodyPart ?? lines[0]?.name,
        points: lines[0]?.points,
      };
  }
}

/**
 * order-detail 型オーダの作成（FR-ORD-01/02）。
 * 行内編集済みの明細を order-detail 判別共用体へ整形→保存→状態機械で DRAFT→REQUESTED。
 * 版管理（version=1/isLatest=true）維持。全工程 fail-soft（{error} 返却）。
 */
export async function createDetailedOrder(input: DetailedOrderInput) {
  try {
    const s = await requireSession();
    if (!input.patientId) return { error: '患者が未選択です' };
    const detail = buildOrderDetail(input);
    if (!detail) {
      return { error: 'この種別は明細オーダに対応していません' };
    }
    let lineCount = 0;
    if (detail.kind === 'RX') lineCount = detail.rp.length;
    else if (detail.kind === 'INJECTION' || detail.kind === 'EXAM')
      lineCount = detail.items.length;
    else if (detail.kind === 'PROCEDURE') lineCount = detail.procedureName.trim() ? 1 : 0;
    else if (detail.kind === 'IMAGE') lineCount = detail.bodyPart?.trim() ? 1 : 0;
    if (lineCount === 0) return { error: 'オーダ明細が空です' };

    const patient = await prisma.patient.findUnique({ where: { id: input.patientId } });
    if (!patient) return { error: '患者が見つかりません' };
    const dept = await prisma.department.findFirst({ where: { clinicId: patient.clinicId } });

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

    const order = await prisma.order.create({
      data: {
        orderNo: formatOrderNo(new Date(), seq),
        patientId: input.patientId,
        encounterId: enc.id,
        orderType: input.orderType,
        classification:
          detail.kind === 'RX'
            ? detail.dispenseType === 'OUTSIDE'
              ? 'OUTPATIENT_OUT'
              : 'OUTPATIENT_IN_HOUSE'
            : null,
        departmentId: enc.departmentId,
        ordererUserId: s.userId,
        status: 'DRAFT',
        isUrgent: input.urgent ?? false,
        version: 1,
        isLatest: true,
        detail: detail as object,
      },
    });
    // DRAFT → REQUESTED（状態機械ガード；不正遷移は throw）
    assertOrderTransition('DRAFT', 'REQUESTED');
    await prisma.order.update({ where: { id: order.id }, data: { status: 'REQUESTED' } });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'ORDER_ISSUE',
      resource: `Order:${input.orderType}`,
      resourceId: order.id,
      detail: { kind: detail.kind, lines: lineCount },
    });
    revalidatePath('/orders');
    return { ok: true, orderNo: order.orderNo };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'オーダ作成に失敗しました' };
  }
}
