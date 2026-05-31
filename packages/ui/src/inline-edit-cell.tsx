'use client';
import * as React from 'react';
import { cn } from './cn.js';
import { Icon } from './icon.js';

export interface InlineEditOption {
  value: string;
  label: React.ReactNode;
}

/**
 * 行内編集セル — 表示状態からクリックで入力に切替え、確定で onSave(value)。
 * text / select の両モードに対応。汎用テーブルの編集セルとして再利用。
 */
export function InlineEditCell({
  value,
  onSave,
  type = 'text',
  options,
  placeholder,
  display,
  emptyLabel = '—',
  inputType = 'text',
  disabled = false,
  align = 'left',
  className,
}: {
  value: string;
  onSave: (value: string) => void;
  type?: 'text' | 'select';
  /** select モード時の選択肢 */
  options?: InlineEditOption[];
  placeholder?: string;
  /** 表示時のレンダリングをカスタムする（未指定なら value / option.label） */
  display?: (value: string) => React.ReactNode;
  /** value が空のときの表示 */
  emptyLabel?: React.ReactNode;
  /** text モード時の input type（number/date 等） */
  inputType?: React.HTMLInputTypeAttribute;
  disabled?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const selectRef = React.useRef<HTMLSelectElement>(null);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  React.useEffect(() => {
    if (!editing) return;
    const el = type === 'select' ? selectRef.current : inputRef.current;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [editing, type]);

  const open = () => {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
  };
  const commit = (next: string) => {
    setEditing(false);
    if (next !== value) onSave(next);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  const alignCls =
    align === 'right' ? 'text-right justify-end' : align === 'center' ? 'text-center justify-center' : 'text-left';
  const ctrl =
    'w-full rounded border border-accent-500 bg-white px-2 py-1 text-sm text-ink outline-none focus:ring-2 focus:ring-accent-100';

  if (editing) {
    if (type === 'select') {
      return (
        <select
          ref={selectRef}
          value={draft}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => e.key === 'Escape' && cancel()}
          className={cn(ctrl, 'pr-7', className)}
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {typeof o.label === 'string' ? o.label : o.value}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        ref={inputRef}
        type={inputType}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
          else if (e.key === 'Escape') cancel();
        }}
        className={cn(ctrl, className)}
      />
    );
  }

  const shown =
    display?.(value) ??
    (type === 'select'
      ? (options?.find((o) => o.value === value)?.label ?? value)
      : value);
  const isEmpty = value === '' || value == null;

  return (
    <button
      type="button"
      onClick={open}
      disabled={disabled}
      title={disabled ? undefined : 'クリックして編集'}
      className={cn(
        'group inline-flex w-full items-center gap-1 rounded px-2 py-1 text-sm text-ink',
        !disabled && 'cursor-text hover:bg-accent-50',
        disabled && 'cursor-default',
        alignCls,
        className,
      )}
    >
      <span className={cn('truncate', isEmpty && 'text-muted')}>{isEmpty ? emptyLabel : shown}</span>
      {!disabled && (
        <Icon
          name="edit"
          size={12}
          className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
    </button>
  );
}
