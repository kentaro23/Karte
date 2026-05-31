'use client';
import * as React from 'react';
import { cn } from './cn.js';

export type DxKind = 'confirmed' | 'main' | 'suspected';

const ITEMS: { kind: DxKind; label: string }[] = [
  { kind: 'confirmed', label: '確定' },
  { kind: 'main', label: '主病' },
  { kind: 'suspected', label: '疑い' },
];

/**
 * 病名属性の3連ボタン「確定 / 主病 / 疑い」— onPick(kind) で選択を通知。
 * value を渡すと選択状態を強調表示。病名登録パネルで利用。
 */
export function ThreeButtonDx({
  value,
  onPick,
  size = 'md',
  disabled = false,
  className,
}: {
  /** 現在の選択（複数属性が同時に立つ運用もあるため単一選択を強制しない） */
  value?: DxKind | null;
  onPick: (kind: DxKind) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}) {
  const TONE: Record<DxKind, string> = {
    confirmed: 'border-accent-500 bg-accent-500 text-white',
    main: 'border-info bg-info text-white',
    suspected: 'border-warn bg-amber-50 text-warn',
  };
  return (
    <div className={cn('inline-flex overflow-hidden rounded border border-line', className)} role="group">
      {ITEMS.map((it, i) => {
        const active = value === it.kind;
        return (
          <button
            key={it.kind}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(it.kind)}
            className={cn(
              'font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
              i > 0 && 'border-l border-line',
              active ? TONE[it.kind] : 'bg-white text-ink hover:bg-soft',
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
