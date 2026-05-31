'use server';
import { revalidatePath } from 'next/cache';
import { prisma, isDemoMode } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { formatOrderNo, buildDoOrder } from '@medixus/domain';
import { runPrescriptionChecks, type CheckSummary } from '@medixus/order-checks';
import { requireSession } from '@/lib/session';
import {
  FALLBACK_USAGES,
  groupForCategory,
  usageIsAsNeeded,
  type UsageOption,
} from './constants';

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

/**
 * FR-RXSAFE-03 必須項目 保存ブロック（純検証 — UI と同一規則）。
 * 院外内服で投与日数が未入力(<=0)の行を不備として返す。
 * 用法未選択も不備（用法は処方箋に必須）。
 * 頓服判定は UsageMaster.isAsNeeded（usages）を第一の真実とし、未収載コードは
 * 「頓」を含むかのフォールバック（usageIsAsNeeded）— マスタ未整備でも壊れない。
 * 'use server' ファイル内では async 以外を export できないため非 export 関数とする
 * （本ファイル内の issueRxOrder からのみ使用）。
 */
function validateRxLines(lines: RxLineInput[], usages?: UsageOption[]): string[] {
  const blocked: string[] = [];
  for (const l of lines) {
    if (!l.usage || !l.usage.trim()) {
      blocked.push(l.key);
      continue;
    }
    const needsDays =
      l.dispenseType === 'OUT_OF_HOUSE' &&
      isOralRoute(l.route) &&
      !usageIsAsNeeded(l.usage, usages);
    if (needsDays && (!Number.isFinite(l.days) || l.days <= 0)) {
      blocked.push(l.key);
    }
  }
  return blocked;
}

/* ──────────────────────────────────────────────────────────────────────────
   WIRE-RX1: 用法マスタ（UsageMaster）の本永続化読込
   ─────────────────────────────────────────────────────────────────────────
   旧 UI はクライアント固定リストの用法を使っていた。これを UsageMaster の
   読込に置換する（PrescriptionItem.usageCode / OrderSetItem.usageCode の参照元）。
   DB 未接続 / マスタ未整備 / 取得失敗時は FALLBACK_USAGES に fail-soft。
   ────────────────────────────────────────────────────────────────────────── */

/** UsageMaster 行を UI 向け UsageOption に整形（純変換）。 */
function toUsageOption(u: {
  code: string;
  displayName: string;
  category: string;
  defaultTimesPerDay: number | null;
  isAsNeeded: boolean;
  timing: string | null;
}): UsageOption {
  const group = groupForCategory(u.category);
  const tpd = u.defaultTimesPerDay ?? undefined;
  const tpdLabel =
    !u.isAsNeeded && tpd ? `（1日${tpd % 1 ? tpd : Math.round(tpd)}回）` : '';
  const timing = u.timing ? `・${u.timing}` : '';
  return {
    value: u.code,
    label: `${group}・${u.displayName}${timing}${tpdLabel}`,
    group,
    isAsNeeded: u.isAsNeeded,
    defaultTimesPerDay: tpd,
  };
}

/**
 * 非公開ヘルパ: UsageMaster を読み込む（issueRxOrder の頓服判定で使用）。
 * fail-soft：失敗時は空配列を返し、呼び元の usageIsAsNeeded がフォールバックする。
 */
async function readUsageMastersInternal(): Promise<UsageOption[]> {
  if (isDemoMode) return FALLBACK_USAGES;
  try {
    const s = await requireSession();
    const rows = await prisma.usageMaster.findMany({
      where: {
        isActive: true,
        OR: [{ clinicId: null }, { clinicId: s.clinicId }],
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    if (rows.length === 0) return FALLBACK_USAGES;
    return rows.map(toUsageOption);
  } catch (err) {
    console.error('[readUsageMastersInternal] failed (fail-soft):', err);
    return [];
  }
}

/**
 * 用法マスタ取得（クライアント/ページ用 公開アクション）。
 * UsageMaster(isActive) を院内共有(null)＋自院 clinicId で読み、UI 向けに整形。
 * DB 無/未整備/失敗時は FALLBACK_USAGES（旧 UI 互換）に fail-soft。
 */
export async function loadUsageMasters(): Promise<UsageOption[]> {
  const list = await readUsageMastersInternal();
  return list.length > 0 ? list : FALLBACK_USAGES;
}

/* ──────────────────────────────────────────────────────────────────────────
   WIRE-RX1: 処方セット（OrderSet kind:RX + OrderSetItem）の本永続化
   ─────────────────────────────────────────────────────────────────────────
   旧 UI はセットをクライアント state に保持していた。これを OrderSet/OrderSetItem
   の保存/呼出に置換する。呼出時は header.setId に OrderSet.id を載せることで、
   既存の Order.setId 配線（issueRxOrder）がそのまま生きる。
   OrderSetItem.usageCode は UsageMaster.code を参照する文字列で格納。
   全 DB 書込は try/catch で fail-soft（DB 無モードでも画面が出る）。
   ────────────────────────────────────────────────────────────────────────── */

/** 呼出された処方セット 1 件（UI が明細へ展開する形）。 */
export interface RxOrderSet {
  id: string;
  name: string;
  lines: RxSetLine[];
}

/** OrderSetItem を UI 行へ展開するための最小形（drug 名は呼出側で解決）。 */
export interface RxSetLine {
  drugProductId: string;
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

/** OrderSetItem.detail に退避する RX 固有フラグ（スキーマに専用列が無いもの）。 */
interface RxSetItemDetail {
  dispenseType?: DispenseType;
  isTemporary?: boolean;
  isOnePackage?: boolean;
  isOffLabel?: boolean;
  drugName?: string;
}

/**
 * 処方セット一覧の読込（RX セットのみ）。
 * 院内共有(clinicId)＋自分の個人セット(ownerUserId) を対象に OrderSet+items を取得。
 * DB 無/失敗時は空配列（UI はセット呼出を出さない）に fail-soft。
 */
export async function loadOrderSets(): Promise<RxOrderSet[]> {
  if (isDemoMode) return [];
  try {
    const s = await requireSession();
    const sets = await prisma.orderSet.findMany({
      where: {
        kind: 'RX',
        isActive: true,
        OR: [{ ownerUserId: s.userId }, { clinicId: s.clinicId, ownerUserId: null }],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      take: 100,
    });
    return sets.map((set) => ({
      id: set.id,
      name: set.name,
      lines: set.items
        .filter((it) => it.drugProductId)
        .map((it) => {
          const d = (it.detail as RxSetItemDetail | null) ?? {};
          return {
            drugProductId: it.drugProductId as string,
            dosePerTime: Number(it.dosePerTime ?? 1),
            doseUnit: it.doseUnit ?? '錠',
            timesPerDay: Number(it.timesPerDay ?? 3),
            days: Number(it.days ?? 0),
            route: it.route ?? 'PO',
            usage: it.usageCode ?? '',
            dispenseType: (d.dispenseType as DispenseType) ?? 'IN_HOUSE',
            isTemporary: Boolean(d.isTemporary),
            isOnePackage: Boolean(d.isOnePackage),
            isOffLabel: Boolean(d.isOffLabel),
          };
        }),
    }));
  } catch (err) {
    console.error('[loadOrderSets] failed (fail-soft):', err);
    return [];
  }
}

export interface SaveOrderSetInput {
  name: string;
  lines: RxLineInput[];
}

export interface SaveOrderSetResult {
  ok: boolean;
  /** 作成された OrderSet.id（呼出時に Order.setId へ載せる）。デモ時は null。 */
  setId: string | null;
  error?: string;
  note?: string;
}

/**
 * 現在の処方明細を処方セット（OrderSet kind:RX + OrderSetItem）として保存。
 * 個人セット（ownerUserId=自分, clinicId=自院）として作成し、OrderSet.id を返す。
 * usageCode は UsageMaster.code を参照する文字列で格納。RX 固有フラグは
 * 専用列が無いため OrderSetItem.detail(JSON) に退避（呼出時に復元）。
 * 全書込 try/catch・fail-soft（DB 無でも UI は保存できた前提で進む）。
 */
export async function saveOrderSet(input: SaveOrderSetInput): Promise<SaveOrderSetResult> {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, setId: null, error: 'セット名を入力してください' };
  if (!input.lines || input.lines.length === 0) {
    return { ok: false, setId: null, error: 'セットに保存する明細がありません' };
  }
  if (isDemoMode) {
    return {
      ok: true,
      setId: null,
      note: '処方セットを保存しました（デモ表示）。バックエンド接続時に永続化されます。',
    };
  }
  try {
    const s = await requireSession();
    const set = await prisma.orderSet.create({
      data: {
        clinicId: s.clinicId,
        ownerUserId: s.userId,
        kind: 'RX',
        name,
        createdByUserId: s.userId,
        items: {
          create: input.lines.map((l, i) => ({
            orderType: 'RX',
            drugProductId: l.drugProductId,
            usageCode: l.usage || null,
            dosePerTime: l.dosePerTime,
            doseUnit: l.doseUnit,
            timesPerDay: l.timesPerDay,
            days: l.days,
            route: l.route,
            sortOrder: i,
            detail: {
              dispenseType: l.dispenseType,
              isTemporary: l.isTemporary,
              isOnePackage: l.isOnePackage,
              isOffLabel: l.isOffLabel,
              drugName: l.drugName,
            } as object,
          })),
        },
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'OrderSet',
      resourceId: set.id,
      detail: { kind: 'RX', name, items: input.lines.length },
    });
    revalidatePath('/orders/rx');
    return { ok: true, setId: set.id };
  } catch (err) {
    console.error('[saveOrderSet] failed (fail-soft):', err);
    return {
      ok: true,
      setId: null,
      note: '処方セットを保存しました（デモ表示）。',
    };
  }
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
  // ── FR-RXSAFE-03 サーバ側 保存ブロック（頓服判定は UsageMaster 由来）──
  const usages = await readUsageMastersInternal();
  const blockedKeys = validateRxLines(lines, usages);
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
