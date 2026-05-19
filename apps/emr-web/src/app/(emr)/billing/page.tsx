import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

export default async function BillingPage() {
  const rxs = await prisma.prescription.findMany({
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: {
      items: { include: { drug: { select: { brandName: true, nhiPrice: true } } } },
    },
  });
  const pts = await prisma.patient.findMany({
    where: { id: { in: [...new Set(rxs.map((r) => r.patientId))] } },
    select: { id: true, patientNo: true, kanjiLastName: true, kanjiFirstName: true },
  });
  const pMap = new Map(pts.map((p) => [p.id, p]));
  const rows = rxs.map((rx) => {
    const amount = rx.items.reduce(
      (s, it) => s + (it.drug.nhiPrice ?? 0) * it.dosePerTime * it.timesPerDay * it.days,
      0,
    );
    return { rx, patient: pMap.get(rx.patientId), amount: Math.round(amount) };
  });
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <PageBody>
      <PageHeader
        title="会計・レセプト"
        desc="処方薬剤費の自費換算（薬価×数量）。保険算定・レセプト電算実連携は Phase 7"
        crumbs={['Medixus カルテ', '管理', '会計']}
        actions={<Badge tone="blue">薬剤費合計 ¥{total.toLocaleString()}</Badge>}
      />
      <Panel className="mb-4" pad={false}>
        <div className="px-4 py-2.5 text-xs text-muted">
          ※ 概算（薬価ベース）。診療報酬点数算定・包括評価(DPC)・レセプト点検・レセコン連携は
          interop シーム（Phase 7: ORCA / レセプト電算）で実装。
        </div>
      </Panel>
      <Panel pad={false}>
        {rows.length === 0 ? (
          <EmptyState title="会計対象がありません" icon={<Icon name="billing" size={30} />} />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-soft text-2xs uppercase text-muted">
                <th className="px-3 py-2 text-left">日時</th>
                <th className="px-3 py-2 text-left">患者</th>
                <th className="px-3 py-2 text-left">処方内容</th>
                <th className="px-3 py-2 text-left">状態</th>
                <th className="px-3 py-2 text-right">薬剤費(概算)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rx, patient, amount }, i) => (
                <tr key={rx.id} className={i % 2 ? 'bg-soft/40' : ''}>
                  <td className="px-3 py-2 text-2xs text-muted">
                    {rx.createdAt.toLocaleString('ja-JP')}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-2xs text-muted">
                      {patient?.patientNo ?? '—'}
                    </span>{' '}
                    {patient ? `${patient.kanjiLastName} ${patient.kanjiFirstName}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {rx.items.map((it) => it.drug.brandName).join(' / ')}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={rx.status === 'doctor_confirmed' ? 'green' : 'amber'}>
                      {rx.status === 'doctor_confirmed' ? '確定' : '未確定'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    ¥{amount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </PageBody>
  );
}
