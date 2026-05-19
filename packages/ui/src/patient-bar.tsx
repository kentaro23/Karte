import * as React from 'react';
import { patientWindowColor } from '@medixus/domain';
import { cn } from './cn.js';
import { Badge } from './primitives.js';
import { Icon } from './icon.js';

/** 患者情報バー（取り違え防止）— 別紙1 §3 冒頭, §2.9. Always-visible. */
export interface PatientBarData {
  patientId: string;
  patientNo: string;
  name: string;
  kana: string;
  gender: string;
  age: number;
  birthDate?: string;
  bloodType?: string;
  inout: string;
  ward?: string | null;
  dept?: string | null;
  mode: string;
  insurance?: string | null;
  allergies: string[];
  infections: string[];
  isVip?: boolean;
  sameNameWarning?: boolean;
  isTemporaryId?: boolean;
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-2xs text-muted">{label}</span>
      <span className="text-xs font-medium text-ink">{value}</span>
    </span>
  );
}

export function PatientBar({ p }: { p: PatientBarData }) {
  const accent = patientWindowColor(p.patientId);
  const clean = p.allergies.length === 0 && p.infections.length === 0;
  return (
    <div
      className="sticky top-0 z-40 border-b border-line bg-white"
      style={{ borderLeft: `6px solid ${accent}` }}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2">
        <span className="font-mono text-xs text-muted">ID {p.patientNo}</span>
        <span className="text-lg font-bold text-ink">{p.name}</span>
        <span className="text-xs text-muted">（{p.kana}）</span>
        <Item label="性別" value={p.gender} />
        <Item label="年齢" value={`${p.age}歳`} />
        {p.birthDate && <Item label="生年月日" value={p.birthDate} />}
        {p.bloodType && <Item label="血液型" value={p.bloodType} />}
        <Item label="区分" value={p.inout} />
        {p.dept && <Item label="診療科" value={p.dept} />}
        {p.ward && <Item label="病棟" value={p.ward} />}
        {p.insurance && <Item label="保険" value={p.insurance} />}
        <Item label="モード" value={p.mode} />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {p.isTemporaryId && <Badge tone="amber">仮ID</Badge>}
          {p.isVip && <Badge tone="amber">VIP</Badge>}
          {p.sameNameWarning && (
            <Badge tone="amber" title="同姓同名患者が存在します">
              <Icon name="warning" size={12} /> 同姓同名
            </Badge>
          )}
          {p.allergies.length > 0 && (
            <Badge tone="red" title={p.allergies.join(' / ')}>
              <Icon name="warning" size={12} /> アレルギー: {p.allergies.join('・')}
            </Badge>
          )}
          {p.infections.length > 0 && (
            <Badge tone="red" title={p.infections.join(' / ')}>
              <Icon name="warning" size={12} /> 感染症: {p.infections.join('・')}
            </Badge>
          )}
          {clean && <Badge tone="green">アレルギー・感染症 なし</Badge>}
        </div>
      </div>
    </div>
  );
}
