import Link from 'next/link';
import { prisma } from '@medixus/db';
import {
  age,
  judgeLabFlag,
  buildLabTrend,
  LAB_FLAG_LABEL,
  type LabFlag,
} from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, EmptyState, TrendChart } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { LabResultsPanel, type LabSeries } from '../chart/[encounterId]/labs';
import { addLabResult, transcribeLabsToNote } from './actions';

// 受付/カルテ同様、Prisma を読むため明示的に動的化。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

type LabRow = {
  id: string;
  name: string;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  value: number | null;
  valueText: string | null;
  collectedAt: Date | null;
  flag: LabFlag | null;
};

type LoadResult =
  | { kind: 'ok'; patientName: string; patientAge: number; rows: LabRow[] }
  | { kind: 'no-db' };

// ── デモ（DB未接続）用の決定論サンプル ──────────────────────────────────────
const DEMO_PATIENTS = [
  { id: 'demo-pat-1', patientNo: '000123', name: '見本 太郎', age: 58 },
  { id: 'demo-pat-2', patientNo: '000124', name: '試験 花子', age: 41 },
];

/** 1患者分の検査結果を ExamMaster 紐付きで取得（DB無時は throw → デモ描画）。 */
async function loadLabs(patientId: string): Promise<LoadResult> {
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) return { kind: 'no-db' };
  const results = await prisma.labResult.findMany({
    where: { patientId },
    include: { examMaster: true },
    orderBy: [{ collectedAt: 'asc' }],
    take: 2000,
  });
  const rows: LabRow[] = results.map((r) => {
    const refLow = r.refLow ?? r.examMaster?.refLow ?? null;
    const refHigh = r.refHigh ?? r.examMaster?.refHigh ?? null;
    return {
      id: r.id,
      name: r.examMaster?.name ?? '検査',
      unit: r.unit ?? r.examMaster?.unit ?? null,
      refLow,
      refHigh,
      value: r.value ?? null,
      valueText: r.valueText ?? null,
      collectedAt: r.collectedAt ?? null,
      // 保存済 flag を尊重しつつ、未設定なら基準値から判定。
      flag: (r.flag as LabFlag | null) ?? judgeLabFlag(r.value, refLow, refHigh),
    };
  });
  return {
    kind: 'ok',
    patientName: `${patient.kanjiLastName} ${patient.kanjiFirstName}`,
    patientAge: age(patient.dateOfBirth),
    rows,
  };
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const flagTone: Record<LabFlag, 'red' | 'amber' | 'green'> = {
  H: 'red',
  L: 'amber',
  N: 'green',
};

/** 行群を検査項目ごとにグルーピング（経過表・トレンドの単位）。 */
function groupByItem(rows: LabRow[]): { name: string; unit: string | null; refLow: number | null; refHigh: number | null; rows: LabRow[] }[] {
  const map = new Map<string, { name: string; unit: string | null; refLow: number | null; refHigh: number | null; rows: LabRow[] }>();
  for (const r of rows) {
    const g = map.get(r.name);
    if (g) {
      g.rows.push(r);
      if (g.refLow == null && r.refLow != null) g.refLow = r.refLow;
      if (g.refHigh == null && r.refHigh != null) g.refHigh = r.refHigh;
      if (!g.unit && r.unit) g.unit = r.unit;
    } else {
      map.set(r.name, { name: r.name, unit: r.unit, refLow: r.refLow, refHigh: r.refHigh, rows: [r] });
    }
  }
  return [...map.values()];
}

/** O欄転記文（最新値中心・推移併記）をサーバ側で整形。client島でも同等の文を生成可。 */
function buildOText(groups: ReturnType<typeof groupByItem>): string {
  const today = new Date();
  const head = `【検査結果】${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} 時点`;
  const lines = groups
    .map((g) => {
      const valued = g.rows.filter((r): r is LabRow & { value: number } => r.value !== null && r.value !== undefined);
      if (valued.length === 0) return null;
      const last = valued[valued.length - 1]!;
      const flag = judgeLabFlag(last.value, g.refLow, g.refHigh);
      const mark = flag === 'H' ? ' H↑' : flag === 'L' ? ' L↓' : '';
      const trail = valued.slice(-4).map((r) => r.value).join('→');
      const trend = valued.length > 1 ? `（推移 ${trail}）` : '';
      return { line: `${g.name} ${last.value}${g.unit ? ` ${g.unit}` : ''}${mark}${trend}`, abnormal: !!mark };
    })
    .filter((x): x is { line: string; abnormal: boolean } => x !== null);
  const abnormal = lines.filter((l) => l.abnormal);
  const chosen = abnormal.length > 0 ? abnormal : lines;
  if (chosen.length === 0) return '';
  const note = abnormal.length > 0 ? '' : '\n（基準値逸脱なし）';
  return `${head}\n${chosen.map((l) => `・${l.line}`).join('\n')}${note}`;
}

/** チャート用 series（client の LabResultsPanel が消費）へ変換。 */
function toSeries(groups: ReturnType<typeof groupByItem>): LabSeries[] {
  return groups.map((g) => ({
    name: g.name,
    unit: g.unit ?? '',
    refLow: g.refLow,
    refHigh: g.refHigh,
    points: g.rows.map((r) => ({ label: fmtDate(r.collectedAt), value: r.value })),
  }));
}

export default async function LabsPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const sp = await searchParams;
  const patientId = sp.patientId ?? '';

  // 患者一覧（DB無時はデモ）。
  let patients: { id: string; patientNo: string; name: string; age: number }[] = DEMO_PATIENTS;
  let dbDown = false;
  try {
    const ps = await prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 12 });
    if (ps.length > 0) {
      patients = ps.map((p) => ({
        id: p.id,
        patientNo: p.patientNo,
        name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
        age: age(p.dateOfBirth),
      }));
    }
  } catch (err) {
    console.error('[LabsPage] patient list failed, using demo:', err);
    dbDown = true;
  }

  let result: LoadResult | null = null;
  if (patientId) {
    try {
      result = await loadLabs(patientId);
    } catch (err) {
      console.error('[LabsPage] loadLabs failed, demo fallback:', err);
      result = { kind: 'no-db' };
      dbDown = true;
    }
  }

  const selected = patients.find((p) => p.id === patientId) ?? null;
  const hasReal = result?.kind === 'ok' && result.rows.length > 0;
  const groups = result?.kind === 'ok' ? groupByItem(result.rows) : [];
  const oText = hasReal ? buildOText(groups) : '';
  const series = hasReal ? toSeries(groups) : undefined;

  // サーバアクションのフォーム束縛（O欄転記）。
  async function transcribe(formData: FormData) {
    'use server';
    const pid = String(formData.get('patientId') || '');
    const text = String(formData.get('oText') || '');
    await transcribeLabsToNote(pid, text);
  }

  return (
    <PageBody>
      <PageHeader
        title="検査結果"
        desc="検査値の格納・基準値H/L判定・項目別トレンド・経過表・O欄転記（FR-LAB-01）"
        crumbs={['Medixus カルテ', '診療', '検査結果']}
      />
      {dbDown && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB未接続）：登録・O欄転記は無効です。基準値判定とトレンドのUIを提示します。
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <Panel>
          <PanelHeader title="患者選択" icon={<Icon name="patients" size={15} />} />
          <ul className="flex flex-col gap-0.5">
            {patients.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/labs?patientId=${p.id}`}
                  className={`block rounded px-2 py-1.5 text-xs hover:bg-soft ${
                    selected?.id === p.id ? 'bg-accent-50 font-semibold text-accent-700' : ''
                  }`}
                >
                  <span className="font-mono text-2xs text-muted">{p.patientNo}</span> {p.name}（{p.age}）
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-4">
          {!selected ? (
            <Panel>
              <EmptyState
                title="患者を選択してください"
                hint="左の一覧から患者を選ぶと検査結果のトレンド・経過表・O欄転記ができます"
                icon={<Icon name="lab" size={32} />}
              />
            </Panel>
          ) : (
            <>
              {/* 経過表（基準値逸脱 色付き）＋ O欄転記 */}
              <Panel>
                <PanelHeader
                  title={`${selected.name} の検査結果（経過表）`}
                  desc="基準値逸脱は H=赤 / L=橙。確定結果は追記専用（IF-EXT-04 連携で外注結果取込）"
                  icon={<Icon name="lab" size={15} />}
                />
                {!hasReal ? (
                  <div className="text-xs">
                    <p className="mb-2 text-muted">
                      実検査結果は未登録です。下のフォームで手入力するか、検査部門システム連携（IF-EXT-04）で取込みます。
                      下表は基準値判定・トレンドのUIサンプルです。
                    </p>
                    {/* DB無/未登録時も判定UIを提示（決定論サンプル）。 */}
                    <LabResultsPanel patientId={selected.id} />
                  </div>
                ) : (
                  <>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-soft text-2xs uppercase text-muted">
                          <th className="px-2 py-1.5 text-left">検査項目</th>
                          <th className="px-2 py-1.5 text-right">最新値</th>
                          <th className="px-2 py-1.5 text-left">基準値</th>
                          <th className="px-2 py-1.5 text-center">判定</th>
                          <th className="px-2 py-1.5 text-left">トレンド</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g) => {
                          const valued = g.rows.filter(
                            (r): r is LabRow & { value: number } => r.value !== null && r.value !== undefined,
                          );
                          const last = valued[valued.length - 1] ?? null;
                          const flag = last ? judgeLabFlag(last.value, g.refLow, g.refHigh) : null;
                          const trend = buildLabTrend(
                            g.rows.map((r) => ({
                              value: r.value,
                              collectedAt: r.collectedAt ?? new Date(),
                              unit: g.unit,
                              refLow: g.refLow,
                              refHigh: g.refHigh,
                            })),
                          );
                          const points = trend.map((t) => ({ label: fmtDate(t.collectedAt), value: t.value }));
                          const refStr =
                            g.refLow != null || g.refHigh != null
                              ? `${g.refLow ?? ''}〜${g.refHigh ?? ''}${g.unit ? ` ${g.unit}` : ''}`
                              : '—';
                          return (
                            <tr key={g.name} className="border-t border-line align-top">
                              <td className="px-2 py-1.5 font-medium">{g.name}</td>
                              <td
                                className={`px-2 py-1.5 text-right tabular-nums ${
                                  flag === 'H' ? 'font-bold text-alert' : flag === 'L' ? 'font-bold text-info' : ''
                                }`}
                              >
                                {last ? (
                                  <>
                                    {last.value}
                                    {g.unit ? <span className="ml-0.5 text-2xs text-muted">{g.unit}</span> : null}
                                  </>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-2xs text-muted">{refStr}</td>
                              <td className="px-2 py-1.5 text-center">
                                {flag ? (
                                  <Badge tone={flagTone[flag]}>{LAB_FLAG_LABEL[flag]}</Badge>
                                ) : (
                                  <span className="text-2xs text-muted">—</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <TrendChart
                                  points={points}
                                  refLow={g.refLow ?? undefined}
                                  refHigh={g.refHigh ?? undefined}
                                  unit={g.unit ?? undefined}
                                  width={220}
                                  height={64}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* O欄転記（サーバ書込: 当日の進行中エンカウンタの最新カルテO欄へ追記） */}
                    <div className="mt-3 rounded border border-line bg-soft p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-2xs font-bold text-muted">カルテO欄へ転記</span>
                        <form action={transcribe}>
                          <input type="hidden" name="patientId" value={selected.id} />
                          <input type="hidden" name="oText" value={oText} />
                          <Button size="sm" variant="primary" type="submit" disabled={!oText}>
                            <Icon name="check" size={13} /> O欄へ転記
                          </Button>
                        </form>
                      </div>
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-line bg-white p-2 text-2xs text-ink">
                        {oText || '（転記可能な数値結果がありません）'}
                      </pre>
                      <p className="mt-1 text-2xs text-muted/70">
                        ※ 本日の受付/診察中の最新カルテO欄へ追記します。対象が無い場合はカルテ画面の「O欄へ転記（コピー）」をご利用ください。
                      </p>
                    </div>
                  </>
                )}
              </Panel>

              {/* 項目別トレンド（client島・クリップボードO欄コピーも提供） */}
              {hasReal && series && (
                <Panel>
                  <PanelHeader title="項目別トレンド（コンパクト）" icon={<Icon name="chart" size={15} />} />
                  <LabResultsPanel patientId={selected.id} series={series} />
                </Panel>
              )}

              {/* 手入力（取込は IF-EXT-04） */}
              <Panel>
                <PanelHeader title="検査結果 手入力" icon={<Icon name="plus" size={15} />} />
                <form
                  action={addLabResult}
                  className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[1fr_1fr_1fr]"
                >
                  <input type="hidden" name="patientId" value={selected.id} />
                  <label className="flex flex-col gap-0.5">
                    <span className="text-2xs text-muted">検査項目名</span>
                    <input
                      name="examName"
                      required
                      placeholder="例: WBC / CRP / HbA1c"
                      className="rounded border border-line px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-2xs text-muted">ExamMaster コード（任意）</span>
                    <input name="examCode" placeholder="マスタ紐付け（任意）" className="rounded border border-line px-2 py-1.5 text-sm" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-2xs text-muted">採取日時</span>
                    <input type="datetime-local" name="collectedAt" className="rounded border border-line px-2 py-1.5 text-sm" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-2xs text-muted">値（数値）</span>
                    <input name="value" inputMode="decimal" placeholder="例: 8.4" className="rounded border border-line px-2 py-1.5 text-sm" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-2xs text-muted">単位</span>
                    <input name="unit" placeholder="例: mg/dL" className="rounded border border-line px-2 py-1.5 text-sm" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-2xs text-muted">文字結果（任意）</span>
                    <input name="valueText" placeholder="例: 陽性 / (+)" className="rounded border border-line px-2 py-1.5 text-sm" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-2xs text-muted">基準下限（任意）</span>
                    <input name="refLow" inputMode="decimal" placeholder="マスタ優先" className="rounded border border-line px-2 py-1.5 text-sm" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-2xs text-muted">基準上限（任意）</span>
                    <input name="refHigh" inputMode="decimal" placeholder="マスタ優先" className="rounded border border-line px-2 py-1.5 text-sm" />
                  </label>
                  <div className="flex items-end">
                    <Button type="submit" variant="secondary" disabled={dbDown}>
                      <Icon name="plus" size={13} /> 結果を登録
                    </Button>
                  </div>
                </form>
                <p className="mt-1.5 text-2xs text-muted/70">
                  基準値は ExamMaster.refLow/refHigh を優先（未紐付け時は入力値）。H/L 判定は登録時に確定します。
                </p>
              </Panel>
            </>
          )}
        </div>
      </div>
    </PageBody>
  );
}
