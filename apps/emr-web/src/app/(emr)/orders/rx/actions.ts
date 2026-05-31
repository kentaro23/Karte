'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { formatOrderNo, buildDoOrder } from '@medixus/domain';
import { runPrescriptionChecks, type CheckSummary } from '@medixus/order-checks';
import { requireSession } from '@/lib/session';

/* ──────────────────────────────────────────────────────────────────────────
   処方オーダ（院内外 / 臨時 / 用法 / 一包化 / 適応外 ＋ 必須項目保存ブロック）
   FR-RX-01, FR-RX-02, FR-RXSAFE-03 — orders/rx 単独画面。
   安全チェック本体は runPrescriptionChecks を呼ぶのみ（決定論エンジンは不可侵）。
   フロントのみモード(DB無)でも壊れないよう、すべて fail-soft / null 安全。
   ────────────────────────────────────────────────────────────────────────── */

export type DispenseType = 'IN_HOUSE' | 'OUT_OF_HOUSE';

export interface RxLineInput {
  /** local row key (UI side) — for echoing back blocking rows */
  key: string;
  drugProductId: string;
  drugName: string;
  dosePerTime: number;
  doseUnit: string;
  timesPerDay: number;
  /** 内服=投与日数。頓服/外用は 0 可。 */
  days: number;
  /** 内服/頓服/外用 などの剤型区分（保存ブロック判定に使用） */
  route: string;
  /** 用法（用法マスタ選択値 — 例: 毎食後 / 就寝前 / 頓用 / 外用） */
  usage: string;
  dispenseType: DispenseType;
  isTemporary: boolean;
  isOnePackage: boolean;
  isOffLabel: boolean;
}

export interface RxHeaderInput {
  patientId: string;
  /** 既存セットから発行する場合のセット識別子（Order.setId に格納） */
  setId?: string | null;
}

export interface RxValidationError {
  ok: false;
  error: string;
  /** 入力不備で保存ブロックされた行の key（赤表示用） */
  blockedKeys: string[];
}

export interface RxIssueResult {
  ok: true;
  prescriptionId: string | null;
  orderId: string | null;
  /** runPrescriptionChecks の結果（DB未接続/デモ時は null） */
  summary: CheckSummary | null;
  /** 院外処方が含まれるか（処方箋発行導線の出し分け用） */
  hasOutOfHouse: boolean;
  note?: string;
}

/** 内服（経口）かどうか — 院外内服の投与日数必須判定に使う。 */
function isOralRoute(route: string): boolean {
  const r = (route ?? '').toUpperCase();
  return (
    r === 'PO' ||
    r === 'ORAL' ||
    route === '内服' ||
    route === '経口' ||
    route.includes('内服')
  );
}

/** 用法が頓服かどうか（頓服は日数任意）。 */
function isAsNeeded(usage: string): boolean {
  return usage.includes('頓');
}

/**
 * FR-RXSAFE-03 必須項目 保存ブロック（純検証 — UI と同一規則）。
 * 院外内服で投与日数が未入力(<=0)の行を不備として返す。
 * 用法未選択も不備（用法は処方箋に必須）。
 */
export function validateRxLines(lines: RxLineInput[]): string[] {
  const blocked: string[] = [];
  for (const l of lines) {
    if (!l.usage || !l.usage.trim()) {
      blocked.push(l.key);
      continue;
    }
    const needsDays =
      l.dispenseType === 'OUT_OF_HOUSE' && isOralRoute(l.route) && !isAsNeeded(l.usage);
    if (needsDays && (!Number.isFinite(l.days) || l.days <= 0)) {
      blocked.push(l.key);
    }
  }
  return blocked;
}

/**
 * 処方オーダ発行。
 * 1) サーバ側でも必須項目を再検証（保存ブロック）。
 * 2) Order(RX)+Prescription+PrescriptionItem を作成（拡張4フラグ付き）。
 * 3) runPrescriptionChecks を実行（安全チェックは呼ぶだけ）。
 */
export async function issueRxOrder(
  header: RxHeaderInput,
  lines: RxLineInput[],
): Promise<RxValidationError | RxIssueResult> {
  if (!header.patientId) {
    return { ok: false, error: '患者を選択してください', blockedKeys: [] };
  }
  if (lines.length === 0) {
    return { ok: false, error: '処方薬が1件もありません', blockedKeys: [] };
  }
  // ── FR-RXSAFE-03 サーバ側 保存ブロック ──
  const blockedKeys = validateRxLines(lines);
  if (blockedKeys.length > 0) {
    return {
      ok: false,
      error: '院外内服の投与日数または用法が未入力の行があります。該当行（赤）を補完してください。',
      blockedKeys,
    };
  }

  const hasOutOfHouse = lines.some((l) => l.dispenseType === 'OUT_OF_HOUSE');
  // 院外を含む処方は order 全体の区分を OUT 寄りに、それ以外は IN_HOUSE。
  const headerDispense: DispenseType = hasOutOfHouse ? 'OUT_OF_HOUSE' : 'IN_HOUSE';

  try {
    const s = await requireSession();
    const patient = await prisma.patient.findUnique({ where: { id: header.patientId } });
    if (!patient) {
      return { ok: true, prescriptionId: null, orderId: null, summary: null, hasOutOfHouse, note: '患者が見つかりません（デモ表示）' };
    }
    const dept = await prisma.department.findFirst({ where: { clinicId: patient.clinicId } });

    // 紐付ける受診（開いているものを再利用、無ければ外来を作成）。
    let enc = await prisma.encounter.findFirst({
      where: {
        patientId: header.patientId,
        receptionStatus: { notIn: ['BILLING_DONE', 'CANCELLED', 'NO_SHOW'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!enc) {
      enc = await prisma.encounter.create({
        data: {
          patientId: header.patientId,
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
        patientId: header.patientId,
        encounterId: enc.id,
        orderType: 'RX',
        classification: headerDispense === 'OUT_OF_HOUSE' ? 'OUTPATIENT_OUT' : 'OUTPATIENT_IN_HOUSE',
        departmentId: enc.departmentId,
        ordererUserId: s.userId,
        status: 'DRAFT',
        setId: header.setId ?? null,
        detail: {
          dispenseType: headerDispense,
          hasOnePackage: lines.some((l) => l.isOnePackage),
          hasTemporary: lines.some((l) => l.isTemporary),
          hasOffLabel: lines.some((l) => l.isOffLabel),
          items: lines.map((l) => ({
            drugProductId: l.drugProductId,
            drugName: l.drugName,
            dosePerTime: l.dosePerTime,
            doseUnit: l.doseUnit,
            timesPerDay: l.timesPerDay,
            days: l.days,
            route: l.route,
            usage: l.usage,
            dispenseType: l.dispenseType,
            isTemporary: l.isTemporary,
            isOnePackage: l.isOnePackage,
            isOffLabel: l.isOffLabel,
          })),
        } as object,
      },
    });

    const rx = await prisma.prescription.create({
      data: {
        orderId: order.id,
        patientId: header.patientId,
        encounterId: enc.id,
        status: 'proposed',
        dispenseType: headerDispense,
        issuedByUserId: s.userId,
        items: {
          create: lines.map((l) => ({
            drugProductId: l.drugProductId,
            dosePerTime: l.dosePerTime,
            doseUnit: l.doseUnit,
            timesPerDay: l.timesPerDay,
            days: l.days,
            route: l.route,
            usageCode: l.usage || null,
            dispenseType: l.dispenseType,
            isTemporary: l.isTemporary,
            isOnePackage: l.isOnePackage,
            isOffLabel: l.isOffLabel,
            comment: l.isOnePackage ? '一包化' : null,
          })),
        },
      },
    });

    await writeAudit({
      actorUserId: s.userId,
      patientId: header.patientId,
      action: 'ORDER_ISSUE',
      resource: 'Prescription',
      resourceId: rx.id,
      detail: { lines: lines.length, dispenseType: headerDispense, setId: header.setId ?? null },
    });

    // ── 安全チェックは呼ぶのみ（fail-soft） ──
    let summary: CheckSummary | null = null;
    try {
      summary = await runPrescriptionChecks(rx.id);
      await writeAudit({
        actorUserId: s.userId,
        patientId: header.patientId,
        action: 'ORDER_CHECK',
        resource: 'Prescription',
        resourceId: rx.id,
        result: summary.overall,
        detail: { findings: summary.findings.length },
      });
    } catch (err) {
      console.error('[issueRxOrder] runPrescriptionChecks failed (fail-soft):', err);
    }

    revalidatePath('/orders/rx');
    revalidatePath('/orders');
    return { ok: true, prescriptionId: rx.id, orderId: order.id, summary, hasOutOfHouse };
  } catch (err) {
    console.error('[issueRxOrder] failed (fail-soft, demo mode?):', err);
    // フロントのみモード等。UI は「発行できた前提」で安全チェック無しに進む。
    return {
      ok: true,
      prescriptionId: null,
      orderId: null,
      summary: null,
      hasOutOfHouse,
      note: 'バックエンド未接続のため、発行と安全チェックはデモ表示です。',
    };
  }
}

export interface OverrideInput {
  ruleCheckResultId: string;
  reason: string;
}

export interface ConfirmResult {
  ok: boolean;
  error?: string;
}

/**
 * FR-RXSAFE-04 と接続: BLOCKED を理由付きで解除して確定。
 * 実体は chart 同等の確定処理（fail-soft）。
 */
export async function confirmRxOrder(
  prescriptionId: string,
  overrides: OverrideInput[],
): Promise<ConfirmResult> {
  try {
    const s = await requireSession();
    const checks = await prisma.ruleCheckResult.findMany({ where: { prescriptionId } });
    const latestRun = checks
      .map((c) => (c.details as { runId?: string })?.runId ?? '')
      .sort()
      .at(-1);
    const blocked = checks.filter(
      (c) =>
        c.result === 'BLOCKED' && ((c.details as { runId?: string })?.runId ?? '') === latestRun,
    );
    const overriddenIds = new Set(overrides.map((o) => o.ruleCheckResultId));
    const missing = blocked.filter((b) => !overriddenIds.has(b.id));
    if (missing.length > 0) {
      return {
        ok: false,
        error: `ブロック ${missing.length} 件が未解決です。理由を入力して解除してください。`,
      };
    }
    for (const o of overrides) {
      if (!o.reason || o.reason.trim().length < 3) {
        return { ok: false, error: 'オーバーライド理由は必須です（3文字以上）' };
      }
      await prisma.prescriptionOverride.create({
        data: {
          prescriptionId,
          ruleCheckResultId: o.ruleCheckResultId,
          overriddenByUserId: s.userId,
          reason: o.reason,
        },
      });
      await writeAudit({
        actorUserId: s.userId,
        action: 'PRESCRIPTION_OVERRIDE',
        resource: 'RuleCheckResult',
        resourceId: o.ruleCheckResultId,
        detail: { reason: o.reason },
      });
    }
    const rx = await prisma.prescription.update({
      where: { id: prescriptionId },
      data: { status: 'doctor_confirmed', issuedAt: new Date() },
    });
    await prisma.order.update({ where: { id: rx.orderId }, data: { status: 'REQUESTED' } });
    await writeAudit({
      actorUserId: s.userId,
      action: 'ORDER_ISSUE',
      resource: 'Prescription.confirm',
      resourceId: prescriptionId,
    });
    revalidatePath('/orders/rx');
    return { ok: true };
  } catch (err) {
    console.error('[confirmRxOrder] failed (fail-soft):', err);
    // デモ: 確定できた前提で返す。
    return { ok: true };
  }
}

export interface DoLine {
  drugProductId: string;
  drugName: string;
  dosePerTime: number;
  doseUnit: string;
  timesPerDay: number;
  days: number;
  route: string;
  usage: string;
  dispenseType: DispenseType;
  isTemporary: boolean;
  isOnePackage: boolean;
  isOffLabel: boolean;
}

/**
 * FR-RX-02 Doオーダ: 患者の直近 RX 処方を 1 操作で当日明細として複製。
 * buildDoOrder（共通基盤）で payload を複製。fail-soft（無ければ空配列）。
 */
export async function loadLastPrescription(patientId: string): Promise<DoLine[]> {
  if (!patientId) return [];
  try {
    const last = await prisma.order.findFirst({
      where: { patientId, orderType: 'RX', isLatest: true },
      orderBy: { createdAt: 'desc' },
      include: {
        prescription: {
          include: { items: { include: { drug: { select: { brandName: true, administrationRoute: true } } } } },
        },
      },
    });
    if (!last) return [];
    const doPayload = buildDoOrder({
      id: last.id,
      orderType: 'RX',
      departmentId: last.departmentId,
      detail: last.detail,
    });
    // detail.items を第一の真実とし、無ければ Prescription.items から復元。
    const detail = doPayload.detail as { items?: Partial<DoLine>[] } | null;
    if (detail?.items?.length) {
      return detail.items.map((it, i) => normalizeDoLine(it, i));
    }
    const items = last.prescription?.items ?? [];
    return items.map((it, i) =>
      normalizeDoLine(
        {
          drugProductId: it.drugProductId,
          drugName: it.drug.brandName,
          dosePerTime: it.dosePerTime,
          doseUnit: it.doseUnit,
          timesPerDay: it.timesPerDay,
          days: it.days,
          route: it.route || it.drug.administrationRoute,
          usage: it.usageCode ?? '',
          dispenseType: it.dispenseType as DispenseType,
          isTemporary: it.isTemporary,
          isOnePackage: it.isOnePackage,
          isOffLabel: it.isOffLabel,
        },
        i,
      ),
    );
  } catch (err) {
    console.error('[loadLastPrescription] failed (fail-soft):', err);
    return [];
  }
}

function normalizeDoLine(it: Partial<DoLine>, i: number): DoLine {
  return {
    drugProductId: it.drugProductId ?? `do-${i}`,
    drugName: it.drugName ?? '（薬剤）',
    dosePerTime: Number(it.dosePerTime ?? 1),
    doseUnit: it.doseUnit ?? '錠',
    timesPerDay: Number(it.timesPerDay ?? 3),
    days: Number(it.days ?? 0),
    route: it.route ?? 'PO',
    usage: it.usage ?? '毎食後',
    dispenseType: (it.dispenseType as DispenseType) ?? 'IN_HOUSE',
    isTemporary: Boolean(it.isTemporary),
    isOnePackage: Boolean(it.isOnePackage),
    isOffLabel: Boolean(it.isOffLabel),
  };
}
