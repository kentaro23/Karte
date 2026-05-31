'use client';
/**
 * FR-INJ-01 注射オーダ・三点認証（別紙1 §5.4 / 174項 65-101 / G17）。
 *
 *  左: 実施待ち注射オーダ一覧 → 「三点認証で実施」。
 *      患者 / 薬剤 / 実施者の 3 バーコードを照合し、全一致でのみ実施。
 *      不一致は実施をブロックし、各点の一致/不一致を提示。
 *  右: 注射オーダ発行（輸液製剤マスタ実検索 → 明細 → 発行）。
 *
 * クライアント主導 + サーバアクションで取得/実行。DB 未接続でも描画される
 * （loadInjectionConsole が fail-soft で空配列を返す）。
 */
import * as React from 'react';
import {
  Panel,
  PanelHeader,
  Field,
  Select,
  Input,
  Button,
  Icon,
  Badge,
  EmptyState,
} from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  loadInjectionConsole,
  searchInjectionMaster,
  createInjectionOrder,
  executeInjectionWithAuth,
  type InjectionConsoleData,
  type InjectionOrderRow,
  type InjectionMasterCandidate,
  type InjectionOrderLine,
  type AuthPoint,
} from './actions';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '入力中',
  REQUESTED: '依頼',
  RECEIVED: '受付済',
  IN_PROGRESS: '実施中',
  PARTIALLY_DONE: '一部実施',
  DONE: '実施済',
  CANCELLED: '中止',
  VOIDED: '取消',
};
const STATUS_TONE: Record<string, 'gray' | 'blue' | 'amber' | 'green' | 'red'> = {
  DRAFT: 'gray',
  REQUESTED: 'blue',
  RECEIVED: 'blue',
  IN_PROGRESS: 'amber',
  PARTIALLY_DONE: 'amber',
  DONE: 'green',
  CANCELLED: 'red',
  VOIDED: 'red',
};
const ROUTE_OPTIONS = ['IV（静注）', 'DIV（点滴静注）', 'IM（筋注）', 'SC（皮下注）', 'IVH（中心静脈）'];

const POINT_LABEL: Record<AuthPoint['point'], string> = {
  PATIENT: '患者',
  DRUG: '薬剤',
  EXECUTOR: '実施者',
};

const isExecuted = (s: string) => ['DONE', 'PARTIALLY_DONE'].includes(s);

export default function InjectionOrderPage() {
  const [data, setData] = React.useState<InjectionConsoleData>({ patients: [], orders: [] });
  const [loading, setLoading] = React.useState(true);
  const [pending, start] = React.useTransition();

  const reload = React.useCallback(() => {
    start(async () => {
      const d = await loadInjectionConsole();
      setData(d);
      setLoading(false);
    });
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const pendingCount = data.orders.filter((o) => !isExecuted(o.status)).length;

  return (
    <PageBody>
      <PageHeader
        title="注射オーダ・三点認証"
        desc="輸液製剤マスタ実検索で発行し、実施時に患者・薬剤・実施者の3点バーコードを照合（不一致は実施ブロック）。174項 65-101 / FR-INJ-01"
        crumbs={['Medixus カルテ', 'オーダ', '注射']}
        actions={
          <>
            <Badge tone="amber">実施待ち {pendingCount}</Badge>
            <Button size="sm" variant="ghost" onClick={reload} disabled={pending}>
              <Icon name="refresh" size={14} /> 更新
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        <Panel pad={false}>
          <PanelHeader
            title="注射オーダ（実施・三点認証）"
            icon={<Icon name="injection" size={15} />}
            desc="実施には 患者 / 薬剤 / 実施者 のバーコード3点照合が必要です"
          />
          {loading ? (
            <div className="px-4 py-10 text-center text-2xs text-muted">読み込み中…</div>
          ) : data.orders.length === 0 ? (
            <EmptyState
              title="注射オーダはありません"
              icon={<Icon name="injection" size={30} />}
            />
          ) : (
            <ul className="divide-y divide-line">
              {data.orders.map((o) => (
                <InjectionOrderItem key={o.id} order={o} onDone={reload} />
              ))}
            </ul>
          )}
        </Panel>

        <NewInjectionForm
          patients={data.patients}
          onCreated={reload}
        />
      </div>
    </PageBody>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 1 オーダ行 + 三点認証パネル
// ──────────────────────────────────────────────────────────────────────────

function InjectionOrderItem({
  order,
  onDone,
}: {
  order: InjectionOrderRow;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const executed = isExecuted(order.status);

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-2xs text-muted">{order.orderNo}</span>
            <Badge tone={STATUS_TONE[order.status] ?? 'gray'}>
              {STATUS_LABEL[order.status] ?? order.status}
            </Badge>
            {order.isUrgent && <Badge tone="red">緊急</Badge>}
            {order.route && <span className="text-2xs text-muted">{order.route}</span>}
            {order.lastAuthVerified === false && !executed && (
              <Badge tone="red">認証NG</Badge>
            )}
          </div>
          <div className="mt-1 text-sm">
            <span className="font-mono text-2xs text-muted">{order.patientNo}</span>{' '}
            <span className="font-medium text-ink">{order.patientName}</span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {order.items.map((it, i) => (
              <li key={i} className="text-xs text-ink">
                <Icon name="injection" size={11} className="mr-1 inline text-muted" />
                {it.drugName}
                {it.dose != null && (
                  <span className="ml-1 text-2xs text-muted">
                    {it.dose}
                    {it.doseUnit ?? ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="shrink-0">
          {executed ? (
            <Badge tone="green">
              <Icon name="check" size={12} className="mr-0.5 inline" />
              実施済
            </Badge>
          ) : (
            <Button size="sm" variant={open ? 'secondary' : 'primary'} onClick={() => setOpen((v) => !v)}>
              <Icon name="lock" size={13} /> {open ? '閉じる' : '三点認証で実施'}
            </Button>
          )}
        </div>
      </div>
      {open && !executed && (
        <ThreePointAuthPanel
          order={order}
          onSuccess={() => {
            setOpen(false);
            onDone();
          }}
        />
      )}
    </li>
  );
}

function ThreePointAuthPanel({
  order,
  onSuccess,
}: {
  order: InjectionOrderRow;
  onSuccess: () => void;
}) {
  const [patientBarcode, setPatientBarcode] = React.useState('');
  const [drugBarcode, setDrugBarcode] = React.useState('');
  const [executorBarcode, setExecutorBarcode] = React.useState('');
  const [pending, start] = React.useTransition();
  const [points, setPoints] = React.useState<AuthPoint[] | null>(null);
  const [blocked, setBlocked] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const run = () => {
    setErr(null);
    setPoints(null);
    setBlocked(false);
    start(async () => {
      const r = await executeInjectionWithAuth({
        orderId: order.id,
        patientBarcode,
        drugBarcode,
        executorBarcode,
      });
      if ('error' in r && r.error) {
        setErr(r.error);
      } else if ('blocked' in r && r.blocked) {
        setBlocked(true);
        setPoints(r.points);
      } else if ('ok' in r && r.ok) {
        onSuccess();
      }
    });
  };

  return (
    <div className="mt-3 rounded border border-accent-200 bg-accent-50/60 p-3">
      <p className="mb-2 flex items-center gap-1 text-2xs font-semibold text-ink">
        <Icon name="lock" size={12} /> 三点認証（患者・薬剤・実施者のバーコードを照合）
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label={`患者（番号: ${order.patientNo}）`}>
          <Input
            value={patientBarcode}
            onChange={(e) => setPatientBarcode(e.target.value)}
            placeholder="患者バーコード"
            autoFocus
          />
        </Field>
        <Field label="薬剤（GS1/HOT/YJ/レセ電）">
          <Input
            value={drugBarcode}
            onChange={(e) => setDrugBarcode(e.target.value)}
            placeholder="薬剤バーコード"
          />
        </Field>
        <Field label="実施者（職員番号）">
          <Input
            value={executorBarcode}
            onChange={(e) => setExecutorBarcode(e.target.value)}
            placeholder="実施者バーコード"
          />
        </Field>
      </div>

      {points && (
        <ul className="mt-2 space-y-1">
          {points.map((p) => (
            <li
              key={p.point}
              className={`flex items-center gap-2 rounded px-2 py-1 text-2xs ${
                p.matched ? 'bg-white text-ink' : 'bg-red-50 text-alert'
              }`}
            >
              <Icon name={p.matched ? 'check' : 'x'} size={13} />
              <span className="w-12 font-semibold">{POINT_LABEL[p.point]}</span>
              <span className="font-mono">{p.scanned || '—'}</span>
              {p.label && <span className="text-muted">{p.label}</span>}
              <span className="ml-auto font-semibold">
                {p.matched ? '一致' : '不一致'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {blocked && (
        <p className="mt-2 flex items-center gap-1 text-2xs font-semibold text-alert">
          <Icon name="warning" size={13} /> 不一致のため実施をブロックしました（照合は記録済）。
        </p>
      )}
      {err && <p className="mt-2 text-2xs text-alert">{err}</p>}

      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="primary"
          onClick={run}
          disabled={pending || !patientBarcode.trim() || !drugBarcode.trim() || !executorBarcode.trim()}
        >
          {pending ? '照合中…' : '照合して実施'}
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 注射オーダ発行（輸液製剤マスタ実検索）
// ──────────────────────────────────────────────────────────────────────────

type Line = InjectionOrderLine & { _key: string };
let _seq = 0;
const nextKey = () => `inj_${Date.now()}_${_seq++}`;

function NewInjectionForm({
  patients,
  onCreated,
}: {
  patients: { id: string; label: string; patientNo: string }[];
  onCreated: () => void;
}) {
  const [patientId, setPatientId] = React.useState('');
  const [route, setRoute] = React.useState(ROUTE_OPTIONS[1]);
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<InjectionMasterCandidate[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [urgent, setUrgent] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setSearching(true);
    const h = setTimeout(async () => {
      const r = await searchInjectionMaster(q);
      if (live) {
        setResults(r);
        setSearching(false);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [q]);

  const addCandidate = (c: InjectionMasterCandidate) => {
    setLines((ls) => [
      ...ls,
      { _key: nextKey(), masterId: c.masterId, code: c.code, name: c.name ?? '', dose: 1, doseUnit: c.unit ?? 'mL' },
    ]);
  };
  const patch = (key: string, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l._key === key ? { ...l, ...p } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l._key !== key));

  const submit = () => {
    setMsg(null);
    setErr(null);
    if (!patientId) {
      setErr('患者を選択してください');
      return;
    }
    if (lines.length === 0) {
      setErr('輸液製剤を1件以上追加してください');
      return;
    }
    start(async () => {
      const r = await createInjectionOrder({
        patientId,
        route,
        lines: lines.map(({ _key, ...rest }) => rest),
        urgent,
      });
      if ('error' in r && r.error) {
        setErr(r.error);
      } else {
        setMsg(`注射オーダを発行しました（${('orderNo' in r && r.orderNo) || ''}）`);
        setLines([]);
        setQ('');
        setResults([]);
        onCreated();
      }
    });
  };

  return (
    <Panel pad={false}>
      <PanelHeader
        title="注射オーダ発行"
        icon={<Icon name="plus" size={15} />}
        desc="輸液製剤マスタ実検索 → 明細 → 発行（実施は左の三点認証）"
      />
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="患者" required>
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)} required>
              <option value="" disabled>
                選択してください
              </option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="投与経路" required>
            <Select value={route} onChange={(e) => setRoute(e.target.value)}>
              {ROUTE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <div className="relative">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="輸液製剤で検索（例: 生理食塩液・ソルデム）"
              className="w-full rounded border border-line py-1.5 pl-8 pr-2.5 text-sm"
            />
          </div>
          <div className="mt-1 max-h-48 overflow-auto rounded border border-line">
            {searching ? (
              <div className="px-3 py-3 text-center text-2xs text-muted">検索中…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-3 text-center text-2xs text-muted">
                {q.trim() ? '該当なし（DB未接続の可能性）' : 'キーワードを入力（注射経路の製剤のみ）'}
              </div>
            ) : (
              results.map((c) => (
                <button
                  key={c.masterId}
                  type="button"
                  onClick={() => addCandidate(c)}
                  className="flex w-full items-center justify-between gap-2 border-b border-line px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-accent-50"
                >
                  <span className="min-w-0">
                    <span className="truncate font-medium text-ink">{c.name}</span>
                    {c.sub && <span className="ml-1 text-2xs text-muted">{c.sub}</span>}
                  </span>
                  <Icon name="plus" size={12} className="shrink-0 text-accent-600" />
                </button>
              ))
            )}
          </div>
        </div>

        {lines.length > 0 && (
          <div className="overflow-hidden rounded border border-line">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="px-2 py-1.5 text-left">製剤</th>
                  <th className="px-1 py-1.5 text-right">量</th>
                  <th className="px-1 py-1.5 text-left">単位</th>
                  <th className="px-1 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l._key} className="border-t border-line align-middle">
                    <td className="px-2 py-1 text-ink">{l.name}</td>
                    <td className="px-1 py-1 text-right">
                      <input
                        type="number"
                        value={l.dose ?? ''}
                        min={0}
                        onChange={(e) =>
                          patch(l._key, { dose: e.target.value === '' ? undefined : Number(e.target.value) })
                        }
                        className="w-16 rounded border border-line px-1.5 py-0.5 text-right text-xs"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={l.doseUnit ?? ''}
                        onChange={(e) => patch(l._key, { doseUnit: e.target.value })}
                        className="w-14 rounded border border-line px-1.5 py-0.5 text-xs"
                      />
                    </td>
                    <td className="px-1 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(l._key)}
                        title="削除"
                        className="text-muted hover:text-alert"
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          緊急オーダ
        </label>

        {err && <p className="text-xs text-alert">{err}</p>}
        {msg && <p className="text-xs text-info">{msg}</p>}

        <Button
          type="button"
          variant="primary"
          className="w-full justify-center"
          disabled={pending || lines.length === 0}
          onClick={submit}
        >
          {pending ? '発行中…' : '注射オーダ発行（依頼）'}
        </Button>
        <p className="text-2xs text-muted">
          発行は監査記録され状態機械で管理されます。実施時の三点認証結果は
          <Badge tone="blue" className="mx-1">
            OrderExecution
          </Badge>
          に記録され、不一致は実施がブロックされます。
        </p>
      </div>
    </Panel>
  );
}
