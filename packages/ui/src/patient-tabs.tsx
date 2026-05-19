'use client';
import * as React from 'react';
import { patientWindowColor, MAX_OPEN_PATIENTS } from '@medixus/domain';
import { cn } from './cn.js';
import { Icon } from './icon.js';

export interface OpenPatient {
  patientId: string;
  patientNo: string;
  name: string;
}

/** 5名同時カルテ・色分けタブ — 別紙1 §3.1(19)(20), 別紙3 #89-92. */
export function PatientTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: OpenPatient[];
  activeId: string;
  onSelect: (patientId: string) => void;
  onClose?: (patientId: string) => void;
}) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto bg-soft px-2 pt-1.5">
      {tabs.map((t) => {
        const color = patientWindowColor(t.patientId);
        const active = t.patientId === activeId;
        return (
          <div
            key={t.patientId}
            onClick={() => onSelect(t.patientId)}
            className={cn(
              'group flex cursor-pointer items-center gap-2 rounded-t border border-b-0 px-3 py-1.5 text-xs',
              active ? 'bg-white' : 'bg-soft/60 hover:bg-white/70',
            )}
            style={{ borderTop: `3px solid ${color}` }}
          >
            <span className="font-mono text-2xs text-muted">{t.patientNo}</span>
            <span className={cn('font-semibold', active ? 'text-ink' : 'text-muted')}>
              {t.name}
            </span>
            {onClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.patientId);
                }}
                className="text-muted/50 hover:text-alert"
                aria-label="閉じる"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        );
      })}
      <span className="self-center pl-2 text-2xs text-muted/70">
        {tabs.length}/{MAX_OPEN_PATIENTS} 名 同時カルテ
      </span>
    </div>
  );
}
