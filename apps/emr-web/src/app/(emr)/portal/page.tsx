import Link from 'next/link';
import { prisma } from '@medixus/db';
import { RECEPTION_STATUS_LABEL, age, type ReceptionStatus } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, EmptyState } from '@medixus/ui';
import { requireSession } from '@/lib/session';
import { PageBody, PageHeader } from '@/components/page';

export default async function PortalPage() {
  const s = await requireSession();

  const [recentLogs, pendingRx, countersigns, encounters] = await Promise.all([
    prisma.patientSelectionLog.findMany({
      where: { userId: s.userId },
      orderBy: { selectedAt: 'desc' },
      take: 8,
    }),
    prisma.prescription.findMany({
      where: { status: 'rule_checked' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { items: { include: { drug: { select: { brandName: true } } } }, checks: true },
    }),
    prisma.countersign.findMany({
      where: { status: 'UNAPPROVED' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { note: { select: { patientId: true, recordedDate: true } } },
    }),
    prisma.encounter.findMany({ select: { receptionStatus: true, patientId: true } }),
  ]);

  const recent = await prisma.patient.findMany({
    where: { id: { in: [...new Set(recentLogs.map((l) => l.patientId))] } },
  });
  const recentMap = new Map(recent.map((p) => [p.id, p]));

  const statusCounts = encounters.reduce<Record<string, number>>((m, e) => {
    m[e.receptionStatus] = (m[e.receptionStatus] ?? 0) + 1;
    return m;
  }, {});

  const stat = (label: string, value: number, tone: 'green' | 'amber' | 'blue' | 'gray') => (
    <div className="rounded-card border border-line bg-white px-4 py-3 shadow-panel">
      <div className="text-2xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-ink">{value}</span>
        <Badge tone={tone}>件</Badge>
      </div>
    </div>
  );

  return (
    <PageBody>
      <PageHeader
        title={`${s.name} さんのポータル`}
        desc="本日の担当業務・未処理・最近のカルテ。新着情報と未承認文書をここで把握します。"
        crumbs={['Medixus カルテ', 'ポータル']}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat('受付待ち', statusCounts['ARRIVED'] ?? 0, 'blue')}
        {stat('診察中', statusCounts['IN_CONSULTATION'] ?? 0, 'amber')}
        {stat('未確定処方', pendingRx.length, 'amber')}
        {stat('未承認カウンターサイン', countersigns.length, 'amber')}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="未確定処方（安全チェック実行済・医師確認待ち）"
            icon={<Icon name="rx" size={16} />}
            desc="禁忌・相互作用・重複・極量・アレルギーの自動チェック結果を確認し確定します"
          />
          {pendingRx.length === 0 ? (
            <EmptyState title="未確定の処方はありません" />
          ) : (
            <ul className="divide-y divide-line">
              {pendingRx.map((rx) => {
                const blocked = rx.checks.filter((c) => c.result === 'BLOCKED').length;
                const warn = rx.checks.filter((c) => c.result === 'WARNING').length;
                return (
                  <li key={rx.id} className="flex items-center gap-3 py-2 text-sm">
                    <Link
                      href={`/chart/${rx.encounterId}`}
                      className="flex-1 truncate text-info hover:underline"
                    >
                      {rx.items.map((i) => i.drug.brandName).join(' / ')}
                    </Link>
                    {blocked > 0 && <Badge tone="red">ブロック {blocked}</Badge>}
                    {warn > 0 && <Badge tone="amber">警告 {warn}</Badge>}
                    {blocked === 0 && warn === 0 && <Badge tone="green">問題なし</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="最近開いた患者" icon={<Icon name="patients" size={16} />} />
          {recentLogs.length === 0 ? (
            <EmptyState title="履歴がありません" />
          ) : (
            <ul className="divide-y divide-line">
              {recentLogs.map((l) => {
                const p = recentMap.get(l.patientId);
                if (!p) return null;
                return (
                  <li key={l.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {p.kanjiLastName} {p.kanjiFirstName}
                      </span>
                      <span className="font-mono text-2xs text-muted">{p.patientNo}</span>
                    </div>
                    <div className="text-2xs text-muted">
                      {age(p.dateOfBirth)}歳 ・ {new Date(l.selectedAt).toLocaleString('ja-JP')}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="mt-4">
        <PanelHeader title="受付状況サマリ" icon={<Icon name="reception" size={16} />} />
        <div className="flex flex-wrap gap-2">
          {Object.entries(statusCounts).map(([k, v]) => (
            <div
              key={k}
              className="rounded border border-line bg-soft px-3 py-1.5 text-xs"
            >
              {RECEPTION_STATUS_LABEL[k as ReceptionStatus] ?? k}{' '}
              <span className="font-bold">{v}</span>
            </div>
          ))}
          {Object.keys(statusCounts).length === 0 && (
            <span className="text-xs text-muted">本日の受付はありません</span>
          )}
        </div>
      </Panel>
    </PageBody>
  );
}
