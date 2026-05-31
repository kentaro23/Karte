'use client';
import * as React from 'react';
import { cn } from './cn.js';
import { Modal } from './modal.js';
import { Button } from './primitives.js';
import { Icon } from './icon.js';

export interface OverrideAction {
  key: string;
  label: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  /** 続行に理由必須の場合、理由未入力では非活性 */
  requiresReason?: boolean;
  disabled?: boolean;
}

/**
 * 警告→解決アクション促し汎用モーダル — 既存 Modal をラップ。
 * 安全チェック（相互作用・重複・禁忌等）の警告提示とオーバーライド操作に利用。
 * reasonRequired 指定時は理由入力欄を表示し、requiresReason アクションに値を渡す。
 */
export function OverrideDialog({
  open,
  title,
  body,
  actions,
  onClose,
  severity = 'alert',
  reasonRequired = false,
  reasonLabel = 'オーバーライド理由',
  reasonValue,
  onReasonChange,
  width = 520,
}: {
  open: boolean;
  title: React.ReactNode;
  body: React.ReactNode;
  /** 下部アクションボタン群（解決操作） */
  actions: OverrideAction[];
  onClose: () => void;
  severity?: 'alert' | 'warn';
  /** 続行に理由を必須化 */
  reasonRequired?: boolean;
  reasonLabel?: string;
  /** 理由の制御値（未指定なら内部 state） */
  reasonValue?: string;
  onReasonChange?: (value: string) => void;
  width?: number;
}) {
  const [internalReason, setInternalReason] = React.useState('');
  const reason = reasonValue ?? internalReason;
  const setReason = (v: string) => {
    onReasonChange?.(v);
    if (reasonValue === undefined) setInternalReason(v);
  };
  const reasonOk = !reasonRequired || reason.trim().length > 0;

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        閉じる
      </Button>
      {actions.map((a) => (
        <Button
          key={a.key}
          variant={a.variant ?? 'primary'}
          disabled={a.disabled || (a.requiresReason && !reasonOk)}
          onClick={a.onClick}
        >
          {a.label}
        </Button>
      ))}
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer} width={width} tone="alert">
      <div className="flex gap-3">
        <span
          className={cn(
            'mt-0.5 shrink-0',
            severity === 'alert' ? 'text-alert' : 'text-warn',
          )}
        >
          <Icon name="warning" size={22} />
        </span>
        <div className="flex-1 text-sm text-ink">{body}</div>
      </div>
      {reasonRequired && (
        <label className="mt-4 flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink">
            {reasonLabel}
            <span className="ml-0.5 text-alert">*</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="続行する場合は理由を入力してください"
            className="resize-y rounded border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </label>
      )}
    </Modal>
  );
}
