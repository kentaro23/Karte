'use client';
import * as React from 'react';
import { cn } from './cn.js';
import { Icon } from './icon.js';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  tone = 'default',
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  tone?: 'default' | 'alert';
}) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className="max-h-[90vh] overflow-hidden rounded-card bg-white shadow-pop"
      >
        <div
          className={cn(
            'flex items-center justify-between border-b px-4 py-3',
            tone === 'alert' ? 'border-red-200 bg-red-50' : 'border-line bg-soft',
          )}
        >
          <h3 className={cn('text-sm font-bold', tone === 'alert' ? 'text-alert' : 'text-ink')}>
            {title}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="閉じる">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="max-h-[64vh] overflow-auto p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line bg-soft px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
