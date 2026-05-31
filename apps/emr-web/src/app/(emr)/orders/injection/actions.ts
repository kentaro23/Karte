'use server';
/**
 * FR-INJ-01 注射オーダ・三点認証 — 別紙1 §5.4 / 174項 65-101 / G17.
 *
 *  - 輸液製剤マスタ実検索（administrationRoute='注射' の DrugProduct）。
 *  - 実施時に「患者 / 薬剤 / 実施者」3点のバーコードを照合し、結果を
 *    OrderExecution.threePointAuth(Json) に記録。
 *  - いずれか不一致なら実施をブロック（状態は進めず、失敗照合のみ記録）。
 *
 * すべて fail-soft（DB 未接続でも {error}/[] を返し画面を壊さない）。
 * 状態機械（order.ts）と監査（audit）は本番基準で維持。
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import {
  assertOrderTransition,
  type OrderStatus,
  type InjectionItem,
} from '@medixus/domain';
import { requireSession } from '@/lib/session';

// ──────────────────────────────────────────────────────────────────────────
// 輸液製剤マスタ実検索（注射経路の DrugProduct）
// ──────────────────────────────────────────────────────────────────────────

export interface InjectionMasterCandidate {
  masterId: string;
  /** レセ電コード（既定の薬剤照合キー）。 */
  code: string;
  name: string;
  sub?: string;
  unit?: string;
  /** バーコード照合に使える各種コード（GS1/HOT/YJ/レセ電）。 */
  barcodes: string[];
}

/**
 * 輸液製剤（注射薬）をキーワードで実検索。空キーワードでも代表候補を返す。
 * administrationRoute='注射' に限定。DB 未接続時は [] （fail-soft）。
 */
export async function searchInjectionMaster(q: string): Promise<InjectionMasterCandidate[]> {
  const term = (q ?? '').trim();
  try {
    const drugs = await prisma.drugProduct.findMany({
      where: {
        administrationRoute: '注射',
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
        gs1Code: true,
        hotCode: true,
        yjCode: true,
        brandName: true,
        genericName: true,
        strengthUnit: true,
        dosageForm: true,
      },
    });
    return drugs.map((d) => ({
      masterId: d.id,
      code: d.receiptCode,
      name: d.brandName,
      sub: [d.genericName, d.dosageForm].filter(Boolean).join(' / ') || undefined,
      unit: d.strengthUnit ?? undefined,
      barcodes: [d.gs1Code, d.hotCode, d.yjCode, d.receiptCode].filter(
        (c): c is string => !!c,
      ),
    }));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 注射オーダ作成（輸液製剤マスタ → INJECTION detail）
// ──────────────────────────────────────────────────────────────────────────

export interface InjectionOrderLine {
  masterId?: string;
  code?: string;
  name: string;
  dose?: number;
  doseUnit?: string;
}

export interface CreateInjectionInput {
  patientId: string;
  route: string; // IV | DIV | IM | SC ...
  lines: InjectionOrderLine[];
  urgent?: boolean;
}

/**
 * 注射オーダの発行（FR-INJ-01）。INJECTION detail を保存し DRAFT→REQUESTED。
 * 実施は executeInjectionWithAuth（三点認証）で行う。
 */
export async function createInjectionOrder(input: CreateInjectionInput) {
  try {
    const s = await requireSession();
    if (!input.patientId) return { error: '患者が未選択です' };
    const lines = input.lines.filter((l) => l.name.trim());
    if (lines.length === 0) return { error: '注射明細を1件以上追加してください' };

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
    const orderNo = `O${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

    const detail = {
      kind: 'INJECTION' as const,
      route: input.route,
      items: lines.map(
        (l): InjectionItem => ({
          drugCode: l.code,
          drugName: l.name,
          dose: l.dose,
          doseUnit: l.doseUnit,
        }),
      ),
    };

    const order = await prisma.order.create({
      data: {
        orderNo,
        patientId: input.patientId,
        encounterId: enc.id,
        orderType: 'INJECTION',
        departmentId: enc.departmentId,
        ordererUserId: s.userId,
        status: 'DRAFT',
        isUrgent: input.urgent ?? false,
        version: 1,
        isLatest: true,
        detail: detail as object,
      },
    });
    assertOrderTransition('DRAFT', 'REQUESTED');
    await prisma.order.update({ where: { id: order.id }, data: { status: 'REQUESTED' } });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'ORDER_ISSUE',
      resource: 'Order:INJECTION',
      resourceId: order.id,
      detail: { route: input.route, lines: lines.length },
    });
    revalidatePath('/orders/injection');
    revalidatePath('/orders');
    return { ok: true, orderNo };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '注射オーダの発行に失敗しました' };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// コンソール初期データ（患者候補 + 実施待ち注射オーダ）— fail-soft
// ──────────────────────────────────────────────────────────────────────────

export interface InjectionOrderRow {
  id: string;
  orderNo: string;
  status: string;
  isUrgent: boolean;
  createdAt: string;
  patientId: string;
  patientNo: string;
  patientName: string;
  route?: string;
  items: { drugName: string; drugCode?: string; dose?: number; doseUnit?: string }[];
  /** 直近の実施照合（あれば）。 */
  lastAuthVerified?: boolean;
}

export interface InjectionConsoleData {
  patients: { id: string; label: string; patientNo: string }[];
  orders: InjectionOrderRow[];
}

/** 画面初期データ。DB 未接続でも空配列で描画できる（fail-soft）。 */
export async function loadInjectionConsole(): Promise<InjectionConsoleData> {
  try {
    const [patients, orders] = await Promise.all([
      prisma.patient.findMany({
        orderBy: { createdAt: 'asc' },
        take: 60,
        select: { id: true, patientNo: true, kanjiLastName: true, kanjiFirstName: true },
      }),
      prisma.order.findMany({
        where: { orderType: 'INJECTION', isLatest: true },
        orderBy: { createdAt: 'desc' },
        take: 60,
        include: {
          patient: { select: { id: true, patientNo: true, kanjiLastName: true, kanjiFirstName: true } },
          executions: {
            orderBy: { executedAt: 'desc' },
            take: 1,
            select: { threePointAuth: true },
          },
        },
      }),
    ]);
    return {
      patients: patients.map((p) => ({
        id: p.id,
        patientNo: p.patientNo,
        label: `${p.patientNo} ${p.kanjiLastName} ${p.kanjiFirstName}`,
      })),
      orders: orders.map((o) => {
        const d = o.detail as { route?: string; items?: InjectionItem[] } | null;
        const auth = o.executions[0]?.threePointAuth as { verified?: boolean } | null;
        return {
          id: o.id,
          orderNo: o.orderNo,
          status: o.status,
          isUrgent: o.isUrgent,
          createdAt: o.createdAt.toISOString(),
          patientId: o.patient.id,
          patientNo: o.patient.patientNo,
          patientName: `${o.patient.kanjiLastName} ${o.patient.kanjiFirstName}`,
          route: d?.route,
          items: (d?.items ?? []).map((it) => ({
            drugName: it.drugName,
            drugCode: it.drugCode,
            dose: it.dose,
            doseUnit: it.doseUnit,
          })),
          lastAuthVerified: auth?.verified,
        };
      }),
    };
  } catch {
    return { patients: [], orders: [] };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 三点認証（患者 / 薬剤 / 実施者）→ 実施 or ブロック
// ──────────────────────────────────────────────────────────────────────────

/** 1点ごとの照合結果（threePointAuth に記録する形）。 */
export interface AuthPoint {
  /** 照合点の種別。 */
  point: 'PATIENT' | 'DRUG' | 'EXECUTOR';
  /** スキャンされたバーコード値。 */
  scanned: string;
  /** 一致したか。 */
  matched: boolean;
  /** 期待値（突合相手）。表示・監査用。 */
  expected?: string;
  /** 任意の補足（薬剤名・氏名等）。 */
  label?: string;
}

export interface ThreePointAuthRecord {
  verified: boolean;
  scannedAt: string;
  executorUserId: string;
  points: AuthPoint[];
}

export interface ExecuteInjectionInput {
  orderId: string;
  /** 患者バーコード（患者番号 patientNo を符号化したもの）。 */
  patientBarcode: string;
  /** 薬剤バーコード（GS1/HOT/YJ/レセ電いずれか）。 */
  drugBarcode: string;
  /** 実施者バーコード（職員番号 staffNo もしくは loginId）。 */
  executorBarcode: string;
}

/** 前後空白・全角空白を除去した照合用正規化。 */
function norm(v: string | null | undefined): string {
  return (v ?? '').replace(/　/g, ' ').trim();
}

/**
 * 注射実施の三点認証（FR-INJ-01）。
 *
 *  Given 発行済の注射オーダと 3 点のスキャン値
 *  When  患者番号 / 薬剤コード / 実施者番号 を期待値と突合
 *  Then  全一致 → OrderExecution(threePointAuth.verified=true) を記録し
 *        状態機械で IN_PROGRESS→DONE まで進める（実施完了）。
 *        いずれか不一致 → 実施をブロックし、失敗照合(threePointAuth.verified=false)
 *        のみ記録（状態は進めない）。
 *
 * 戻り値:
 *  - { ok:true, executionId } 実施成功
 *  - { blocked:true, points } 不一致でブロック（points に各点の matched）
 *  - { error } それ以外（前提不備・DB 障害）
 */
export async function executeInjectionWithAuth(input: ExecuteInjectionInput) {
  try {
    const s = await requireSession();
    const patientScan = norm(input.patientBarcode);
    const drugScan = norm(input.drugBarcode);
    const execScan = norm(input.executorBarcode);
    if (!input.orderId) return { error: '対象オーダが指定されていません' };
    if (!patientScan || !drugScan || !execScan) {
      return { error: '患者・薬剤・実施者の3点すべてをスキャンしてください' };
    }

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      include: {
        patient: { select: { id: true, patientNo: true, kanjiLastName: true, kanjiFirstName: true } },
      },
    });
    if (!order) return { error: 'オーダが見つかりません' };
    if (order.orderType !== 'INJECTION') return { error: '注射オーダではありません' };

    // ── 1) 患者照合: 患者バーコード(=患者番号) と オーダの患者番号 ──
    const patientMatched = norm(order.patient.patientNo) === patientScan;

    // ── 2) 薬剤照合: 薬剤バーコード(各種コード) と オーダ明細の薬剤コード ──
    const detailRaw = order.detail as { kind?: string; route?: string; items?: InjectionItem[] } | null;
    const items: InjectionItem[] =
      detailRaw && detailRaw.kind === 'INJECTION' && Array.isArray(detailRaw.items)
        ? detailRaw.items
        : [];
    const orderDrugCodes = items
      .map((it) => norm(it.drugCode))
      .filter((c) => c.length > 0);
    // マスタ側の別コード（GS1/HOT/YJ）でスキャンされても照合できるよう拡張。
    const drugCodeSet = new Set(orderDrugCodes);
    if (orderDrugCodes.length > 0) {
      const products = await prisma.drugProduct.findMany({
        where: { receiptCode: { in: orderDrugCodes } },
        select: { receiptCode: true, gs1Code: true, gtinUnit: true, hotCode: true, yjCode: true },
      });
      for (const p of products) {
        for (const c of [p.receiptCode, p.gs1Code, p.gtinUnit, p.hotCode, p.yjCode]) {
          if (c) drugCodeSet.add(norm(c));
        }
      }
    }
    const drugMatched = drugCodeSet.has(drugScan);
    const matchedItem = items.find((it) => norm(it.drugCode) === drugScan);

    // ── 3) 実施者照合: 実施者バーコード(職員番号 or loginId) と 職員 ──
    let executor: { id: string; name: string; staffNo: string } | null = null;
    try {
      executor = await prisma.staffUser.findFirst({
        where: { OR: [{ staffNo: execScan }, { loginId: execScan }] },
        select: { id: true, name: true, staffNo: true },
      });
    } catch {
      executor = null;
    }
    const executorMatched = !!executor;

    const points: AuthPoint[] = [
      {
        point: 'PATIENT',
        scanned: patientScan,
        matched: patientMatched,
        expected: order.patient.patientNo,
        label: `${order.patient.kanjiLastName} ${order.patient.kanjiFirstName}`,
      },
      {
        point: 'DRUG',
        scanned: drugScan,
        matched: drugMatched,
        expected: orderDrugCodes[0],
        label: matchedItem?.drugName ?? items[0]?.drugName,
      },
      {
        point: 'EXECUTOR',
        scanned: execScan,
        matched: executorMatched,
        expected: executor?.staffNo,
        label: executor?.name,
      },
    ];
    const allMatched = points.every((p) => p.matched);

    const authRecord: ThreePointAuthRecord = {
      verified: allMatched,
      scannedAt: new Date().toISOString(),
      executorUserId: executor?.id ?? s.userId,
      points,
    };

    if (!allMatched) {
      // 不一致 → 実施ブロック。失敗照合のみ記録（状態は進めない）。
      await prisma.orderExecution.create({
        data: {
          orderId: order.id,
          executedByUserId: executor?.id ?? s.userId,
          threePointAuth: authRecord as object,
        },
      });
      await writeAudit({
        actorUserId: s.userId,
        patientId: order.patientId,
        action: 'ORDER_CHECK',
        resource: 'Order:INJECTION.threePointAuth',
        resourceId: order.id,
        result: 'BLOCKED',
        detail: { points: points.map((p) => ({ point: p.point, matched: p.matched })) },
      });
      revalidatePath('/orders/injection');
      return { blocked: true as const, points };
    }

    // 全一致 → 状態機械で実施完了まで進める（現状態から DONE まで安全に遷移）。
    const status = order.status as OrderStatus;
    const path: OrderStatus[] = [];
    if (status === 'REQUESTED') path.push('RECEIVED', 'IN_PROGRESS', 'DONE');
    else if (status === 'RECEIVED') path.push('IN_PROGRESS', 'DONE');
    else if (status === 'IN_PROGRESS') path.push('DONE');
    // それ以外（DRAFT/DONE 以降/中止）は遷移せず実施記録のみ。

    let prev = status;
    for (const next of path) {
      assertOrderTransition(prev, next);
      prev = next;
    }
    const execution = await prisma.orderExecution.create({
      data: {
        orderId: order.id,
        executedByUserId: executor?.id ?? s.userId,
        threePointAuth: authRecord as object,
        result: { route: detailRaw?.route } as object,
      },
    });
    if (path.length > 0) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: path[path.length - 1] },
      });
    }
    await writeAudit({
      actorUserId: executor?.id ?? s.userId,
      patientId: order.patientId,
      action: 'ORDER_CHECK',
      resource: 'Order:INJECTION.threePointAuth',
      resourceId: order.id,
      result: 'VERIFIED',
      detail: { executionId: execution.id, drug: matchedItem?.drugName },
    });
    revalidatePath('/orders/injection');
    revalidatePath('/orders');
    return { ok: true as const, executionId: execution.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '実施処理に失敗しました' };
  }
}
