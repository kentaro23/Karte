'use server';
/**
 * 受付一覧（/reception）のサーバアクション。
 *
 *  - openChart / openPatient ……… 既存の患者選択ハブと同じ挙動（カルテを開く・受付）。
 *  - loadReception …………………… 一覧データ＋編集オプション＋保存検索を取得（fail-soft）。
 *  - saveReceptionEdit ……………… 行内編集（保険/診療科/医師/患者メモ/受付メモ）。
 *      CLERK 以上のみ許可。変更は AuditEvent(CHART_WRITE/resource=reception-edit) に記録し、
 *      次回読込時に最新値を再生（schema を変えずに編集を永続化）。FR-RCP-02。
 *  - saveSearchCondition / deleteSearchCondition / loadSearchConditions
 *      …………………………………… 検索条件の保存・再利用（SavedSearchCondition）。FR-RCP-03。
 *
 * DB 未接続（フロントのみ）でも描画されるよう、取得系は try/catch で fail-soft。
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { age, type ReceptionStatus } from '@medixus/domain';
import { requireSession } from '@/lib/session';

// ── 行内編集の対象フィールド ───────────────────────────────────────────────
export type ReceptionEditField =
  | 'insurance'
  | 'dept'
  | 'doctor'
  | 'patientMemo'
  | 'receptionMemo';

const EDIT_FIELDS: ReceptionEditField[] = [
  'insurance',
  'dept',
  'doctor',
  'patientMemo',
  'receptionMemo',
];

const EDIT_FIELD_LABEL: Record<ReceptionEditField, string> = {
  insurance: '保険',
  dept: '診療科',
  doctor: '医師',
  patientMemo: '患者メモ',
  receptionMemo: '受付メモ',
};

/** 行内編集が許可される職種（CLERK 以上＝受付事務・看護・医師・管理者）。 */
const EDIT_ROLES = new Set([
  'CLERK',
  'NURSE',
  'DOCTOR',
  'RESIDENT',
  'MANAGER',
  'ADMIN',
]);

function canEditReception(jobType: string): boolean {
  return EDIT_ROLES.has(jobType);
}

// ── 公開型（page.tsx が消費） ─────────────────────────────────────────────
export interface ReceptionOption {
  value: string;
  label: string;
}

export interface ReceptionListRow {
  encounterId: string;
  receptionNo: number | null;
  patientNo: string;
  name: string;
  kana: string;
  gender: string;
  age: number;
  dob: string;
  status: ReceptionStatus;
  arrivedAt: string | null;
  visitType: string | null;
  /** 行内編集値（base ＋ 監査再生のオーバライド済） */
  insurance: string;
  dept: string;
  doctor: string;
  patientMemo: string;
  receptionMemo: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  condition: ReceptionSearchCondition;
}

export interface ReceptionSearchCondition {
  q?: string;
  status?: string;
  dept?: string;
  doctor?: string;
  /** 表示カラムキー（未設定なら既定） */
  columns?: string[];
}

export interface ReceptionListData {
  rows: ReceptionListRow[];
  deptOptions: ReceptionOption[];
  doctorOptions: ReceptionOption[];
  statusOptions: ReceptionOption[];
  savedSearches: SavedSearch[];
  canEdit: boolean;
  jobType: string;
  dbDown: boolean;
}

const SCREEN_KEY = 'reception';
const EDIT_RESOURCE = 'reception-edit';
const TERMINAL: ReceptionStatus[] = ['BILLING_DONE', 'CANCELLED', 'NO_SHOW'];

// ── デモ（DB未接続）用の決定論サンプル ──────────────────────────────────────
function demoRows(): ReceptionListRow[] {
  const base = Date.now();
  const mk = (
    i: number,
    name: string,
    kana: string,
    gender: string,
    ageN: number,
    dob: string,
    status: ReceptionStatus,
    waitMin: number,
    visit: string,
    insurance: string,
    dept: string,
    doctor: string,
    pMemo: string,
    rMemo: string,
  ): ReceptionListRow => ({
    encounterId: `demo-enc-${i}`,
    receptionNo: i,
    patientNo: String(120 + i).padStart(6, '0'),
    name,
    kana,
    gender,
    age: ageN,
    dob,
    status,
    arrivedAt: new Date(base - waitMin * 60000).toISOString(),
    visitType: visit,
    insurance,
    dept,
    doctor,
    patientMemo: pMemo,
    receptionMemo: rMemo,
  });
  return [
    mk(1, '見本 太郎', 'ミホン タロウ', '男', 58, '1967-04-02', 'READY', 12, '再診', '社保 本人 3割', '内科', '研修 太郎', '車椅子', '紹介状持参'),
    mk(2, '試験 花子', 'シケン ハナコ', '女', 41, '1985-01-15', 'IN_CONSULTATION', 35, '初診', '国保 3割', '内科', '研修 太郎', '', '初診問診票回収済'),
    mk(3, '標本 次郎', 'ヒョウホン ジロウ', '男', 73, '1952-11-30', 'ARRIVED', 8, '再診', '後期高齢 1割', '整形外科', '', '難聴あり', ''),
    mk(4, '例示 三郎', 'レイジ サブロウ', '男', 29, '1996-07-21', 'QUESTIONNAIRE_IN_PROGRESS', 64, '初診', '社保 家族 3割', '皮膚科', '', '', '会計時 公費確認'),
  ];
}

/**
 * 直近の編集（AuditEvent: resource=reception-edit）を再生して、
 * encounterId × field の最新値マップを返す。失敗時は空。
 */
async function loadEditOverrides(): Promise<Map<string, Partial<Record<ReceptionEditField, string>>>> {
  const out = new Map<string, Partial<Record<ReceptionEditField, string>>>();
  try {
    const events = await prisma.auditEvent.findMany({
      where: { action: 'CHART_WRITE', resource: EDIT_RESOURCE },
      orderBy: { createdAt: 'asc' }, // 後勝ち（新しい値で上書き）
      take: 2000,
      select: { resourceId: true, detail: true },
    });
    for (const e of events) {
      if (!e.resourceId) continue;
      const raw = e.detail as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const d = raw as { field?: string; value?: string };
      const field = d.field as ReceptionEditField | undefined;
      if (!field || !EDIT_FIELDS.includes(field)) continue;
      const cur = out.get(e.resourceId) ?? {};
      cur[field] = typeof d.value === 'string' ? d.value : '';
      out.set(e.resourceId, cur);
    }
  } catch (err) {
    console.error('[reception] loadEditOverrides failed (ignored):', err);
  }
  return out;
}

/** 一覧データ＋編集オプション＋保存検索を取得（DB 未接続でもデモ描画）。 */
export async function loadReception(): Promise<ReceptionListData> {
  const s = await requireSession();
  const canEdit = canEditReception(s.jobType);
  // ステータス選択肢は page 側で domain ラベルから生成するため空配列で返す。
  const statusOptions: ReceptionOption[] = [];

  let rows: ReceptionListRow[] = [];
  let deptOptions: ReceptionOption[] = [];
  let doctorOptions: ReceptionOption[] = [];
  let savedSearches: SavedSearch[] = [];
  let dbDown = false;

  try {
    const [encs, depts, doctors, overrides, saved] = await Promise.all([
      prisma.encounter.findMany({
        where: { encounterType: 'OUTPATIENT', receptionStatus: { notIn: TERMINAL } },
        include: {
          patient: { include: { insurances: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 300,
      }),
      prisma.department.findMany({ orderBy: { code: 'asc' } }),
      prisma.staffUser.findMany({
        where: { isActive: true, jobType: { in: ['DOCTOR', 'RESIDENT'] } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      loadEditOverrides(),
      prisma.savedSearchCondition.findMany({
        where: { userId: s.userId, screenKey: SCREEN_KEY },
        orderBy: { name: 'asc' },
      }),
    ]);

    const deptName = new Map(depts.map((d) => [d.id, d.name] as const));
    const docName = new Map(doctors.map((d) => [d.id, d.name] as const));
    deptOptions = depts.map((d) => ({ value: d.name, label: d.name }));
    doctorOptions = doctors.map((d) => ({ value: d.name, label: d.name }));

    const insuranceLabel = (
      ins: { payerType: string; symbol: string | null; number: string | null }[] | undefined,
    ): string => {
      const i = ins?.[0];
      if (!i) return '';
      const type =
        i.payerType === 'SOCIAL'
          ? '社保'
          : i.payerType === 'NATIONAL'
            ? '国保'
            : i.payerType === 'LATE_ELDERLY'
              ? '後期高齢'
              : i.payerType === 'SELF_PAY'
                ? '自費'
                : i.payerType === 'PUBLIC'
                  ? '公費'
                  : i.payerType;
      return [type, i.symbol, i.number].filter(Boolean).join(' ');
    };

    rows = encs.map((e) => {
      const ov = overrides.get(e.id) ?? {};
      const baseDept = deptName.get(e.departmentId) ?? '';
      const baseDoctor = e.openedByUserId ? (docName.get(e.openedByUserId) ?? '') : '';
      const baseInsurance = insuranceLabel(e.patient.insurances);
      return {
        encounterId: e.id,
        receptionNo: e.receptionNo,
        patientNo: e.patient.patientNo,
        name: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
        kana: `${e.patient.kanaLastName} ${e.patient.kanaFirstName}`,
        gender:
          e.patient.gender === 'MALE' ? '男' : e.patient.gender === 'FEMALE' ? '女' : '—',
        age: age(e.patient.dateOfBirth),
        dob: e.patient.dateOfBirth
          ? e.patient.dateOfBirth.toISOString().slice(0, 10)
          : '',
        status: e.receptionStatus as ReceptionStatus,
        arrivedAt: e.arrivedAt ? e.arrivedAt.toISOString() : null,
        visitType:
          e.visitType === 'FIRST' ? '初診' : e.visitType === 'RETURN' ? '再診' : null,
        insurance: ov.insurance ?? baseInsurance,
        dept: ov.dept ?? baseDept,
        doctor: ov.doctor ?? baseDoctor,
        patientMemo: ov.patientMemo ?? '',
        receptionMemo: ov.receptionMemo ?? '',
      };
    });

    savedSearches = saved.map((row) => {
      const raw = row.conditionJson as unknown;
      const condition: ReceptionSearchCondition =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as ReceptionSearchCondition)
          : {};
      return { id: row.id, name: row.name, condition };
    });

    // DB はあるが当日受付ゼロのときは demo を出さず空一覧（本番挙動）。
  } catch (err) {
    console.error('[reception] loadReception failed; demo fallback:', err);
    dbDown = true;
    rows = demoRows();
    deptOptions = ['内科', '整形外科', '皮膚科', '小児科', '眼科'].map((n) => ({
      value: n,
      label: n,
    }));
    doctorOptions = ['研修 太郎', '見本 院長', '試験 医師'].map((n) => ({
      value: n,
      label: n,
    }));
    savedSearches = [];
  }

  return {
    rows,
    deptOptions,
    doctorOptions,
    statusOptions,
    savedSearches,
    canEdit,
    jobType: s.jobType,
    dbDown,
  };
}

/**
 * 行内編集の保存（FR-RCP-02）。
 *  - CLERK 以上のみ許可（権限外は no-op で error を返す）。
 *  - 変更を AuditEvent(CHART_WRITE/resource=reception-edit/detail={field,value}) に記録。
 *  - DB 未接続時は fail-soft（楽観更新はクライアント側で完結）。
 */
export async function saveReceptionEdit(input: {
  encounterId: string;
  field: ReceptionEditField;
  value: string;
}): Promise<{ ok: true } | { error: string }> {
  const s = await requireSession();
  if (!canEditReception(s.jobType)) {
    return { error: '編集権限がありません（CLERK 以上）' };
  }
  if (!EDIT_FIELDS.includes(input.field)) {
    return { error: '不正な編集項目です' };
  }
  const value = (input.value ?? '').slice(0, 500);

  try {
    const hdr = await headers();
    const terminalId = hdr.get('x-terminal-id') ?? 'web';
    let patientId: string | null = null;
    // デモ encounter（demo-enc-*）は DB 参照しない。
    if (!input.encounterId.startsWith('demo-')) {
      const enc = await prisma.encounter.findUnique({
        where: { id: input.encounterId },
        select: { patientId: true },
      });
      patientId = enc?.patientId ?? null;
    }
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: EDIT_RESOURCE,
      resourceId: input.encounterId,
      terminalId,
      result: `${EDIT_FIELD_LABEL[input.field]}を変更`,
      detail: { field: input.field, value },
    });
  } catch (err) {
    console.error('[reception] saveReceptionEdit audit failed (soft):', err);
    // フロントのみモードでは監査が書けなくても UI は楽観更新で成立させる。
  }
  return { ok: true };
}

/** 検索条件を名前付きで保存（FR-RCP-03）。同名は上書き。 */
export async function saveSearchCondition(input: {
  name: string;
  condition: ReceptionSearchCondition;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const s = await requireSession();
  const name = input.name.trim().slice(0, 60);
  if (!name) return { error: '保存名を入力してください' };
  try {
    const existing = await prisma.savedSearchCondition.findFirst({
      where: { userId: s.userId, screenKey: SCREEN_KEY, name },
      select: { id: true },
    });
    if (existing) {
      await prisma.savedSearchCondition.update({
        where: { id: existing.id },
        data: { conditionJson: input.condition as object },
      });
      return { ok: true, id: existing.id };
    }
    const created = await prisma.savedSearchCondition.create({
      data: {
        userId: s.userId,
        screenKey: SCREEN_KEY,
        name,
        conditionJson: input.condition as object,
      },
      select: { id: true },
    });
    return { ok: true, id: created.id };
  } catch (err) {
    console.error('[reception] saveSearchCondition failed:', err);
    return { error: 'DB 未接続のため保存できませんでした（フロントのみ表示）' };
  }
}

/** 保存済み検索条件を削除（FR-RCP-03）。 */
export async function deleteSearchCondition(id: string): Promise<{ ok: true } | { error: string }> {
  const s = await requireSession();
  try {
    await prisma.savedSearchCondition.deleteMany({
      where: { id, userId: s.userId, screenKey: SCREEN_KEY },
    });
    return { ok: true };
  } catch (err) {
    console.error('[reception] deleteSearchCondition failed:', err);
    return { error: '削除できませんでした' };
  }
}

/** Open an existing encounter's chart: audit + exclusive-lock + selection log. */
export async function openChart(encounterId: string) {
  const s = await requireSession();
  if (encounterId.startsWith('demo-')) {
    // デモ行はカルテへ遷移しない（DB に存在しないため）。
    return;
  }
  const hdr = await headers();
  const terminalId = hdr.get('x-terminal-id') ?? 'web';

  const enc = await prisma.encounter.findUnique({
    where: { id: encounterId },
    select: { id: true, patientId: true },
  });
  if (!enc) throw new Error('受診が見つかりません');

  // 排他制御 — record who holds the write intent (別紙1 §2.9(6))
  const existing = await prisma.chartLock.findUnique({
    where: { resourceType_resourceId: { resourceType: 'encounter', resourceId: encounterId } },
  });
  if (existing && existing.lockedByUserId !== s.userId) {
    await writeAudit({
      actorUserId: s.userId,
      patientId: enc.patientId,
      action: 'CHART_OPEN',
      resource: 'encounter',
      resourceId: encounterId,
      terminalId,
      result: `other-terminal-in-use:${existing.lockedByName}`,
    });
  } else {
    await prisma.chartLock.upsert({
      where: { resourceType_resourceId: { resourceType: 'encounter', resourceId: encounterId } },
      create: {
        resourceType: 'encounter',
        resourceId: encounterId,
        lockedByUserId: s.userId,
        lockedByName: s.name,
        terminalId,
      },
      update: { lockedByUserId: s.userId, lockedByName: s.name, terminalId, heartbeatAt: new Date() },
    });
  }

  await prisma.patientSelectionLog.create({ data: { userId: s.userId, patientId: enc.patientId } });
  await writeAudit({
    actorUserId: s.userId,
    patientId: enc.patientId,
    action: 'PATIENT_SELECT',
    resource: 'encounter',
    resourceId: encounterId,
    terminalId,
  });
  redirect(`/chart/${encounterId}`);
}
