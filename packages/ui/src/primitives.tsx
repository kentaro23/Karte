import * as React from 'react';
import { cn } from './cn.js';

/* ── Button ─────────────────────────────────────────────────────────────── */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type BtnSize = 'sm' | 'md';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent-500 text-white border-accent-600 hover:bg-accent-600',
  secondary: 'bg-white text-accent-700 border-accent-500 hover:bg-accent-50',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-black/5',
  danger: 'bg-white text-alert border-alert hover:bg-red-50',
  subtle: 'bg-soft text-ink border-line hover:bg-line/60',
};
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return (
    <button
      {...p}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
        BTN[variant],
        className,
      )}
    />
  );
}

/* ── Badge / StatusPill ─────────────────────────────────────────────────── */
type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'teal';
const TONE: Record<Tone, string> = {
  green: 'bg-accent-50 text-accent-700 border-accent-200',
  amber: 'bg-amber-50 text-warn border-amber-300',
  red: 'bg-red-50 text-alert border-red-300',
  blue: 'bg-blue-50 text-info border-blue-200',
  gray: 'bg-soft text-muted border-line',
  teal: 'bg-teal-50 text-teal border-teal-200',
};
export function Badge({
  children,
  tone = 'gray',
  title,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
export function Dot({ tone = 'gray' }: { tone?: Tone }) {
  const c: Record<Tone, string> = {
    green: 'bg-accent-500',
    amber: 'bg-amber-500',
    red: 'bg-alert',
    blue: 'bg-info',
    gray: 'bg-gray-400',
    teal: 'bg-teal',
  };
  return <span className={cn('inline-block h-2 w-2 rounded-full', c[tone])} />;
}

/* ── Panel ──────────────────────────────────────────────────────────────── */
export function Panel({
  children,
  className,
  pad = true,
}: {
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-card border border-line bg-white shadow-panel',
        pad && 'p-4',
        className,
      )}
    >
      {children}
    </section>
  );
}
export function PanelHeader({
  title,
  desc,
  actions,
  icon,
}: {
  title: React.ReactNode;
  desc?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 border-b border-line pb-2.5">
      <div className="flex items-start gap-2">
        {icon && <span className="mt-0.5 text-accent-600">{icon}</span>}
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded border border-line bg-soft px-3 py-2', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-3 text-2xs font-bold uppercase tracking-wider text-muted">
      {children}
    </div>
  );
}

export function EmptyState({
  title = 'データがありません',
  hint,
  icon,
}: {
  title?: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-line">{icon}</div>}
      <p className="text-sm font-medium text-muted">{title}</p>
      {hint && <p className="text-xs text-muted/80">{hint}</p>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-soft px-1.5 py-0.5 font-mono text-2xs text-muted">
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin text-accent-500', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ── Form controls ──────────────────────────────────────────────────────── */
export function Field({
  label,
  children,
  hint,
  required,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs font-semibold text-ink">
        {label}
        {required && <span className="ml-0.5 text-alert">*</span>}
      </span>
      {children}
      {hint && <span className="text-2xs text-muted">{hint}</span>}
    </label>
  );
}
const ctrl =
  'rounded border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 disabled:bg-soft';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...p }, ref) {
    return <input ref={ref} {...p} className={cn(ctrl, className)} />;
  },
);
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...p }, ref) {
  return <select ref={ref} {...p} className={cn(ctrl, 'pr-7', className)} />;
});
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} {...p} className={cn(ctrl, 'resize-y', className)} />;
});
