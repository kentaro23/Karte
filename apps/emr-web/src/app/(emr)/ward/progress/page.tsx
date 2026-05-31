import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Icon, Button, Field, Input, EmptyState, Badge } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { addProgress } from '../actions';
import { VitalsChart, type VitalPoint } from './vitals-chart';

// 受付/カルテ同様、Prisma を読むため明示的に動的化。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

type ProgressRow = { id: string; body: string; createdAt: Date };
type Inpatient = { id: string; patientId: string; name: string; age: number };

function parseVitals(body: string, at: Date): VitalPoint {
  const num = (re: RegExp) => {
    const m = re.exec(body);
    return m ? Number(m[1]) : undefined;
  };
  const bp = /血圧\s*(\d+)\s*\/\s*(\d+)/.exec(body);
  return {
    at: at.toISOString(),
    temp: num(/体温\s*([\d.]+)/),
    pulse: num(/脈\s*(\d+)/),
    spo2: num(/SpO2\s*(\d+)/),
    sys: bp ? Number(bp[1]) : undefined,
    dia: bp ? Number(bp[2]) : undefined,
  };
}

// ── デモ（DB未接続）用の決定論サンプル ──────────────────────────────────────
const DEMO_INPATIENTS: Inpatient[] = [
  { id: 'demo-enc-1', patientId: 'demo-pat-1', name: '見本 太郎', age: 58 },
  { id: 'demo-enc-2', patientId: 'demo-pat-2', name: '試験 花子', age: 72 },
];

/** 決定論の熱型サンプル（24h おき・3日分）。DB未接続でも温度板が描ける。 */
function demoRecords(patientId: string): ProgressRow[] {
  const base = patientId === 'demo-pat-2' ? 37.8 : 36.6;
  const day = 86_400_000;
  const now = Date.now();
  const seq = [
    { dt: 4 * day, t: base + 1.2, p: 96, s: 138, d: 84, o: 95 },
    { dt: 3 * day, t: base + 0.8, p: 92, s: 132, d: 80, o: 96 },
    { dt: 2 * day, t: base + 0.3, p: 84, s: 126, d: 78, o: 97 },
    { dt: 1 * day, t: base + 0.1, p: 78, s: 122, d: 76, o: 98 },
    { dt: 0, t: base, p: 72, s: 118, d: 74, o: 98 },
  ];
  return seq.map((r, i) => ({
    id: `demo-prog-${patientId}-${i}`,
    createdAt: new Date(now - r.dt),
    body: `体温${r.t.toFixed(1)}℃ / 血圧${r.s}/${r.d} / 脈${r.p} / SpO2 ${r.o}% / 記録: 全身状態安定`,
  }));
}

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const sp = await searchParams;
  const patientId = sp.patientId ?? '';

  // 入院患者一覧（DB無時はデモ）。
  let inpatients: Inpatient[] = DEMO_INPATIENTS;
  let dbDown = false;
  try {
    const es = await prisma.encounter.findMany({
      where: { encounterType: 'INPATIENT', receptionStatus: { not: 'BILLING_DONE' } },
      include: { patient: true },
    });
    if (es.length > 0) {
      inpatients = es.map((e) => ({
        id: e.id,
        patientId: e.patientId,
        name: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
        age: age(e.patient.dateOfBirth),
      }));
    } else {
      // 在院ゼロでも患者が居れば一覧に出す（デモ運用の利便）。実DBで在院ゼロは空にする。
      inpatients = [];
    }
  } catch (err) {
    console.error('[ProgressPage] inpatient list failed, using demo:', err);
    dbDown = true;
  }

  const selected = inpatients.find((e) => e.patientId === patientId) ?? null;

  // 選択患者の経過記録（DB無時はデモ熱型）。
  let records: ProgressRow[] = [];
  let recordsAreDemo = false;
  if (patientId) {
    try {
      const docs = await prisma.clinicalDocument.findMany({
        where: { patientId, docType: '経過記録' },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      records = docs.map((r) => ({ id: r.id, body: r.body ?? '', createdAt: r.createdAt }));
      if (records.length === 0 && patientId.startsWith('demo-')) {
        records = demoRecords(patientId);
        recordsAreDemo = true;
      }
    } catch (err) {
      console.error('[ProgressPage] records failed, demo fallback:', err);
      dbDown = true;
      records = demoRecords(patientId || 'demo-pat-1');
      recordsAreDemo = true;
    }
  }

  const points = records.map((r): VitalPoint => parseVitals(r.body, r.createdAt));
  const hasVitals = points.some((p) => p.temp != null || p.pulse != null || p.sys != null || p.spo2 != null);

  return (
    <PageBody>
      <PageHeader
        title="経過表・熱型表"
        desc="バイタル記録（体温・血圧・脈拍・SpO2）の温度板グラフと経過（FR-WRD-02 / 174項 120）"
        crumbs={['Medixus カルテ', '病棟', '経過表']}
      />
      {dbDown && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB未接続）：記録の保存は無効です。温度板グラフと経過表の UI を提示します。
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        <Panel>
          <PanelHeader title="入院患者" icon={<Icon name="bed" size={15} />} />
          {inpatients.length === 0 ? (
            <p className="text-xs text-muted">在院患者なし</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {inpatients.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/ward/progress?patientId=${e.patientId}`}
                    className={`block rounded px-2 py-1.5 text-xs hover:bg-soft ${
                      selected?.patientId === e.patientId ? 'bg-accent-50 font-semibold text-accent-700' : ''
                    }`}
                  >
                    {e.name}（{e.age}）
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {!selected ? (
          <Panel>
            <EmptyState
              title="入院患者を選択してください"
              hint="左の一覧から患者を選ぶとバイタルの温度板グラフと経過表が表示されます"
              icon={<Icon name="chart" size={32} />}
            />
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader
                title="熱型表（体温・脈拍・血圧・SpO2）"
                icon={<Icon name="chart" size={15} />}
                desc="経過記録からバイタルを自動グラフ化（温度板）"
                actions={
                  recordsAreDemo ? <Badge tone="gray">サンプル波形</Badge> : undefined
                }
              />
              {!hasVitals ? (
                <EmptyState title="バイタル記録がありません（下のフォームから入力）" />
              ) : (
                <VitalsChart points={points} />
              )}
            </Panel>
            <Panel>
              <PanelHeader title="バイタル記録" icon={<Icon name="plus" size={15} />} />
              <form action={addProgress} className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <input type="hidden" name="patientId" value={selected.patientId} />
                <Field label="体温℃">
                  <Input name="temp" type="number" step="0.1" />
                </Field>
                <Field label="血圧">
                  <Input name="bp" placeholder="120/80" />
                </Field>
                <Field label="脈拍">
                  <Input name="pulse" type="number" />
                </Field>
                <Field label="SpO2%">
                  <Input name="spo2" type="number" />
                </Field>
                <div className="flex items-end">
                  <Button type="submit" variant="primary" className="w-full justify-center" disabled={dbDown}>
                    記録
                  </Button>
                </div>
                <Field label="記事" className="col-span-2 md:col-span-5">
                  <Input name="note" />
                </Field>
              </form>
            </Panel>
            <Panel>
              <PanelHeader title="経過記録" icon={<Icon name="chart" size={15} />} />
              {records.length === 0 ? (
                <EmptyState title="記録がありません" />
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {records.map((r) => (
                    <li key={r.id} className="py-2">
                      <div className="text-2xs text-muted">
                        {r.createdAt.toLocaleString('ja-JP')}
                      </div>
                      <div>{r.body}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </div>
    </PageBody>
  );
}
