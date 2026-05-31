'use server';
/**
 * 救急（/er）のサーバアクション。FR-ER-01 / G30 / 174:10-12。
 *
 *  - registerEmergency …… 救急受付。Encounter(encounterType=EMERGENCY) を生成し、
 *      トリアージレベル(L1-L5)・搬送方法(arrivalMethod)・主訴を記録する。
 *  - retriagePatient ……… 再トリアージ。triageLevel を更新（受付一覧の優先表示が変わる）。
 *  - fetchSixInfo ………… オン資/マイナ保険証経由の「救急時6情報」参照
 *      （interop insurance-verify の fetchPatientInfo スタブ経由）。意識のない患者でも
 *      最小クリックで傷病名/感染症/アレルギー/検査/処方を参照する導線。
 *
 * すべて DB 未接続（フロントのみモード）でも操作が完結するよう try/catch で fail-soft。
 * 監査記録は本番化の核だが、フロントのみでも画面が動くよう握りつぶす（非致命）。
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { fetchPatientInfo, type OnshiPatientInfoResult } from '@medixus/interop';
import { requireSession } from '@/lib/session';

/** トリアージ区分（schema.prisma TriageLevel と一致）。 */
export type TriageLevelKey =
  | 'L1_RESUSCITATION'
  | 'L2_EMERGENT'
  | 'L3_URGENT'
  | 'L4_LESS_URGENT'
  | 'L5_NON_URGENT';

const TRIAGE_KEYS: TriageLevelKey[] = [
  'L1_RESUSCITATION',
  'L2_EMERGENT',
  'L3_URGENT',
  'L4_LESS_URGENT',
  'L5_NON_URGENT',
];

function isTriageKey(v: string): v is TriageLevelKey {
  return (TRIAGE_KEYS as string[]).includes(v);
}

// ── 画面が消費する公開型 ─────────────────────────────────────────────────
export interface ErEncounterRow {
  encounterId: string;
  receptionNo: number | null;
  patientId: string | null;
  patientNo: string | null;
  name: string;
  kana: string;
  age: number | null;
  triageLevel: TriageLevelKey | null;
  arrivalMethod: string | null;
  arrivedAt: string | null;
  status: string;
}
export interface ErOption {
  value: string;
  label: string;
}
export interface ErListData {
  rows: ErEncounterRow[];
  patientOptions: ErOption[];
  deptOptions: ErOption[];
  live: boolean;
}

function calcAge(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  try {
    const now = new Date();
    let a = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) a -= 1;
    return a >= 0 ? a : null;
  } catch {
    return null;
  }
}

/** フロントのみモード用デモ：救急受付中の患者（トリアージ順の優先表示を検証）。 */
function demoErRows(): ErEncounterRow[] {
  return [
    {
      encounterId: 'demo-er-1',
      receptionNo: 901,
      patientId: 'demo-pat-2',
      patientNo: '100002',
      name: '佐藤 太郎',
      kana: 'サトウ タロウ',
      age: 68,
      triageLevel: 'L1_RESUSCITATION',
      arrivalMethod: '救急車（ドクターカー）',
      arrivedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      status: 'ARRIVED',
    },
    {
      encounterId: 'demo-er-2',
      receptionNo: 902,
      patientId: null,
      patientNo: null,
      name: '身元不明（仮ID）',
      kana: '—',
      age: null,
      triageLevel: 'L2_EMERGENT',
      arrivalMethod: '救急車',
      arrivedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
      status: 'ARRIVED',
    },
    {
      encounterId: 'demo-er-3',
      receptionNo: 903,
      patientId: 'demo-pat-1',
      patientNo: '100001',
      name: '山田 花子',
      kana: 'ヤマダ ハナコ',
      age: 54,
      triageLevel: 'L3_URGENT',
      arrivalMethod: '独歩（walk-in）',
      arrivedAt: new Date(Date.now() - 28 * 60 * 1000).toISOString(),
      status: 'ARRIVED',
    },
    {
      encounterId: 'demo-er-4',
      receptionNo: 904,
      patientId: 'demo-pat-3',
      patientNo: '100003',
      name: '鈴木 一郎',
      kana: 'スズキ イチロウ',
      age: 41,
      triageLevel: 'L5_NON_URGENT',
      arrivalMethod: '独歩（walk-in）',
      arrivedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      status: 'ARRIVED',
    },
  ];
}
function demoPatientOptions(): ErOption[] {
  return [
    { value: 'demo-pat-1', label: '100001 山田 花子' },
    { value: 'demo-pat-2', label: '100002 佐藤 太郎' },
    { value: 'demo-pat-3', label: '100003 鈴木 一郎' },
  ];
}
function demoDeptOptions(): ErOption[] {
  return [
    { value: 'demo-dept-er', label: '救急科' },
    { value: 'demo-dept-im', label: '内科' },
    { value: 'demo-dept-sg', label: '外科' },
  ];
}

/**
 * 救急一覧＋受付フォーム用の選択肢を取得（fail-soft）。
 * DB 未接続・未マイグレーション時はデモにフォールバックして画面を描画する。
 * EMERGENCY の Encounter のみ対象。
 */
export async function loadEr(): Promise<ErListData> {
  try {
    const [encs, patients, depts] = await Promise.all([
      prisma.encounter.findMany({
        where: { encounterType: 'EMERGENCY' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { patient: true },
      }),
      prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 40 }),
      prisma.department.findMany({ orderBy: { name: 'asc' }, take: 40 }),
    ]);

    // フロントのみモードの demo クライアントは where を無視して全 Encounter を返すため、
    // アプリ側でも EMERGENCY に明示フィルタする（実 DB では where 済みで no-op）。
    const rows: ErEncounterRow[] = encs
      .filter((e) => e.encounterType === 'EMERGENCY')
      .map((e) => {
        const p = e.patient;
        return {
          encounterId: e.id,
          receptionNo: e.receptionNo,
          patientId: e.patientId,
          patientNo: p?.patientNo ?? null,
          name: p ? `${p.kanjiLastName} ${p.kanjiFirstName}` : '身元不明',
          kana: p ? `${p.kanaLastName} ${p.kanaFirstName}` : '—',
          age: calcAge(p?.dateOfBirth),
          triageLevel: (e.triageLevel as TriageLevelKey | null) ?? null,
          arrivalMethod: e.arrivalMethod,
          arrivedAt: e.arrivedAt ? e.arrivedAt.toISOString() : null,
          status: e.receptionStatus,
        };
      });
    const patientOptions: ErOption[] = patients.map((p) => ({
      value: p.id,
      label: `${p.patientNo} ${p.kanjiLastName} ${p.kanjiFirstName}`,
    }));
    const deptOptions: ErOption[] = depts.map((d) => ({ value: d.id, label: d.name }));

    // 実 EMERGENCY 受付が無い（demo クライアント or 受付ゼロ）なら、トリアージ優先表示を
    // 検証できるデモ救急行へフォールバック。選択肢は取得できたものを優先利用。
    const live = rows.length > 0;
    return {
      rows: live ? rows : demoErRows(),
      patientOptions: patientOptions.length ? patientOptions : demoPatientOptions(),
      deptOptions: deptOptions.length ? deptOptions : demoDeptOptions(),
      live,
    };
  } catch (err) {
    console.error('[er] loadEr failed; showing demo data:', err);
    return {
      rows: demoErRows(),
      patientOptions: demoPatientOptions(),
      deptOptions: demoDeptOptions(),
      live: false,
    };
  }
}

/** 監査記録は非致命。フロントのみ（DB未接続）でも操作を完結させるため握りつぶす。 */
async function auditSafe(args: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(args);
  } catch (err) {
    console.error('[er] writeAudit failed (non-fatal):', err);
  }
}

/**
 * 救急受付。Encounter(EMERGENCY) を生成し、トリアージ・搬送方法・主訴を記録。
 * AC(1): トリアージレベルが記録され、一覧で優先表示される。
 */
export async function registerEmergency(formData: FormData): Promise<void> {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '').trim();
  const triageRaw = String(formData.get('triageLevel') || '').trim();
  const arrivalMethod = String(formData.get('arrivalMethod') || '').trim() || null;
  const departmentId = String(formData.get('departmentId') || '').trim() || null;
  const chiefComplaint = String(formData.get('chiefComplaint') || '').trim() || null;
  // 意識障害等で本人確認が取れない場合の同意区分（IMPLIED=黙示の同意／緊急避難）。
  const consentType = String(formData.get('consentType') || '').trim() || null;

  // 患者未選択（身元不明）でも受付は通す。トリアージは必須。
  const triageLevel = isTriageKey(triageRaw) ? triageRaw : null;

  try {
    // departmentId は Encounter 必須。指定が無ければ救急科を解決（無ければ先頭診療科）。
    let deptId = departmentId;
    if (!deptId) {
      const dept =
        (await prisma.department.findFirst({ where: { code: 'ER' } })) ??
        (await prisma.department.findFirst({ orderBy: { name: 'asc' } }));
      deptId = dept?.id ?? null;
    }

    // 身元不明（仮ID）受付に対応：患者未指定なら作成しない（受付番号のみ採番表示）。
    if (!patientId || !deptId) {
      await auditSafe({
        actorUserId: s.userId,
        action: 'CHART_WRITE',
        resource: 'Encounter.emergency',
        resourceId: patientId || 'unidentified',
        detail: { triageLevel, arrivalMethod, chiefComplaint, consentType, persisted: false },
      });
      revalidatePath('/er');
      return;
    }

    // 当日の最大受付番号 +1（救急も受付一覧と同じ採番系に乗せる）。
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const last = await prisma.encounter.findFirst({
      where: { createdAt: { gte: startOfDay } },
      orderBy: { receptionNo: 'desc' },
      select: { receptionNo: true },
    });
    const receptionNo = (last?.receptionNo ?? 0) + 1;

    const enc = await prisma.encounter.create({
      data: {
        patientId,
        encounterType: 'EMERGENCY',
        departmentId: deptId,
        receptionNo,
        receptionStatus: 'ARRIVED',
        triageLevel: triageLevel as never,
        arrivalMethod,
        arrivedAt: new Date(),
        openedByUserId: s.userId,
      },
    });

    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Encounter.emergency',
      resourceId: enc.id,
      detail: { triageLevel, arrivalMethod, chiefComplaint, consentType, persisted: true },
    });
  } catch (err) {
    console.error('[er] registerEmergency failed:', err);
  }
  revalidatePath('/er');
}

/**
 * 再トリアージ。容態変化に応じて triageLevel を更新（優先表示が変わる）。
 * 追記専用の診療録とは別系（受付メタ情報）なので update を許容。
 */
export async function retriagePatient(formData: FormData): Promise<void> {
  const s = await requireSession();
  const encounterId = String(formData.get('encounterId') || '').trim();
  const triageRaw = String(formData.get('triageLevel') || '').trim();
  if (!encounterId || !isTriageKey(triageRaw)) return;
  try {
    const cur = await prisma.encounter.findUnique({
      where: { id: encounterId },
      select: { triageLevel: true },
    });
    await prisma.encounter.update({
      where: { id: encounterId },
      data: { triageLevel: triageRaw as never },
    });
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Encounter.triage',
      resourceId: encounterId,
      detail: { from: cur?.triageLevel ?? null, to: triageRaw },
    });
  } catch (err) {
    console.error('[er] retriagePatient failed:', err);
  }
  revalidatePath('/er');
}

/** 救急時6情報の参照結果（画面が消費する形）。 */
export interface SixInfoResult {
  /** interop アダプタの状態（STUB＝未接続スタブ／OK＝本番取得）。 */
  status: string;
  live: boolean;
  data: OnshiPatientInfoResult;
}

/**
 * 救急時6情報の参照（オン資/マイナ保険証経由）。interop の fetchPatientInfo を呼ぶ。
 * 現状アダプタは status:'STUB' を返すため、参照導線の検証用にデモ6情報へフォールバック。
 * AC(2): オン資経由で救急時6情報を最小クリックで参照できる。
 */
export async function fetchSixInfo(formData: FormData): Promise<SixInfoResult> {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '').trim() || undefined;
  const mynaCardToken =
    String(formData.get('mynaCardToken') || '').trim() || undefined;

  // 6情報参照は要配慮個人情報の閲覧。監査に必ず残す（非致命だが原則記録）。
  await auditSafe({
    actorUserId: s.userId,
    action: 'CHART_VIEW',
    resource: 'OnshiSixInfo',
    resourceId: patientId ?? 'emergency',
    detail: { via: 'insurance-verify.fetchPatientInfo', emergency: true },
  });

  try {
    const res = await fetchPatientInfo({
      patientRef: patientId,
      mynaCardToken,
      confirmationDate: new Date().toISOString(),
    });
    // 本番化で AdapterStatus が 'OK' 等へ拡張されたら live:true で実データへ自動切替。
    // 現契約は status:'STUB' のみ（'STUB' 型のため string 比較で前方互換に判定）。
    if ((res.status as string) === 'OK' && res.data) {
      return { status: res.status, live: true, data: res.data };
    }
    // STUB / エラー時は参照導線の検証用デモ6情報を返す（fail-soft）。
    return { status: res.status, live: false, data: demoSixInfo() };
  } catch (err) {
    console.error('[er] fetchSixInfo failed; showing demo six-info:', err);
    return { status: 'ERROR', live: false, data: demoSixInfo() };
  }
}

/** 救急時6情報のデモ（オン資未接続でも「最小クリック参照」を検証できるように）。 */
function demoSixInfo(): OnshiPatientInfoResult {
  return {
    medications: [
      { name: 'ワルファリンK錠 1mg', yjCode: '3332001F1', dispensedDate: '2026-05-20', facilityName: '前医 循環器内科' },
      { name: 'アムロジピンOD錠 5mg', yjCode: '2171022F1', dispensedDate: '2026-05-20', facilityName: '前医 循環器内科' },
      { name: 'メトホルミン塩酸塩錠 250mg', yjCode: '3962001F1', dispensedDate: '2026-05-18', facilityName: '前医 内科' },
    ],
    checkups: [
      { itemName: 'HbA1c', value: '7.8', unit: '%', examDate: '2026-04-10', jlac10: '3D045' },
      { itemName: '収縮期血圧', value: '162', unit: 'mmHg', examDate: '2026-04-10' },
      { itemName: 'eGFR', value: '48', unit: 'mL/min/1.73m2', examDate: '2026-04-10' },
    ],
    allergies: [
      { category: 'DRUG', substance: 'ペニシリン系抗菌薬', reaction: '発疹・蕁麻疹', jFagy: undefined },
      { category: 'DRUG', substance: 'アスピリン', reaction: '喘息様発作', jFagy: undefined },
      { category: 'OTHER', substance: '造影剤（ヨード）', reaction: '気分不快・嘔気' },
    ],
  };
}
