'use client';
import * as React from 'react';
import { Badge, Button, Icon, EmptyState, Tabs } from '@medixus/ui';
import { type SoapBlock, type SoapKind } from '@medixus/domain';

/** 過去カルテ参照（FR-CHT-05）で扱う1日分のカルテ＝最新版ノート + その日のオーダ。 */
export interface PastEntry {
  date: string; // ISO – 記録日（日単位キー）
  noteId: string | null;
  version: number;
  status: string;
  blocks: SoapBlock[];
  orders: PastOrder[];
}

export interface PastOrder {
  id: string;
  orderType: string; // OrderType
  orderTypeLabel: string;
  status: string;
  summary: string; // 表示用サマリ（薬剤名/検査名 等）
}

const SOAP_KINDS: SoapKind[] = ['S', 'O', 'A', 'P'];
const SOAP_SHORT: Record<SoapKind, string> = { S: 'S', O: 'O', A: 'A', P: 'P', FREE: 'F' };

function sectionText(blocks: SoapBlock[], kind: SoapKind): string {
  return (
    blocks
      .find((b) => b.kind === kind)
      ?.spans.map((s) => s.text)
      .join('') ?? ''
  );
}

function hasAnyText(blocks: SoapBlock[]): boolean {
  return blocks.some((b) => b.spans.some((s) => s.text.trim().length > 0));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' });
}

/**
 * 診療履歴（縦並び＋種別フィルタ）／カルテ一覧（横並び比較）／
 * 前回SOAP・オーダのセクション単位Do。FR-CHT-05。
 */
export function HistoryPanel({
  entries,
  onDoSection,
  onDoOrder,
  busy,
}: {
  entries: PastEntry[];
  /** 前回SOAPのあるセクションを当日カルテへコピー（出所をトレース）。 */
  onDoSection: (kind: SoapKind, text: string, source: { date: string; noteId: string | null }) => void;
  /** 前回オーダをDoで当日に複製（buildDoOrder 起票）。 */
  onDoOrder: (orderId: string, label: string) => void;
  busy: boolean;
}) {
  const [view, setView] = React.useState<'vertical' | 'horizontal'>('vertical');
  // オーダ種別フィルタ（'ALL' or OrderType）
  const [typeFilter, setTypeFilter] = React.useState<string>('ALL');

  // 履歴に出現するオーダ種別を集計（フィルタ選択肢）
  const orderTypes = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) for (const o of e.orders) m.set(o.orderType, o.orderTypeLabel);
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [entries]);

  // 縦並び（複数日）はフィルタで「そのオーダ種別を含む日」に絞る
  const visible = React.useMemo(() => {
    if (typeFilter === 'ALL') return entries;
    return entries
      .map((e) => ({ ...e, orders: e.orders.filter((o) => o.orderType === typeFilter) }))
      .filter((e) => e.orders.length > 0);
  }, [entries, typeFilter]);

  if (entries.length === 0) {
    return <EmptyState title="過去カルテなし" hint="この患者の確定済みカルテ・オーダがここに表示されます" />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <Tabs
          items={[
            { key: 'vertical', label: '診療履歴（縦）' },
            { key: 'horizontal', label: 'カルテ一覧（横）' },
          ]}
          value={view}
          onChange={(v) => setView(v as 'vertical' | 'horizontal')}
          size="sm"
          className="border-0"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="ml-auto rounded border border-line px-1.5 py-0.5 text-2xs"
          title="オーダ種別フィルタ"
        >
          <option value="ALL">全種別</option>
          {orderTypes.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {view === 'vertical' ? (
        <div className="flex-1 overflow-auto p-2">
          {visible.length === 0 && <EmptyState title="該当する記録なし" hint="フィルタ条件に一致する日がありません" />}
          {visible.map((e) => (
            <DayCard key={e.date + (e.noteId ?? '')} entry={e} onDoSection={onDoSection} onDoOrder={onDoOrder} busy={busy} />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-2">
          <HorizontalGrid entries={entries} onDoSection={onDoSection} busy={busy} />
        </div>
      )}
    </div>
  );
}

/** 縦並びの1日カード：SOAP（セクション毎にDoボタン）＋当日オーダ（Doボタン）。 */
function DayCard({
  entry,
  onDoSection,
  onDoOrder,
  busy,
}: {
  entry: PastEntry;
  onDoSection: (kind: SoapKind, text: string, source: { date: string; noteId: string | null }) => void;
  onDoOrder: (orderId: string, label: string) => void;
  busy: boolean;
}) {
  return (
    <div className="mb-2 rounded border border-line bg-white">
      <div className="flex items-center gap-1.5 border-b border-line bg-soft px-2 py-1">
        <Icon name="clock" size={12} />
        <span className="text-xs font-semibold text-ink">{fmtDate(entry.date)}</span>
        {entry.noteId && <span className="text-2xs text-muted">第{entry.version}版</span>}
        {entry.status === 'LOCKED' && <Badge tone="blue">ロック</Badge>}
      </div>
      <div className="p-2">
        {entry.noteId && hasAnyText(entry.blocks) ? (
          <div className="flex flex-col gap-1">
            {SOAP_KINDS.map((k) => {
              const t = sectionText(entry.blocks, k);
              if (!t.trim()) return null;
              return (
                <div key={k} className="group flex items-start gap-1.5">
                  <span className="mt-0.5 w-4 shrink-0 rounded bg-accent-100 text-center text-2xs font-bold text-accent-700">
                    {SOAP_SHORT[k]}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-2xs text-ink">{t}</span>
                  <button
                    disabled={busy}
                    onClick={() => onDoSection(k, t, { date: entry.date, noteId: entry.noteId })}
                    className="shrink-0 rounded border border-line px-1 py-0.5 text-2xs text-accent-700 opacity-60 hover:bg-accent-50 hover:opacity-100 disabled:opacity-40"
                    title={`${SOAP_SHORT[k]} を当日カルテへコピー（Do）`}
                  >
                    Do
                  </button>
                </div>
              );
            })}
            <button
              disabled={busy}
              onClick={() =>
                SOAP_KINDS.forEach((k) => {
                  const t = sectionText(entry.blocks, k);
                  if (t.trim()) onDoSection(k, t, { date: entry.date, noteId: entry.noteId });
                })
              }
              className="mt-0.5 self-end rounded border border-accent-300 bg-accent-50 px-1.5 py-0.5 text-2xs text-accent-700 hover:bg-accent-100 disabled:opacity-40"
              title="このカルテ全SOAPを当日へDo"
            >
              <Icon name="template" size={10} /> 全文Do
            </button>
          </div>
        ) : (
          <div className="text-2xs text-muted">SOAP記載なし</div>
        )}

        {entry.orders.length > 0 && (
          <div className="mt-2 border-t border-line pt-1.5">
            <div className="mb-1 text-2xs font-bold text-muted">オーダ</div>
            {entry.orders.map((o) => (
              <div key={o.id} className="flex items-center gap-1.5 py-0.5">
                <Badge tone="gray">{o.orderTypeLabel}</Badge>
                <span className="min-w-0 flex-1 truncate text-2xs text-ink">{o.summary}</span>
                <button
                  disabled={busy}
                  onClick={() => onDoOrder(o.id, `${o.orderTypeLabel}：${o.summary}`)}
                  className="shrink-0 rounded border border-line px-1 py-0.5 text-2xs text-accent-700 hover:bg-accent-50 disabled:opacity-40"
                  title="このオーダをDoで当日に複製"
                >
                  Do
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 横並び（カルテ一覧）：日付を列にしてS/O/A/Pを並列比較。セクションDo可。 */
function HorizontalGrid({
  entries,
  onDoSection,
  busy,
}: {
  entries: PastEntry[];
  onDoSection: (kind: SoapKind, text: string, source: { date: string; noteId: string | null }) => void;
  busy: boolean;
}) {
  const cols = entries.filter((e) => e.noteId);
  if (cols.length === 0) return <EmptyState title="比較できるカルテがありません" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-2xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border border-line bg-soft px-1 py-1 text-left">区分</th>
            {cols.map((e) => (
              <th key={e.date + (e.noteId ?? '')} className="min-w-[140px] border border-line bg-soft px-1 py-1 text-left">
                <div className="font-semibold">{fmtDate(e.date)}</div>
                <div className="font-normal text-muted">第{e.version}版</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SOAP_KINDS.map((k) => (
            <tr key={k}>
              <th className="sticky left-0 z-10 border border-line bg-white px-1 py-1 text-left align-top text-accent-700">
                {SOAP_SHORT[k]}
              </th>
              {cols.map((e) => {
                const t = sectionText(e.blocks, k);
                return (
                  <td key={e.date + (e.noteId ?? '')} className="border border-line px-1 py-1 align-top">
                    <div className="whitespace-pre-wrap break-words text-ink">{t || <span className="text-muted">—</span>}</div>
                    {t.trim() && (
                      <button
                        disabled={busy}
                        onClick={() => onDoSection(k, t, { date: e.date, noteId: e.noteId })}
                        className="mt-0.5 rounded border border-line px-1 py-0.5 text-accent-700 hover:bg-accent-50 disabled:opacity-40"
                        title="この区分を当日へDo"
                      >
                        Do
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
