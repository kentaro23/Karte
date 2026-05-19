'use client';
import * as React from 'react';
import { RECEPTION_STATUS_LABEL, waitSeverity, type ReceptionStatus } from '@medixus/domain';
import { cn } from './cn.js';
import { DataTable, type Column } from './data-table.js';
import { Button, Badge } from './primitives.js';
import { Icon } from './icon.js';

export interface ReceptionRow {
  encounterId: string;
  receptionNo: number | null;
  patientNo: string;
  name: string;
  kana: string;
  gender: string;
  age: number;
  deptName: string;
  status: ReceptionStatus;
  arrivedAt: string | null;
  visitType: string | null;
}

const STATUS_TONE: Partial<Record<ReceptionStatus, 'gray' | 'blue' | 'amber' | 'green' | 'teal'>> = {
  UNRECEIVED: 'gray',
  ARRIVED: 'blue',
  QUESTIONNAIRE_IN_PROGRESS: 'blue',
  QUESTIONNAIRE_DONE: 'blue',
  READY: 'teal',
  IN_CONSULTATION: 'amber',
  SUSPENDED: 'amber',
  CONSULTATION_DONE: 'green',
  BILLING_DONE: 'green',
};

export function ReceptionTable({
  rows,
  onOpen,
  onRefresh,
}: {
  rows: ReceptionRow[];
  onOpen: (encounterId: string) => void;
  onRefresh?: () => void;
}) {
  const [auto, setAuto] = React.useState(false);
  React.useEffect(() => {
    if (!auto || !onRefresh) return;
    const t = setInterval(onRefresh, 15000);
    return () => clearInterval(t);
  }, [auto, onRefresh]);
  const now = Date.now();

  const cols: Column<ReceptionRow>[] = [
    { key: 'recNo', header: '受付No', width: 64, accessor: (r) => r.receptionNo ?? 9999, render: (r) => r.receptionNo ?? '—' },
    { key: 'visit', header: '初再', width: 48, render: (r) => r.visitType ?? '—' },
    { key: 'pno', header: '患者ID', width: 96, accessor: (r) => r.patientNo, render: (r) => <span className="font-mono text-xs">{r.patientNo}</span> },
    {
      key: 'name',
      header: '氏名',
      accessor: (r) => r.kana,
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-2xs text-muted">{r.kana}</div>
        </div>
      ),
    },
    { key: 'sex', header: '性別', width: 48, render: (r) => r.gender },
    { key: 'age', header: '年齢', width: 56, align: 'right', accessor: (r) => r.age, render: (r) => `${r.age}歳` },
    { key: 'dept', header: '診療科', width: 96, accessor: (r) => r.deptName, render: (r) => r.deptName },
    {
      key: 'status',
      header: '診察状況',
      width: 110,
      render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{RECEPTION_STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: 'wait',
      header: '経過',
      width: 72,
      align: 'right',
      accessor: (r) => (r.arrivedAt ? now - new Date(r.arrivedAt).getTime() : -1),
      render: (r) => {
        if (!r.arrivedAt) return <span className="text-muted">—</span>;
        const m = Math.floor((now - new Date(r.arrivedAt).getTime()) / 60000);
        const s = waitSeverity(m);
        return (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-bold',
              s === 'overdue'
                ? 'bg-red-50 text-alert'
                : s === 'attention'
                  ? 'bg-amber-50 text-warn'
                  : 'text-muted',
            )}
          >
            {m}分
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-ink">受付患者一覧</span>
        <Badge tone="gray">{rows.length}名</Badge>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          自動更新(15秒)
        </label>
        {onRefresh && (
          <Button size="sm" variant="secondary" onClick={onRefresh}>
            <Icon name="refresh" size={13} /> 更新
          </Button>
        )}
      </div>
      <DataTable
        columns={cols}
        rows={rows}
        getRowKey={(r) => r.encounterId}
        onRowClick={(r) => onOpen(r.encounterId)}
        emptyTitle="受付患者はいません"
        maxHeight="calc(100vh - 220px)"
      />
    </div>
  );
}
