'use client';
import * as React from 'react';
import { cn } from './cn.js';
import { Button } from './primitives.js';
import { Icon } from './icon.js';

export interface ColumnToggleItem {
  key: string;
  label: React.ReactNode;
  /** 常時表示・非表示固定（チェックボックス操作不可） */
  locked?: boolean;
}

/**
 * カラム表示切替ドロップダウン — カラム定義配列から ON/OFF を選択し、
 * 表示中のキー配列を onChange(visibleKeys) で返す。DataTable の列出し分けに利用。
 */
export function ColumnToggle({
  columns,
  visible,
  onChange,
  label = '列表示',
  className,
}: {
  columns: ColumnToggleItem[];
  /** 表示中カラムキー */
  visible: string[];
  onChange: (visibleKeys: string[]) => void;
  label?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const set = new Set(visible);
  const toggle = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (col?.locked) return;
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // カラム定義順を保持して返す
    onChange(columns.filter((c) => next.has(c.key)).map((c) => c.key));
  };
  const allKeys = columns.map((c) => c.key);
  const shownCount = columns.filter((c) => set.has(c.key)).length;

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="board" size={13} />
        {label}
        <span className="text-2xs text-muted">
          {shownCount}/{columns.length}
        </span>
        <Icon name="chevron" size={12} className={cn('transition-transform', open && 'rotate-90')} />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-80 w-56 overflow-auto rounded-card border border-line bg-white py-1 shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
            <span className="text-2xs font-bold uppercase tracking-wider text-muted">{label}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChange(allKeys)}
                className="text-2xs text-accent-700 hover:underline"
              >
                全て
              </button>
              <button
                type="button"
                onClick={() => onChange(columns.filter((c) => c.locked && set.has(c.key)).map((c) => c.key))}
                className="text-2xs text-muted hover:underline"
              >
                クリア
              </button>
            </div>
          </div>
          {columns.map((c) => {
            const checked = set.has(c.key);
            return (
              <label
                key={c.key}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 text-sm text-ink',
                  c.locked ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-accent-50',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={c.locked}
                  onChange={() => toggle(c.key)}
                  className="accent-accent-500"
                />
                <span className="truncate">{c.label}</span>
                {c.locked && <Icon name="lock" size={11} className="ml-auto text-muted" />}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
