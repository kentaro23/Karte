'use client';
import * as React from 'react';
import { cn } from './cn.js';

export interface TabItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
  size = 'md',
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cn('flex items-end gap-0.5 border-b border-line', className)}>
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-t border-b-2 font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
              active
                ? 'border-accent-500 bg-white text-accent-700'
                : 'border-transparent text-muted hover:bg-black/5 hover:text-ink',
            )}
          >
            {t.icon}
            {t.label}
            {t.badge != null && (
              <span className="ml-0.5 rounded-full bg-soft px-1.5 text-2xs text-muted">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
