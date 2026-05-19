import * as React from 'react';
import { Panel, Badge } from '@medixus/ui';

export function PageHeader({
  title,
  desc,
  crumbs,
  actions,
}: {
  title: React.ReactNode;
  desc?: React.ReactNode;
  crumbs?: string[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-3">
      <div>
        {crumbs && (
          <div className="mb-1 text-2xs text-muted">{crumbs.join(' / ')}</div>
        )}
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {desc && <p className="mt-1 text-xs text-muted">{desc}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="p-5">{children}</div>;
}

/** Consistent scaffold for modules whose deep build lands in a later FE phase. */
export function ModuleScaffold({
  title,
  desc,
  crumbs,
  spec,
  phase,
  children,
}: {
  title: string;
  desc: string;
  crumbs?: string[];
  spec: string;
  phase: string;
  children?: React.ReactNode;
}) {
  return (
    <PageBody>
      <PageHeader title={title} desc={desc} crumbs={crumbs} actions={<Badge tone="blue">{phase}</Badge>} />
      {children}
      <Panel className="mt-4">
        <div className="flex items-start gap-3">
          <div className="text-xs leading-relaxed text-muted">
            <p className="mb-1 font-semibold text-ink">仕様準拠</p>
            <p>{spec}</p>
            <p className="mt-2">
              本モジュールは Medixus カルテ の標準フレーム（認証・権限・監査・版管理・状態機械）の上に構築されます。
              データモデル・状態遷移・連携シームは本番基準で実装済み、画面の作り込みは {phase} で完成します。
            </p>
          </div>
        </div>
      </Panel>
    </PageBody>
  );
}
