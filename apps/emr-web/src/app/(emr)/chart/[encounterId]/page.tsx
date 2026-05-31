import { notFound } from 'next/navigation';
import { prisma } from '@medixus/db';
import { age, emptySoap, ORDER_TYPE_LABEL, type OrderType, type SoapBlock } from '@medixus/domain';
import { PatientBar, type PatientBarData } from '@medixus/ui';
import { requireSession } from '@/lib/session';
import { ChartWorkspace } from './workspace';
import type { PastEntry, PastOrder } from './history-panel';

// EMR routes already render dynamically (cookies/session). The chart page also
// reads heavily from Prisma; keep it explicit so the build never needs a live
// DATABASE_URL and so DB-less previews still render the demo workspace.
export const dynamic = 'force-dynamic';

type Drug = {
  id: string;
  brandName: string;
  genericName: string | null;
  strengthUnit: string | null;
  administrationRoute: string;
};

/** 1件のオーダ detail JSON から一覧表示用サマリを組み立てる（種別ごとに最善努力）。 */
function orderSummary(orderType: string, detail: unknown): string {
  const d = (detail ?? {}) as Record<string, unknown>;
  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
  if (items.length > 0) {
    const names = items
      .map((it) => (it.drugName ?? it.name ?? it.examName ?? '') as string)
      .filter(Boolean);
    if (names.length > 0) return names.join('、');
  }
  if (typeof d.summary === 'string' && d.summary) return d.summary;
  if (typeof d.name === 'string' && d.name) return d.name;
  return ORDER_TYPE_LABEL[orderType as OrderType] ?? orderType;
}

const DEMO_PATIENT: PatientBarData = {
  patientId: 'demo-pat',
  patientNo: '000123',
  name: '見本 太郎',
  kana: 'ミホン タロウ',
  gender: '男性',
  age: 58,
  inout: '外来',
  ward: null,
  mode: 'カルテ記述',
  allergies: ['ペニシリン系'],
  infections: [],
  isVip: false,
};

const DEMO_DRUGS: Drug[] = [
  { id: 'd1', brandName: 'アムロジピンOD錠5mg', genericName: 'アムロジピンベシル酸塩', strengthUnit: '錠', administrationRoute: '経口' },
  { id: 'd2', brandName: 'カロナール錠500', genericName: 'アセトアミノフェン', strengthUnit: '錠', administrationRoute: '経口' },
  { id: 'd3', brandName: 'メトホルミン錠250mgMT', genericName: 'メトホルミン塩酸塩', strengthUnit: '錠', administrationRoute: '経口' },
];

const DEMO_PAST: PastEntry[] = [
  {
    date: new Date(Date.now() - 14 * 864e5).toISOString(),
    noteId: 'demo-n1',
    version: 1,
    status: 'LOCKED',
    blocks: [
      { kind: 'S', spans: [{ text: '自覚症状なし。服薬継続中。' }] },
      { kind: 'O', spans: [{ text: '血圧 138/84 mmHg、脈 72/分。浮腫なし。' }] },
      { kind: 'A', spans: [{ text: '本態性高血圧、コントロール概ね良好。' }] },
      { kind: 'P', spans: [{ text: '同処方継続。家庭血圧記録。1ヶ月後再診。' }] },
    ],
    orders: [
      { id: 'demo-o1', orderType: 'RX', orderTypeLabel: '処方', status: 'doctor_confirmed', summary: 'アムロジピンOD錠5mg 1×1×28日' },
      { id: 'demo-o2', orderType: 'LAB', orderTypeLabel: '検体検査', status: 'APPROVED', summary: '生化学一般・HbA1c' },
    ],
  },
  {
    date: new Date(Date.now() - 42 * 864e5).toISOString(),
    noteId: 'demo-n2',
    version: 2,
    status: 'LOCKED',
    blocks: [
      { kind: 'S', spans: [{ text: '時々ふらつき。' }] },
      { kind: 'O', spans: [{ text: '血圧 146/90 mmHg。' }] },
      { kind: 'A', spans: [{ text: '降圧不十分。' }] },
      { kind: 'P', spans: [{ text: 'アムロジピン 2.5→5mg へ増量。' }] },
    ],
    orders: [{ id: 'demo-o3', orderType: 'RX', orderTypeLabel: '処方', status: 'doctor_confirmed', summary: 'アムロジピンOD錠5mg 1×1×28日' }],
  },
];

/** DB が利用可能なら実データ束を返す。接続不能時は throw（呼び元でデモ描画）。 */
async function loadChartData(encounterId: string) {
  const enc = await prisma.encounter.findUnique({
    where: { id: encounterId },
    include: {
      patient: { include: { allergies: true, infections: true, profile: true } },
    },
  });
  // DB は生きているが該当エンカウンタが無い場合だけ 404。
  if (!enc) return { kind: 'notfound' as const };

  const dept = await prisma.department.findUnique({ where: { id: enc.departmentId } });
  const ward = enc.wardId ? await prisma.ward.findUnique({ where: { id: enc.wardId } }) : null;

  const notes = await prisma.clinicalNote.findMany({
    where: { encounterId },
    orderBy: [{ createdAt: 'desc' }],
  });
  const latest = notes.find((n) => n.isLatest && n.noteType === 'PROGRESS');

  const drugs = await prisma.drugProduct.findMany({
    orderBy: { brandName: 'asc' },
    take: 30000,
    select: {
      id: true,
      brandName: true,
      genericName: true,
      strengthUnit: true,
      administrationRoute: true,
    },
  });

  // ── 病名(ICD10) → 適応薬リコメンド ──
  const activeDx = await prisma.patientDiagnosis.findMany({
    where: { patientId: enc.patient.id, status: 'ACTIVE' },
    orderBy: [{ isMain: 'desc' }, { startDate: 'desc' }],
    select: {
      id: true,
      displayName: true,
      icd10: true,
      isMain: true,
      isSuspected: true,
      masterCode: true,
    },
  });
  const icd10s = [...new Set(activeDx.map((d) => d.icd10).filter((x): x is string => !!x))];
  const icd10ToDx = new Map(activeDx.filter((d) => d.icd10).map((d) => [d.icd10!, d.displayName]));
  let recommended: { id: string; dx: string }[] = [];
  if (icd10s.length) {
    const inds = await prisma.drugIndication.findMany({
      where: { validTo: null, icd10Codes: { hasSome: icd10s } },
      select: { targetKind: true, targetId: true, icd10Codes: true },
    });
    const ingIds = inds.filter((i) => i.targetKind === 'INGREDIENT').map((i) => i.targetId);
    const ingReason = new Map<string, string>();
    for (const i of inds)
      if (i.targetKind === 'INGREDIENT')
        ingReason.set(
          i.targetId,
          icd10ToDx.get(i.icd10Codes.find((c) => icd10s.includes(c)) ?? '') ?? '適応',
        );
    const links = ingIds.length
      ? await prisma.drugProductIngredient.findMany({
          where: { ingredientId: { in: ingIds } },
          select: { drugProductId: true, ingredientId: true },
        })
      : [];
    const seen = new Map<string, string>();
    for (const l of links)
      if (!seen.has(l.drugProductId))
        seen.set(l.drugProductId, ingReason.get(l.ingredientId) ?? '適応');
    for (const i of inds)
      if (i.targetKind === 'PRODUCT' && !seen.has(i.targetId))
        seen.set(i.targetId, '適応');
    recommended = [...seen.entries()].map(([id, dx]) => ({ id, dx }));
  }

  const prescriptions = await prisma.prescription.findMany({
    where: { encounterId },
    orderBy: { createdAt: 'desc' },
    include: {
      items: { include: { drug: { select: { brandName: true } } } },
      checks: { orderBy: { createdAt: 'desc' } },
      overrides: true,
    },
  });

  // ── 過去カルテ参照（縦/横）・セクションDo 用データ ──
  // 患者の最新版ノート（全エンカウンタ横断・確定/保存済）を日付降順で。
  const pastNotes = await prisma.clinicalNote.findMany({
    where: { patientId: enc.patient.id, isLatest: true, noteType: 'PROGRESS' },
    orderBy: [{ recordedDate: 'desc' }],
    take: 30,
    select: { id: true, recordedDate: true, version: true, status: true, blocks: true },
  });
  const pastOrders = await prisma.order.findMany({
    where: { patientId: enc.patient.id, isLatest: true },
    orderBy: [{ createdAt: 'desc' }],
    take: 120,
    select: { id: true, orderType: true, status: true, detail: true, createdAt: true },
  });
  const pastEntries = buildPastEntries(pastNotes, pastOrders);

  return {
    kind: 'ok' as const,
    enc,
    dept,
    ward,
    notes,
    latest,
    drugs,
    recommended,
    activeDx,
    prescriptions,
    pastEntries,
  };
}

/** 最新ノート + オーダを「記録日（日単位）」でまとめ、過去カルテエントリへ整形。 */
function buildPastEntries(
  notes: { id: string; recordedDate: Date; version: number; status: string; blocks: unknown }[],
  orders: { id: string; orderType: string; status: string; detail: unknown; createdAt: Date }[],
): PastEntry[] {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const map = new Map<string, PastEntry>();

  for (const n of notes) {
    const key = dayKey(n.recordedDate);
    if (!map.has(key)) {
      map.set(key, {
        date: n.recordedDate.toISOString(),
        noteId: n.id,
        version: n.version,
        status: n.status,
        blocks: (n.blocks as unknown as SoapBlock[]) ?? emptySoap(),
        orders: [],
      });
    }
  }
  for (const o of orders) {
    const key = dayKey(o.createdAt);
    let entry = map.get(key);
    if (!entry) {
      entry = { date: o.createdAt.toISOString(), noteId: null, version: 0, status: '', blocks: emptySoap(), orders: [] };
      map.set(key, entry);
    }
    const po: PastOrder = {
      id: o.id,
      orderType: o.orderType,
      orderTypeLabel: ORDER_TYPE_LABEL[o.orderType as OrderType] ?? o.orderType,
      status: o.status,
      summary: orderSummary(o.orderType, o.detail),
    };
    entry.orders.push(po);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export default async function ChartPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  await requireSession();
  const { encounterId } = await params;

  let data: Awaited<ReturnType<typeof loadChartData>> | null = null;
  try {
    data = await loadChartData(encounterId);
  } catch (err) {
    // DB 未接続・到達不能時はデモ描画にフォールバック（画面は必ず出す）。
    console.error('[ChartPage] DB load failed, rendering demo workspace:', err);
    data = null;
  }

  if (data?.kind === 'notfound') notFound();

  // ── フロントのみ（DB無）: デモワークスペースを描画 ──
  if (!data || data.kind !== 'ok') {
    return (
      <div>
        <PatientBar p={DEMO_PATIENT} />
        <div className="border-b border-amber-300 bg-amber-50 px-3 py-1 text-2xs text-warn">
          デモ表示（DB未接続）：保存等の操作は無効です。
        </div>
        <ChartWorkspace
          encounterId={encounterId}
          patientId={DEMO_PATIENT.patientId}
          deptName="内科"
          latestNote={null}
          initialBlocks={emptySoap()}
          history={[]}
          drugs={DEMO_DRUGS}
          recommended={[]}
          diagnoses={[
            { id: 'dx1', displayName: '本態性高血圧症', icd10: 'I10', isMain: true, isSuspected: false, fromMaster: true },
            { id: 'dx2', displayName: '2型糖尿病', icd10: 'E119', isMain: false, isSuspected: false, fromMaster: true },
          ]}
          prescriptions={[]}
          pastEntries={DEMO_PAST}
        />
      </div>
    );
  }

  const { enc, dept, ward, notes, latest, drugs, recommended, activeDx, prescriptions, pastEntries } = data;

  const p = enc.patient;
  const bar: PatientBarData = {
    patientId: p.id,
    patientNo: p.patientNo,
    name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
    kana: `${p.kanaLastName} ${p.kanaFirstName}`,
    gender: p.gender === 'MALE' ? '男性' : p.gender === 'FEMALE' ? '女性' : '—',
    age: age(p.dateOfBirth),
    inout: enc.encounterType === 'INPATIENT' ? '入院' : '外来',
    ward: ward?.name ?? null,
    mode: 'カルテ記述',
    allergies: p.allergies.map((a) => a.substance),
    infections: p.infections.map((i) => `${i.pathogen}(${i.status})`),
    isVip: p.isVip,
  };

  const initialBlocks: SoapBlock[] =
    (latest?.blocks as unknown as SoapBlock[] | undefined) ?? emptySoap();

  return (
    <div>
      <PatientBar p={bar} />
      <ChartWorkspace
        encounterId={encounterId}
        patientId={enc.patient.id}
        deptName={dept?.name ?? '—'}
        latestNote={
          latest
            ? { id: latest.id, version: latest.version, status: latest.status }
            : null
        }
        initialBlocks={initialBlocks}
        history={notes.map((n) => ({
          id: n.id,
          version: n.version,
          status: n.status,
          isLatest: n.isLatest,
          noteType: n.noteType,
          recordedDate: n.recordedDate.toISOString(),
          amendReason: n.amendReason,
          blocks: n.blocks as unknown as SoapBlock[],
        }))}
        drugs={drugs}
        recommended={recommended}
        diagnoses={activeDx.map((d) => ({
          id: d.id,
          displayName: d.displayName,
          icd10: d.icd10,
          isMain: d.isMain,
          isSuspected: d.isSuspected,
          fromMaster: !!d.masterCode,
        }))}
        prescriptions={prescriptions.map((rx) => ({
          id: rx.id,
          status: rx.status,
          items: rx.items.map((it) => ({
            drugName: it.drug.brandName,
            dosePerTime: it.dosePerTime,
            doseUnit: it.doseUnit,
            timesPerDay: it.timesPerDay,
            days: it.days,
          })),
          checks: rx.checks.map((c) => ({
            id: c.id,
            checkType: c.checkType,
            result: c.result,
            severityNote: c.severityNote,
            runId: (c.details as { runId?: string })?.runId ?? '',
          })),
          overrides: rx.overrides.map((o) => o.ruleCheckResultId),
        }))}
        pastEntries={pastEntries}
      />
    </div>
  );
}
