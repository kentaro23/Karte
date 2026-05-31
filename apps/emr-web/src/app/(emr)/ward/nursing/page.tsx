import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Icon, Button, Field, Input, EmptyState, Badge } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { addNursing } from '../actions';
import { addNursingPlan, addPressureUlcerScore } from './actions';
import { NURSING_PLAN_DOCTYPE, PRESSURE_ULCER_DOCTYPE } from './constants';

// 受付/カルテ同様、Prisma を読むため明示的に動的化。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

type DocRow = { id: string; title: string; body: string; createdAt: Date };
type Inpatient = { id: string; patientId: string; name: string; age: number };

// ── デモ（DB未接続）用の決定論サンプル ──────────────────────────────────────
const DEMO_INPATIENTS: Inpatient[] = [
  { id: 'demo-enc-1', patientId: 'demo-pat-1', name: '見本 太郎', age: 58 },
  { id: 'demo-enc-2', patientId: 'demo-pat-2', name: '試験 花子', age: 72 },
];

function demoNursing(patientId: string): DocRow[] {
  const day = 86_400_000;
  const now = Date.now();
  return [
    {
      id: `demo-nrs-${patientId}-1`,
      title: '看護記録',
      createdAt: new Date(now - 1 * day),
      body: '【フォーカス】疼痛コントロール\nO: NRS 4/10、創部発赤なし。A: 鎮痛薬で軽減。P: 体動時の予防投与を継続。',
    },
    {
      id: `demo-nrs-${patientId}-2`,
      title: '看護記録',
      createdAt: new Date(now - 2 * day),
      body: '【フォーカス】離床\nO: 端座位2分保持可。A: ふらつき軽度。P: 明日より歩行器歩行を試行。',
    },
  ];
}

function demoPlan(patientId: string): DocRow[] {
  return [
    {
      id: `demo-plan-${patientId}-1`,
      title: '看護計画',
      createdAt: new Date(Date.now() - 3 * 86_400_000),
      body: '【看護診断/問題】\n急性疼痛（術後創部痛に関連した）\n\n【期待される成果（目標）】\nNRS 3以下で日常生活動作が行える\n\n【看護介入（O-T-E）】\nO:疼痛の程度・性状を定期観察 T:指示薬の確実な与薬 E:疼痛時は早めの報告を指導\n\n【評価】\n離床時痛は残存も安静時は軽減。計画継続。',
    },
  ];
}

function demoUlcer(patientId: string): DocRow[] {
  return [
    {
      id: `demo-pu-${patientId}-1`,
      title: '褥瘡DESIGN-R 6点',
      createdAt: new Date(Date.now() - 2 * 86_400_000),
      body: '部位: 仙骨部\n合計（Depth除く）: 6 点\n\nDepth 深さ: d2（0）\nExudate 滲出液: e1（1）\nSize 大きさ: s3（3）\nInflammation 炎症/感染: i0（0）\nGranulation 肉芽組織: g1（1）\nNecrotic tissue 壊死組織: n0（0）\nPocket ポケット: p1（1）',
    },
  ];
}

/** docType 別に追記履歴を読む。DB無/未登録かつデモ患者ならサンプルを返す。 */
async function loadDocs(
  patientId: string,
  docType: string,
  demo: (pid: string) => DocRow[],
): Promise<{ rows: DocRow[]; demo: boolean; dbDown: boolean }> {
  try {
    const docs = await prisma.clinicalDocument.findMany({
      where: { patientId, docType },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const rows: DocRow[] = docs.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body ?? '',
      createdAt: r.createdAt,
    }));
    if (rows.length === 0 && patientId.startsWith('demo-')) {
      return { rows: demo(patientId), demo: true, dbDown: false };
    }
    return { rows, demo: false, dbDown: false };
  } catch (err) {
    console.error(`[NursingPage] load ${docType} failed, demo fallback:`, err);
    return { rows: demo(patientId || 'demo-pat-1'), demo: true, dbDown: true };
  }
}

/** 追記履歴のリスト（追記専用：最新が上、過去版も残す）。 */
function HistoryList({ rows }: { rows: DocRow[] }) {
  if (rows.length === 0) return <EmptyState title="記録がありません" />;
  return (
    <ul className="divide-y divide-line text-sm">
      {rows.map((r) => (
        <li key={r.id} className="py-2">
          <div className="text-2xs text-muted">{r.createdAt.toLocaleString('ja-JP')}</div>
          <div className="whitespace-pre-wrap">{r.body}</div>
        </li>
      ))}
    </ul>
  );
}

export default async function NursingPage({
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
    inpatients =
      es.length > 0
        ? es.map((e) => ({
            id: e.id,
            patientId: e.patientId,
            name: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
            age: age(e.patient.dateOfBirth),
          }))
        : [];
  } catch (err) {
    console.error('[NursingPage] inpatient list failed, using demo:', err);
    dbDown = true;
  }

  const selected = inpatients.find((e) => e.patientId === patientId) ?? null;

  // 看護記録・看護計画・褥瘡DESIGN-R の追記履歴。
  type Loaded = Awaited<ReturnType<typeof loadDocs>>;
  const empty: Loaded = { rows: [], demo: false, dbDown: false };
  let nursing: Loaded = empty;
  let plans: Loaded = empty;
  let ulcers: Loaded = empty;
  if (patientId) {
    [nursing, plans, ulcers] = await Promise.all([
      loadDocs(patientId, '看護記録', demoNursing),
      loadDocs(patientId, NURSING_PLAN_DOCTYPE, demoPlan),
      loadDocs(patientId, PRESSURE_ULCER_DOCTYPE, demoUlcer),
    ]);
    if (nursing.dbDown || plans.dbDown || ulcers.dbDown) dbDown = true;
  }

  const anyDemo = nursing.demo || plans.demo || ulcers.demo;

  return (
    <PageBody>
      <PageHeader
        title="看護記録・看護計画"
        desc="看護記録（追記専用）、看護計画、褥瘡DESIGN-R（FR-WRD-02 / 174項 121-125）"
        crumbs={['Medixus カルテ', '病棟', '看護記録']}
      />
      {(dbDown || anyDemo) && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB未接続/未登録）：保存は無効です。追記専用の看護記録・看護計画・褥瘡DESIGN-R の UI を提示します。
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
                    href={`/ward/nursing?patientId=${e.patientId}`}
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
              hint="左の一覧から患者を選ぶと看護記録・看護計画・褥瘡DESIGN-R が表示されます"
              icon={<Icon name="teach" size={32} />}
            />
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            {/* 看護記録（追記専用） */}
            <Panel>
              <PanelHeader
                title="看護記録 入力（SOAP/フォーカス）"
                icon={<Icon name="plus" size={15} />}
                actions={<Badge tone="blue">追記専用</Badge>}
              />
              <form action={addNursing} className="flex flex-col gap-3">
                <input type="hidden" name="patientId" value={selected.patientId} />
                <Field label="フォーカス">
                  <Input name="titleFocus" placeholder="例: 疼痛コントロール" />
                </Field>
                <Field label="記録（O-A-P / 経過）">
                  <textarea
                    name="body"
                    rows={5}
                    className="rounded border border-line px-2.5 py-1.5 text-sm"
                    placeholder="観察事項・実施・評価を記載"
                  />
                </Field>
                <Button type="submit" variant="primary" disabled={dbDown}>
                  看護記録を保存
                </Button>
                <p className="text-2xs text-muted/70">
                  ※ 保存後は修正で上書きせず、追記（新しい記録）で経過を残します（電子保存の三原則・真正性）。
                </p>
              </form>
            </Panel>
            <Panel>
              <PanelHeader title="看護記録 履歴（追記専用）" icon={<Icon name="teach" size={15} />} />
              <HistoryList rows={nursing.rows} />
            </Panel>

            {/* 看護計画 */}
            <Panel>
              <PanelHeader title="看護計画 立案・更新" icon={<Icon name="board" size={15} />} />
              <form action={addNursingPlan} className="flex flex-col gap-3">
                <input type="hidden" name="patientId" value={selected.patientId} />
                <Field label="看護診断 / 問題">
                  <Input name="diagnosis" placeholder="例: 急性疼痛（術後創部痛に関連した）" />
                </Field>
                <Field label="期待される成果（目標）">
                  <Input name="goal" placeholder="例: NRS 3以下で ADL が行える" />
                </Field>
                <Field label="看護介入（O-T-E）">
                  <textarea
                    name="intervention"
                    rows={3}
                    className="rounded border border-line px-2.5 py-1.5 text-sm"
                    placeholder="O: 観察 / T: 援助 / E: 教育・指導"
                  />
                </Field>
                <Field label="評価">
                  <Input name="evaluation" placeholder="例: 安静時痛は軽減。計画継続。" />
                </Field>
                <Button type="submit" variant="secondary" disabled={dbDown}>
                  看護計画を保存
                </Button>
              </form>
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1.5 text-2xs font-bold text-muted">立案・評価の履歴（追記専用）</div>
                <HistoryList rows={plans.rows} />
              </div>
            </Panel>

            {/* 褥瘡 DESIGN-R */}
            <Panel>
              <PanelHeader
                title="褥瘡 DESIGN-R®2020 評価"
                icon={<Icon name="warning" size={15} />}
                desc="重症度コードと点数を記録。合計は Depth を除く 6 項目（通則）"
              />
              <form action={addPressureUlcerScore} className="flex flex-col gap-3">
                <input type="hidden" name="patientId" value={selected.patientId} />
                <Field label="部位">
                  <Input name="site" placeholder="例: 仙骨部 / 踵部" />
                </Field>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {[
                    { code: 'depth', score: 'depthScore', label: 'Depth 深さ', ph: 'd0〜D5', sc: '0' },
                    { code: 'exudate', score: 'exudateScore', label: 'Exudate 滲出液', ph: 'e0〜E6', sc: '0' },
                    { code: 'size', score: 'sizeScore', label: 'Size 大きさ', ph: 's0〜S15', sc: '0' },
                    { code: 'inflammation', score: 'inflammationScore', label: 'Inflammation 炎症/感染', ph: 'i0〜I9', sc: '0' },
                    { code: 'granulation', score: 'granulationScore', label: 'Granulation 肉芽', ph: 'g0〜G6', sc: '0' },
                    { code: 'necrotic', score: 'necroticScore', label: 'Necrotic 壊死', ph: 'n0〜N6', sc: '0' },
                    { code: 'pocket', score: 'pocketScore', label: 'Pocket ポケット', ph: 'p0〜P24', sc: '0' },
                  ].map((it) => (
                    <div key={it.code} className="flex flex-col gap-1 rounded border border-line bg-soft p-2">
                      <span className="text-2xs font-semibold text-muted">{it.label}</span>
                      <input
                        name={it.code}
                        placeholder={it.ph}
                        className="rounded border border-line px-2 py-1 text-xs"
                      />
                      <input
                        name={it.score}
                        type="number"
                        min={0}
                        defaultValue={it.sc}
                        aria-label={`${it.label} 点数`}
                        className="rounded border border-line px-2 py-1 text-xs tabular-nums"
                      />
                    </div>
                  ))}
                </div>
                <Button type="submit" variant="secondary" disabled={dbDown}>
                  DESIGN-R を記録
                </Button>
                <p className="text-2xs text-muted/70">
                  ※ 各欄は重症度コード（軽度=小文字 / 重度=大文字）と点数を入力。合計（Depth除く）は保存時に算出します。
                </p>
              </form>
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1.5 text-2xs font-bold text-muted">評価の推移（追記専用）</div>
                <HistoryList rows={ulcers.rows} />
              </div>
            </Panel>
          </div>
        )}
      </div>
    </PageBody>
  );
}
