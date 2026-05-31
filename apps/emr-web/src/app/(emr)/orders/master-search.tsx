'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ORDER_TYPE_LABEL,
  detailKindForOrderType,
  type OrderType,
  type OrderDetailKind,
} from '@medixus/domain';
import { Panel, PanelHeader, Field, Select, Button, Icon, Badge, InlineEditCell } from '@medixus/ui';
import {
  searchOrderMaster,
  createDetailedOrder,
  type OrderMasterCandidate,
  type OrderLineInput,
} from './actions';

/** order-detail 型を持つ（マスタ実検索→行内編集できる）オーダ種別。 */
const DETAIL_TYPES: OrderType[] = [
  'RX',
  'INJECTION',
  'TRANSFUSION',
  'CHEMO',
  'LAB',
  'BACTERIOLOGY',
  'PATHOLOGY',
  'PHYSIOLOGY',
  'TREATMENT',
  'SURGERY',
  'REHAB',
  'DIALYSIS',
  'RADIOLOGY',
  'ENDOSCOPY',
];

const USAGE_OPTIONS = [
  '毎食後',
  '毎食前',
  '朝食後',
  '夕食後',
  '就寝前',
  '8時間毎',
  '6時間毎',
  '頓用',
  '外用',
  '隔日',
];

const SEARCH_PLACEHOLDER: Partial<Record<OrderDetailKind, string>> = {
  RX: '薬剤名・一般名で検索（例: アムロジピン）',
  INJECTION: '注射薬剤で検索（例: 生理食塩液）',
  EXAM: '検査名で検索（例: 血算・CRP）',
};

/** 1行の編集状態（OrderLineInput を画面で扱う形）。 */
type Line = OrderLineInput & { _key: string };

let _seq = 0;
const nextKey = () => `ln_${Date.now()}_${_seq++}`;

export function OrderMasterSearch({
  patients,
  defaultType,
}: {
  patients: { id: string; label: string }[];
  defaultType?: string;
}) {
  const router = useRouter();
  const [patientId, setPatientId] = React.useState('');
  const [type, setType] = React.useState<OrderType>(
    (defaultType as OrderType) && DETAIL_TYPES.includes(defaultType as OrderType)
      ? (defaultType as OrderType)
      : 'RX',
  );
  const kind = detailKindForOrderType(type);

  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<OrderMasterCandidate[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [dispense, setDispense] = React.useState<'IN_HOUSE' | 'OUTSIDE'>('IN_HOUSE');
  const [specimen, setSpecimen] = React.useState('');
  const [urgent, setUrgent] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // 種別切替時は検索結果・明細をリセット（detail スキーマが変わるため）。
  const onTypeChange = (t: OrderType) => {
    setType(t);
    setResults([]);
    setLines([]);
    setQ('');
    setMsg(null);
    setErr(null);
  };

  // キーワード→候補（debounce + fail-soft）。
  React.useEffect(() => {
    if (!kind || (kind !== 'RX' && kind !== 'INJECTION' && kind !== 'EXAM')) {
      setResults([]);
      return;
    }
    let live = true;
    setSearching(true);
    const h = setTimeout(async () => {
      const r = await searchOrderMaster(type, q);
      if (live) {
        setResults(r);
        setSearching(false);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [q, type, kind]);

  const addCandidate = (c: OrderMasterCandidate) => {
    setLines((ls) => [
      ...ls,
      {
        _key: nextKey(),
        masterId: c.masterId,
        code: c.code,
        name: c.name ?? '',
        qty: 1,
        unit: c.unit ?? (kind === 'RX' ? '錠' : ''),
        usage: kind === 'RX' ? '毎食後' : kind === 'INJECTION' ? (c.route ?? 'IV') : '',
        days: kind === 'RX' ? 7 : undefined,
        points: c.points,
      },
    ]);
  };

  // PROCEDURE/IMAGE はマスタ無→フリー入力行を直接追加。
  const addFreeLine = () => {
    setLines((ls) => [
      ...ls,
      { _key: nextKey(), name: '', qty: 1, usage: '', points: undefined },
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
    if (lines.length === 0 || lines.every((l) => !l.name.trim())) {
      setErr('オーダ明細を1件以上追加してください');
      return;
    }
    start(async () => {
      const r = await createDetailedOrder({
        patientId,
        orderType: type,
        lines: lines.map(
          (l): OrderLineInput => ({
            masterId: l.masterId,
            code: l.code,
            name: l.name,
            qty: l.qty,
            unit: l.unit,
            usage: l.usage,
            days: l.days,
            amountPerDay: l.amountPerDay,
            points: l.points,
            site: l.site,
            modality: l.modality,
            bodyPart: l.bodyPart,
          }),
        ),
        dispenseType: kind === 'RX' ? dispense : undefined,
        specimen: kind === 'EXAM' ? specimen || undefined : undefined,
        urgent,
      });
      if (r && 'error' in r && r.error) {
        setErr(r.error);
      } else {
        setMsg(`オーダを発行しました（${('orderNo' in r && r.orderNo) || ''} / 状態: 依頼）`);
        setLines([]);
        setQ('');
        setResults([]);
        router.refresh();
      }
    });
  };

  const totalPoints = lines.reduce((s, l) => s + (l.points ?? 0), 0);
  const hasMaster = kind === 'RX' || kind === 'INJECTION' || kind === 'EXAM';

  return (
    <Panel pad={false}>
      <PanelHeader
        title="マスタ実検索オーダ"
        icon={<Icon name="search" size={15} />}
        desc="キーワード→候補→行内編集（数量・用法・院内外・日数）。検査は点数表示"
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
          <Field label="オーダ種別" required>
            <Select value={type} onChange={(e) => onTypeChange(e.target.value as OrderType)}>
              {DETAIL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ORDER_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {kind === 'RX' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
            <span className="text-muted">院内外:</span>
            <span className="inline-flex overflow-hidden rounded border border-line">
              {(['IN_HOUSE', 'OUTSIDE'] as const).map((dt) => (
                <button
                  key={dt}
                  type="button"
                  onClick={() => setDispense(dt)}
                  className={`px-2.5 py-0.5 ${
                    dispense === dt ? 'bg-accent-500 text-white' : 'bg-white text-ink'
                  }`}
                >
                  {dt === 'IN_HOUSE' ? '院内処方' : '院外処方'}
                </button>
              ))}
            </span>
          </div>
        )}
        {kind === 'EXAM' && (
          <Field label="検体（任意）">
            <input
              value={specimen}
              onChange={(e) => setSpecimen(e.target.value)}
              placeholder="例: 血清・全血・尿"
              className="rounded border border-line px-2.5 py-1.5 text-sm"
            />
          </Field>
        )}

        {/* キーワード検索（マスタ有りの種別のみ） */}
        {hasMaster ? (
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
                placeholder={SEARCH_PLACEHOLDER[kind!] ?? '名称で検索'}
                className="w-full rounded border border-line py-1.5 pl-8 pr-2.5 text-sm"
              />
            </div>
            <div className="mt-1 max-h-48 overflow-auto rounded border border-line">
              {searching ? (
                <div className="px-3 py-3 text-center text-2xs text-muted">検索中…</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-center text-2xs text-muted">
                  {q.trim() ? '該当なし（DB未接続の可能性）' : 'キーワードを入力'}
                </div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.masterId ?? c.code ?? c.name}
                    type="button"
                    onClick={() => addCandidate(c)}
                    className="flex w-full items-center justify-between gap-2 border-b border-line px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-accent-50"
                  >
                    <span className="min-w-0">
                      <span className="truncate font-medium text-ink">{c.name}</span>
                      {c.sub && <span className="ml-1 text-2xs text-muted">{c.sub}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {kind === 'EXAM' && (
                        <Badge tone="blue">{c.points ?? 0} 点</Badge>
                      )}
                      <Icon name="plus" size={12} className="text-accent-600" />
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded border border-dashed border-line bg-soft px-3 py-2 text-2xs text-muted">
            <span>{ORDER_TYPE_LABEL[type]}はマスタ未整備のためフリー入力です</span>
            <Button size="sm" variant="secondary" onClick={addFreeLine}>
              ＋行追加
            </Button>
          </div>
        )}

        {/* 明細：行内編集テーブル */}
        {lines.length > 0 && (
          <div className="overflow-hidden rounded border border-line">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="px-2 py-1.5 text-left">{kind === 'EXAM' ? '検査名' : '品名'}</th>
                  <th className="px-1 py-1.5 text-right">{kind === 'EXAM' ? '回数' : '数量'}</th>
                  {kind !== 'EXAM' && <th className="px-1 py-1.5 text-left">単位</th>}
                  {(kind === 'RX' || kind === 'INJECTION' || kind === 'PROCEDURE') && (
                    <th className="px-1 py-1.5 text-left">{kind === 'INJECTION' ? '経路' : '用法'}</th>
                  )}
                  {kind === 'RX' && <th className="px-1 py-1.5 text-right">日数</th>}
                  {kind === 'EXAM' && <th className="px-1 py-1.5 text-right">点数</th>}
                  <th className="px-1 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l._key} className="border-t border-line align-middle">
                    <td className="px-1 py-0.5">
                      <InlineEditCell
                        value={l.name}
                        onSave={(v) => patch(l._key, { name: v })}
                        placeholder="名称"
                        disabled={!!l.masterId}
                        emptyLabel="名称を入力"
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <InlineEditCell
                        value={String(l.qty ?? '')}
                        onSave={(v) => patch(l._key, { qty: v === '' ? undefined : Number(v) })}
                        inputType="number"
                        align="right"
                        emptyLabel="—"
                      />
                    </td>
                    {kind !== 'EXAM' && (
                      <td className="px-1 py-0.5">
                        <InlineEditCell
                          value={l.unit ?? ''}
                          onSave={(v) => patch(l._key, { unit: v })}
                          emptyLabel="単位"
                        />
                      </td>
                    )}
                    {(kind === 'RX' || kind === 'INJECTION' || kind === 'PROCEDURE') && (
                      <td className="px-1 py-0.5">
                        {kind === 'RX' ? (
                          <InlineEditCell
                            type="select"
                            value={l.usage ?? ''}
                            onSave={(v) => patch(l._key, { usage: v })}
                            options={USAGE_OPTIONS.map((u) => ({ value: u, label: u }))}
                            emptyLabel="用法"
                          />
                        ) : (
                          <InlineEditCell
                            value={l.usage ?? ''}
                            onSave={(v) => patch(l._key, { usage: v })}
                            emptyLabel={kind === 'INJECTION' ? '経路' : '部位'}
                          />
                        )}
                      </td>
                    )}
                    {kind === 'RX' && (
                      <td className="px-1 py-0.5">
                        <InlineEditCell
                          value={String(l.days ?? '')}
                          onSave={(v) => patch(l._key, { days: v === '' ? undefined : Number(v) })}
                          inputType="number"
                          align="right"
                          emptyLabel="—"
                          display={(v) => (v ? `${v}日` : '')}
                        />
                      </td>
                    )}
                    {kind === 'EXAM' && (
                      <td className="px-1 py-0.5 text-right font-mono text-2xs text-ink">
                        {l.points ?? 0} 点
                      </td>
                    )}
                    <td className="px-1 py-0.5 text-right">
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
              {kind === 'EXAM' && (
                <tfoot>
                  <tr className="border-t border-line bg-soft/60 text-2xs">
                    <td className="px-2 py-1 font-medium text-muted" colSpan={2}>
                      合計（概算）
                    </td>
                    <td className="px-1 py-1 text-right font-mono font-bold text-ink" colSpan={2}>
                      {totalPoints} 点
                    </td>
                  </tr>
                </tfoot>
              )}
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
          {pending ? '発行中…' : 'オーダ発行（依頼）'}
        </Button>
        <p className="text-2xs text-muted">
          発行は監査記録され、状態機械（DRAFT→依頼→受付→実施→結果→承認）と版管理で管理されます。
          処方の禁忌・相互作用・重複・極量チェックは
          <Badge tone="green" className="mx-1">
            カルテ画面
          </Badge>
          から発行してください。
        </p>
      </div>
    </Panel>
  );
}
