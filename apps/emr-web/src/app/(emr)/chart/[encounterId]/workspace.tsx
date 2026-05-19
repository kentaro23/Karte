'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Panel,
  Button,
  Badge,
  Icon,
  Tabs,
  Modal,
  Input,
  SoapEditor,
  EmptyState,
} from '@medixus/ui';
import { type SoapBlock } from '@medixus/domain';
import {
  saveSoap,
  lockNote,
  amendNote,
  addPrescription,
  confirmPrescription,
  searchDiseases,
  addChartDiagnosis,
  removeDiagnosis,
  type RxItemInput,
} from './actions';
import { LabResultsPanel } from './labs';

export interface ChartDx {
  id: string;
  displayName: string;
  icd10: string | null;
  isMain: boolean;
  isSuspected: boolean;
  fromMaster: boolean;
}

type Drug = {
  id: string;
  brandName: string;
  genericName: string | null;
  strengthUnit: string | null;
  administrationRoute: string;
};
type Finding = { checkType: string; result: string; message: string };
type Rx = {
  id: string;
  status: string;
  items: { drugName: string; dosePerTime: number; doseUnit: string; timesPerDay: number; days: number }[];
  checks: { id: string; checkType: string; result: string; severityNote: string | null; runId: string }[];
  overrides: string[];
};
type HistoryNote = {
  id: string;
  version: number;
  status: string;
  isLatest: boolean;
  noteType: string;
  recordedDate: string;
  amendReason: string | null;
  blocks: SoapBlock[];
};

const TEMPLATES: Record<string, SoapBlock[]> = {
  '感冒（急性上気道炎）': [
    { kind: 'S', spans: [{ text: '咳・鼻汁・咽頭痛。発熱（　）日目。' }] },
    { kind: 'O', spans: [{ text: '体温　℃、咽頭発赤（±）、呼吸音清。SpO2　%。' }] },
    { kind: 'A', spans: [{ text: '急性上気道炎。細菌感染示唆所見なし。' }] },
    { kind: 'P', spans: [{ text: '対症療法。水分・安静指導。増悪時再診。' }] },
  ],
  '高血圧 定期フォロー': [
    { kind: 'S', spans: [{ text: '自覚症状なし。服薬コンプライアンス良好。' }] },
    { kind: 'O', spans: [{ text: '血圧　/　mmHg、脈　/分。浮腫なし。' }] },
    { kind: 'A', spans: [{ text: '本態性高血圧、コントロール（良好/不良）。' }] },
    { kind: 'P', spans: [{ text: '同処方継続。家庭血圧記録。　ヶ月後再診。' }] },
  ],
  '糖尿病 定期フォロー': [
    { kind: 'S', spans: [{ text: '低血糖症状（−）。食事・運動療法 継続中。' }] },
    { kind: 'O', spans: [{ text: 'HbA1c　%、随時血糖　mg/dL、体重　kg。' }] },
    { kind: 'A', spans: [{ text: '2型糖尿病。血糖コントロール（　）。' }] },
    { kind: 'P', spans: [{ text: '同処方継続。栄養指導依頼。次回採血。' }] },
  ],
};

const RECORD_TYPES = [
  { key: 'PROGRESS', label: '経過記録' },
  { key: 'NURSING', label: '看護記録' },
  { key: 'NUTRITION', label: '栄養指導' },
  { key: 'REPORT', label: 'レポート' },
];

export function ChartWorkspace(props: {
  encounterId: string;
  patientId: string;
  deptName: string;
  latestNote: { id: string; version: number; status: string } | null;
  initialBlocks: SoapBlock[];
  history: HistoryNote[];
  drugs: Drug[];
  recommended: { id: string; dx: string }[];
  diagnoses: ChartDx[];
  prescriptions: Rx[];
}) {
  const { encounterId } = props;
  const router = useRouter();
  const [blocks, setBlocks] = React.useState<SoapBlock[]>(props.initialBlocks);
  const [recType, setRecType] = React.useState('PROGRESS');
  const [amendReason, setAmendReason] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<HistoryNote | null>(null);
  const [schemaOpen, setSchemaOpen] = React.useState(false);
  const [tplOpen, setTplOpen] = React.useState(false);
  const [proxy, setProxy] = React.useState(false);
  const [stickies, setStickies] = React.useState<{ id: string; text: string }[]>([]);
  const [pending, start] = React.useTransition();
  const locked = props.latestNote?.status === 'LOCKED';
  const [filter, setFilter] = React.useState<'all' | 'latest'>('all');

  const hist = props.history.filter((n) => (filter === 'latest' ? n.isLatest : true));

  return (
    <div className="grid h-[calc(100vh-118px)] grid-cols-[260px_1fr_320px] gap-0">
      {/* ── LEFT: 指示歴ナビゲータ ── */}
      <aside className="flex flex-col overflow-hidden border-r border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-xs font-bold text-ink">指示歴 / 版数</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'latest')}
            className="rounded border border-line px-1.5 py-0.5 text-2xs"
          >
            <option value="all">全版</option>
            <option value="latest">最新のみ</option>
          </select>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {hist.length === 0 && <EmptyState title="記載なし" />}
          {hist.map((n) => (
            <button
              key={n.id}
              onClick={() => setViewing(n)}
              className="mb-1.5 block w-full rounded border-l-4 px-2 py-1.5 text-left text-xs hover:bg-soft"
              style={{ borderColor: n.isLatest ? '#0b5f37' : '#bbb' }}
            >
              <div className="flex items-center gap-1">
                <span className="font-semibold">第{n.version}版</span>
                {n.isLatest ? (
                  <Badge tone="green">最新</Badge>
                ) : (
                  <Badge tone="amber">旧版</Badge>
                )}
                {n.status === 'LOCKED' && <Badge tone="blue">ロック</Badge>}
              </div>
              <div className="mt-0.5 text-2xs text-muted">
                {new Date(n.recordedDate).toLocaleString('ja-JP')}
              </div>
              {n.amendReason && (
                <div className="text-2xs text-warn">改版: {n.amendReason}</div>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* ── CENTER: 記載 ── */}
      <section className="flex min-w-0 flex-col overflow-hidden bg-canvas">
        <DiagnosisBar encounterId={props.encounterId} diagnoses={props.diagnoses} />
        <div className="flex items-center gap-2 border-b border-line bg-white px-3 py-1.5">
          <Tabs
            items={RECORD_TYPES.map((r) => ({ key: r.key, label: r.label }))}
            value={recType}
            onChange={setRecType}
            size="sm"
            className="border-0"
          />
          <span className="ml-auto text-2xs text-muted">
            {props.deptName}
            {props.latestNote && ` ・ 第${props.latestNote.version}版（${props.latestNote.status}）`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-soft px-3 py-1.5">
          <Button size="sm" variant="ghost" onClick={() => setTplOpen(true)}>
            <Icon name="template" size={13} /> テンプレート
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSchemaOpen(true)}>
            <Icon name="schema" size={13} /> シェーマ
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStickies((s) => [...s, { id: crypto.randomUUID(), text: '' }])}
          >
            <Icon name="sticky" size={13} /> 付箋
          </Button>
          <label className="ml-2 flex items-center gap-1 text-2xs text-muted">
            <input type="checkbox" checked={proxy} onChange={(e) => setProxy(e.target.checked)} />
            代行入力（責任医師を明記）
          </label>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {msg && (
            <div className="mb-3 rounded border border-info/30 bg-blue-50 px-3 py-2 text-xs text-info">
              {msg}
            </div>
          )}
          {locked && (
            <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-warn">
              この記載はロック済みです。修正は「改版」（旧版を保持し新版を追記）で行います（電子保存の三原則・真正性）。
            </div>
          )}
          {stickies.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {stickies.map((s, i) => (
                <div
                  key={s.id}
                  className="w-48 rounded border-l-4 border-amber-400 bg-amber-50 p-2 text-xs"
                >
                  <input
                    placeholder="付箋メモ"
                    value={s.text}
                    onChange={(e) =>
                      setStickies((arr) =>
                        arr.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)),
                      )
                    }
                    className="w-full bg-transparent outline-none"
                  />
                </div>
              ))}
            </div>
          )}
          <Panel>
            <SoapEditor value={blocks} onChange={setBlocks} readOnly={false} />
          </Panel>
        </div>

        <div className="flex items-center gap-2 border-t border-line bg-white px-3 py-2">
          {!locked ? (
            <>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await saveSoap(encounterId, blocks);
                    setMsg(r.ok ? 'カルテを保存しました（追記専用・版管理）' : '保存失敗');
                    router.refresh();
                  })
                }
              >
                <Icon name="check" size={14} /> 保存
              </Button>
              {props.latestNote && (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await lockNote(encounterId, props.latestNote!.id);
                      setMsg('記載をロックしました（以後は改版のみ可）');
                      router.refresh();
                    })
                  }
                >
                  <Icon name="lock" size={14} /> 確定（ロック）
                </Button>
              )}
            </>
          ) : (
            <>
              <Input
                placeholder="改版理由（必須）"
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                className="w-64"
              />
              <Button
                variant="primary"
                disabled={pending || amendReason.trim().length < 2}
                onClick={() =>
                  start(async () => {
                    await amendNote(encounterId, props.latestNote!.id, blocks, amendReason);
                    setMsg('改版しました（新版を追記、旧版は保持・消し線表示）');
                    setAmendReason('');
                    router.refresh();
                  })
                }
              >
                <Icon name="edit" size={14} /> 改版して保存
              </Button>
            </>
          )}
          {proxy && (
            <span className="ml-2 text-2xs text-warn">
              代行入力モード：責任医師の指定が必要です
            </span>
          )}
        </div>
      </section>

      {/* ── RIGHT: ツール / 処方安全 ── */}
      <aside className="flex flex-col overflow-auto border-l border-line bg-white">
        <div className="border-b border-line px-3 py-2 text-xs font-bold text-ink">
          オーダ・ツール
        </div>
        <div className="grid grid-cols-2 gap-1.5 p-2">
          {[
            { ic: 'rx', l: '処方', t: 'rx' },
            { ic: 'injection', l: '注射', t: 'injection' },
            { ic: 'lab', l: '検査', t: 'exam' },
            { ic: 'referral', l: '紹介状', t: 'ref' },
          ].map((b) => (
            <div
              key={b.l}
              className="flex flex-col items-center gap-1 rounded border border-line bg-soft py-2 text-2xs text-muted"
            >
              <Icon name={b.ic as never} size={16} />
              {b.l}
            </div>
          ))}
        </div>
        <div className="border-y border-line px-3 py-2 text-xs font-bold text-ink">
          検査結果
        </div>
        <div className="p-2">
          <LabResultsPanel patientId={props.patientId} />
        </div>
        <div className="border-y border-line px-3 py-2 text-xs font-bold text-ink">
          処方（安全チェック）
        </div>
        <div className="p-2">
          <RxPanel
            encounterId={encounterId}
            drugs={props.drugs}
            recommended={props.recommended}
            prescriptions={props.prescriptions}
          />
        </div>
      </aside>

      {/* 履歴ビューア */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `第${viewing.version}版（${viewing.status}）` : ''}
        width={560}
      >
        {viewing && (
          <pre
            className={`whitespace-pre-wrap text-sm ${viewing.status === 'SUPERSEDED' ? 'text-muted line-through' : 'text-ink'}`}
          >
            {viewing.blocks
              .map((b) => `【${b.kind}】${b.spans.map((s) => s.text).join('')}`)
              .join('\n')}
          </pre>
        )}
      </Modal>

      {/* テンプレート */}
      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title="テンプレート挿入" width={420}>
        <div className="flex flex-col gap-2">
          {Object.keys(TEMPLATES).map((name) => (
            <button
              key={name}
              onClick={() => {
                setBlocks(TEMPLATES[name]!);
                setTplOpen(false);
                setMsg(`テンプレート「${name}」を挿入しました`);
              }}
              className="rounded border border-line px-3 py-2 text-left text-sm hover:bg-accent-50"
            >
              {name}
            </button>
          ))}
        </div>
      </Modal>

      {/* シェーマ */}
      <SchemaModal
        open={schemaOpen}
        onClose={() => setSchemaOpen(false)}
        onAttach={() => {
          setBlocks((b) =>
            b.map((x) =>
              x.kind === 'O'
                ? { kind: 'O', spans: [{ text: x.spans.map((s) => s.text).join('') + '\n［シェーマ添付済］' }] }
                : x,
            ),
          );
          setSchemaOpen(false);
          setMsg('シェーマを添付しました');
        }}
      />
    </div>
  );
}

/** 病名（診断名）: カルテから マスタ選択 / 自由記述 で登録・削除。適応薬リコメンドに連携。 */
function DiagnosisBar({
  encounterId,
  diagnoses,
}: {
  encounterId: string;
  diagnoses: ChartDx[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<{ code: string; name: string; icd10: string }[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [free, setFree] = React.useState('');
  const [isMain, setIsMain] = React.useState(false);
  const [isSuspected, setIsSuspected] = React.useState(false);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await searchDiseases(term));
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const add = (p: {
    masterCode?: string | null;
    displayName: string;
    icd10?: string | null;
  }) =>
    start(async () => {
      const r = await addChartDiagnosis(encounterId, {
        ...p,
        isMain,
        isSuspected,
      });
      if (r.ok) {
        setOpen(false);
        setQ('');
        setResults([]);
        setFree('');
        setIsMain(false);
        setIsSuspected(false);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-white px-3 py-1.5">
      <span className="text-2xs font-bold text-muted">病名</span>
      {diagnoses.length === 0 && (
        <span className="text-2xs text-muted/70">未登録</span>
      )}
      {diagnoses.map((d) => (
        <span
          key={d.id}
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${
            d.isMain ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-line bg-soft'
          }`}
        >
          {d.isMain && <span className="text-2xs font-bold">主</span>}
          {d.isSuspected && <span className="text-2xs text-warn">疑</span>}
          {d.displayName}
          {d.icd10 && <span className="font-mono text-2xs text-muted">{d.icd10}</span>}
          {!d.fromMaster && <span className="text-2xs text-muted">(自由)</span>}
          <button
            onClick={() => start(async () => { await removeDiagnosis(encounterId, d.id); router.refresh(); })}
            className="ml-0.5 text-muted/60 hover:text-alert"
            aria-label="削除"
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className="ml-1">
        <Icon name="plus" size={12} /> 病名
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="病名を追加（マスタ選択 / 自由記述）" width={560}>
        <div className="flex items-center gap-3 pb-2 text-xs">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={isMain} onChange={(e) => setIsMain(e.target.checked)} /> 主病名
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={isSuspected} onChange={(e) => setIsSuspected(e.target.checked)} /> 疑い
          </label>
          <span className="ml-auto text-2xs text-muted">傷病名マスタ 約2.7万件</span>
        </div>

        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="標準病名 / ICD10 で検索（例: 高血圧, 糖尿, J06）"
          className="w-full"
        />
        <div className="mt-1 max-h-56 overflow-auto rounded border border-line">
          {searching && <div className="px-2 py-2 text-2xs text-muted">検索中…</div>}
          {!searching && q.trim() && results.length === 0 && (
            <div className="px-2 py-2 text-2xs text-muted">該当なし（下の自由記述で登録できます）</div>
          )}
          {results.map((r) => (
            <button
              key={r.code}
              disabled={pending}
              onClick={() => add({ masterCode: r.code, displayName: r.name, icd10: r.icd10 || null })}
              className="flex w-full items-center justify-between gap-2 border-b border-line/60 px-2 py-1.5 text-left text-xs last:border-0 hover:bg-accent-50"
            >
              <span className="truncate">{r.name}</span>
              {r.icd10 && (
                <span className="shrink-0 rounded bg-soft px-1 font-mono text-2xs text-muted">
                  {r.icd10}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1 text-2xs font-bold text-muted">自由記述で追加</div>
          <div className="flex gap-2">
            <Input
              value={free}
              onChange={(e) => setFree(e.target.value)}
              placeholder="マスタにない病名を直接入力"
              className="flex-1"
            />
            <Button
              variant="primary"
              disabled={pending || free.trim().length < 1}
              onClick={() => add({ displayName: free, masterCode: null, icd10: null })}
            >
              追加
            </Button>
          </div>
          <p className="mt-1 text-2xs text-muted">
            ※ 自由記述病名はICD10未付与（レセプト病名/適応リコメンドはマスタ選択推奨）
          </p>
        </div>
      </Modal>
    </div>
  );
}

function SchemaModal({
  open,
  onClose,
  onAttach,
}: {
  open: boolean;
  onClose: () => void;
  onAttach: () => void;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  React.useEffect(() => {
    if (!open) return;
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#bbb';
    ctx.strokeRect(120, 20, 80, 110); // torso
    ctx.beginPath();
    ctx.arc(160, 18, 18, 0, Math.PI * 2); // head
    ctx.stroke();
    ctx.strokeStyle = '#8a2b2b';
    ctx.lineWidth = 2.5;
  }, [open]);
  const pos = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="シェーマ（人体図に描画）"
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={onAttach}>
            カルテに貼付
          </Button>
        </>
      }
    >
      <canvas
        ref={ref}
        width={360}
        height={220}
        className="w-full cursor-crosshair rounded border border-line"
        onMouseDown={(e) => {
          drawing.current = true;
          const ctx = ref.current!.getContext('2d')!;
          const { x, y } = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onMouseMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const { x, y } = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onMouseUp={() => (drawing.current = false)}
        onMouseLeave={() => (drawing.current = false)}
      />
      <p className="mt-2 text-2xs text-muted">
        所見部位を描画し「カルテに貼付」。コメントは文字情報としても保存されます（別紙1 §25.5）。
      </p>
    </Modal>
  );
}

function RxPanel({
  encounterId,
  drugs,
  recommended,
  prescriptions,
}: {
  encounterId: string;
  drugs: Drug[];
  recommended: { id: string; dx: string }[];
  prescriptions: Rx[];
}) {
  const router = useRouter();
  const recMap = React.useMemo(
    () => new Map(recommended.map((r) => [r.id, r.dx])),
    [recommended],
  );
  const [cart, setCart] = React.useState<RxItemInput[]>([]);
  const [query, setQuery] = React.useState('');
  const [drugId, setDrugId] = React.useState(recommended[0]?.id ?? drugs[0]?.id ?? '');
  const filtered = React.useMemo(() => {
    const q = query.trim();
    const base = q
      ? drugs.filter(
          (d) =>
            d.brandName.includes(q) ||
            (d.genericName ?? '').includes(q),
        )
      : drugs;
    const rec = base.filter((d) => recMap.has(d.id));
    const rest = base.filter((d) => !recMap.has(d.id));
    return { rec, rest: rest.slice(0, 200) };
  }, [drugs, query, recMap]);
  const selected = drugs.find((d) => d.id === drugId);
  const [dose, setDose] = React.useState(1);
  const [tpd, setTpd] = React.useState(3);
  const [days, setDays] = React.useState(7);
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<null | {
    prescriptionId: string;
    overall: string;
    findings: Finding[];
    persistedIds: string[];
  }>(null);
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const [confirmMsg, setConfirmMsg] = React.useState<string | null>(null);

  const add = () => {
    const d = drugs.find((x) => x.id === drugId);
    if (!d) return;
    setCart((c) => [
      ...c,
      {
        drugProductId: d.id,
        drugName: d.brandName,
        dosePerTime: dose,
        doseUnit: d.strengthUnit ?? '錠',
        timesPerDay: tpd,
        days,
        route: d.administrationRoute,
      },
    ]);
  };

  return (
    <div className="text-xs">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="薬剤名で検索（適応薬を上位表示）"
        className="mb-1 w-full rounded border border-line px-2 py-1 text-xs"
      />
      <div className="mb-1.5 max-h-44 overflow-auto rounded border border-line">
        {filtered.rec.length > 0 && (
          <div className="bg-accent-50/60 px-2 py-1 text-2xs font-bold text-accent-700">
            適応薬（病名に基づく推奨）
          </div>
        )}
        {filtered.rec.map((d) => (
          <button
            key={d.id}
            onClick={() => setDrugId(d.id)}
            className={`flex w-full items-center justify-between gap-2 border-l-2 px-2 py-1 text-left text-xs hover:bg-accent-50 ${
              d.id === drugId ? 'border-accent-500 bg-accent-50' : 'border-accent-300 bg-accent-50/40'
            }`}
          >
            <span className="truncate">{d.brandName}</span>
            <span className="shrink-0 rounded bg-accent-100 px-1 text-2xs text-accent-700">
              適応: {recMap.get(d.id)}
            </span>
          </button>
        ))}
        {filtered.rest.length > 0 && filtered.rec.length > 0 && (
          <div className="bg-soft px-2 py-1 text-2xs font-bold text-muted">その他</div>
        )}
        {filtered.rest.map((d) => (
          <button
            key={d.id}
            onClick={() => setDrugId(d.id)}
            className={`block w-full truncate px-2 py-1 text-left text-xs hover:bg-soft ${
              d.id === drugId ? 'bg-accent-50 font-semibold' : ''
            }`}
          >
            {d.brandName}
          </button>
        ))}
        {filtered.rec.length === 0 && filtered.rest.length === 0 && (
          <div className="px-2 py-3 text-center text-2xs text-muted">該当なし</div>
        )}
      </div>
      <div className="mb-1.5 text-2xs text-muted">
        選択中: <span className="font-semibold text-ink">{selected?.brandName ?? '—'}</span>
      </div>
      <div className="mb-1.5 flex gap-1">
        <input type="number" value={dose} step={0.5} onChange={(e) => setDose(+e.target.value)} className="w-12 rounded border border-line px-1 py-1" title="1回量" />
        <input type="number" value={tpd} onChange={(e) => setTpd(+e.target.value)} className="w-12 rounded border border-line px-1 py-1" title="1日回数" />
        <input type="number" value={days} onChange={(e) => setDays(+e.target.value)} className="w-12 rounded border border-line px-1 py-1" title="日数" />
        <Button size="sm" variant="secondary" onClick={add}>
          追加
        </Button>
      </div>
      {cart.map((c, i) => (
        <div key={i} className="flex items-center justify-between py-0.5">
          <span>
            {c.drugName} {c.dosePerTime}×{c.timesPerDay}×{c.days}日
          </span>
          <button onClick={() => setCart((x) => x.filter((_, j) => j !== i))} className="text-alert">
            ×
          </button>
        </div>
      ))}
      <Button
        size="sm"
        variant="primary"
        className="mt-1.5 w-full justify-center"
        disabled={pending || cart.length === 0}
        onClick={() =>
          start(async () => {
            const r = await addPrescription(encounterId, cart);
            setResult(r);
            setConfirmMsg(null);
          })
        }
      >
        発行＋安全チェック
      </Button>

      {result && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 font-bold">
            結果:{' '}
            {result.overall === 'BLOCKED' ? (
              <Badge tone="red">ブロック</Badge>
            ) : result.overall === 'WARNING' ? (
              <Badge tone="amber">警告</Badge>
            ) : (
              <Badge tone="green">問題なし</Badge>
            )}
          </div>
          {result.findings.map((f, i) => {
            const rid = result.persistedIds[i]!;
            const tone = f.result === 'BLOCKED' ? 'red' : f.result === 'WARNING' ? 'amber' : 'green';
            return (
              <div key={rid} className="mb-1 rounded border border-line p-1.5">
                <Badge tone={tone as never}>{f.checkType}</Badge>
                <div className="mt-0.5">{f.message}</div>
                {f.result === 'BLOCKED' && (
                  <input
                    placeholder="解除理由（必須・監査記録）"
                    value={reasons[rid] ?? ''}
                    onChange={(e) => setReasons((s) => ({ ...s, [rid]: e.target.value }))}
                    className="mt-1 w-full rounded border border-alert px-1.5 py-1"
                  />
                )}
              </div>
            );
          })}
          <Button
            size="sm"
            variant="primary"
            className="mt-1 w-full justify-center"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const overrides = result.findings
                  .map((f, i) => ({ f, id: result.persistedIds[i]! }))
                  .filter((x) => x.f.result === 'BLOCKED')
                  .map((x) => ({ ruleCheckResultId: x.id, reason: reasons[x.id] ?? '' }));
                const r = await confirmPrescription(encounterId, result.prescriptionId, overrides);
                setConfirmMsg(r.ok ? '処方を確定しました' : (r.error ?? '確定失敗'));
                if (r.ok) router.refresh();
              })
            }
          >
            処方を確定
          </Button>
          {confirmMsg && (
            <p className="mt-1">
              {confirmMsg}{' '}
              {confirmMsg.startsWith('処方を確定') && (
                <a
                  className="text-info underline"
                  href={`/print/prescription/${result.prescriptionId}`}
                  target="_blank"
                >
                  処方箋印刷 →
                </a>
              )}
            </p>
          )}
        </div>
      )}

      {prescriptions.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1 font-bold text-muted">この受診の処方</div>
          {prescriptions.map((rx) => (
            <div key={rx.id} className="py-0.5">
              <Badge tone={rx.status === 'doctor_confirmed' ? 'green' : 'amber'}>{rx.status}</Badge>{' '}
              {rx.items.map((i) => i.drugName).join(', ')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
