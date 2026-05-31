'use client';
import * as React from 'react';
import { cn } from './cn.js';

export type SlotState = 'available' | 'booked' | 'blocked';

export interface CalendarSlot {
  /** 列キー（日付 'YYYY-MM-DD' など） */
  day: string;
  /** 行キー（時間枠 'HH:mm' など） */
  time: string;
  state: SlotState;
  /** 予約済の場合の表示ラベル（患者名等） */
  label?: React.ReactNode;
}

export interface CalendarColumn {
  key: string;
  header: React.ReactNode;
}

/**
 * 日×時間枠の予約グリッド — slots[] を空き/予約済/不可で色分けし、
 * クリックで onSelect(slot)。予約枠表・診察枠の可視化に利用。
 */
export function CalendarGrid({
  columns,
  times,
  slots,
  onSelect,
  className,
}: {
  /** 列定義（日付など） */
  columns: CalendarColumn[];
  /** 行ラベル（時間枠） */
  times: string[];
  slots: CalendarSlot[];
  onSelect?: (slot: CalendarSlot) => void;
  className?: string;
}) {
  const map = React.useMemo(() => {
    const m = new Map<string, CalendarSlot>();
    for (const s of slots) m.set(`${s.day}|${s.time}`, s);
    return m;
  }, [slots]);

  const STATE: Record<SlotState, string> = {
    available: 'bg-accent-50 text-accent-700 hover:bg-accent-100',
    booked: 'bg-blue-50 text-info hover:bg-blue-100',
    blocked: 'bg-soft text-muted/60 cursor-not-allowed',
  };
  const LABEL: Record<SlotState, string> = { available: '空き', booked: '予約済', blocked: '—' };

  return (
    <div className={cn('overflow-auto rounded border border-line', className)}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-soft">
            <th className="border-b border-r border-line px-2 py-1.5 text-2xs font-bold uppercase tracking-wide text-muted">
              時間
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                className="border-b border-l border-line px-2 py-1.5 text-center text-2xs font-bold uppercase tracking-wide text-muted whitespace-nowrap"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((t) => (
            <tr key={t}>
              <th className="border-b border-r border-line bg-soft px-2 py-1 text-right font-mono text-2xs font-semibold text-muted whitespace-nowrap">
                {t}
              </th>
              {columns.map((c) => {
                const slot = map.get(`${c.key}|${t}`);
                const state = slot?.state ?? 'blocked';
                const clickable = !!slot && state !== 'blocked' && !!onSelect;
                return (
                  <td key={c.key} className="border-b border-l border-line p-0">
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={clickable ? () => onSelect!(slot!) : undefined}
                      title={slot ? LABEL[state] : undefined}
                      className={cn(
                        'h-9 w-full px-1 text-center transition-colors',
                        STATE[state],
                        clickable ? 'cursor-pointer' : 'cursor-default',
                      )}
                    >
                      <span className="block truncate">
                        {slot?.label ?? (state === 'available' ? '空き' : state === 'booked' ? '予約' : '')}
                      </span>
                    </button>
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
