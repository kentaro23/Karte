import { prisma } from '@medixus/db';
import { age, RECEPTION_STATUS_LABEL, type ReceptionStatus } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

export default async function SchedulePage() {
  const [appts, encs, depts] = await Promise.all([
    prisma.appointment.findMany({
      where: { status: { not: 'CANCELLED' } },
      orderBy: { scheduledAt: 'asc' },
      include: { patient: true },
      take: 200,
    }),
    prisma.encounter.findMany({
      where: { receptionStatus: { notIn: ['BILLING_DONE', 'CANCELLED', 'NO_SHOW'] } },
      include: { patient: true },
    }),
    prisma.department.findMany(),
  ]);

  return (
    <PageBody>
      <PageHeader
        title="外来基本スケジュール・患者誘導"
        desc="当日の診察スケジュールと現在の受付状況。診療科別に把握し誘導します"
        crumbs={['Medixus カルテ', '外来', 'スケジュール']}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {depts.map((d) => {
          const dAppt = appts.filter((a) => a.departmentId === d.id);
          const dEnc = encs.filter((e) => e.departmentId === d.id);
          return (
            <Panel key={d.id}>
              <PanelHeader
                title={d.name}
                icon={<Icon name="clock" size={15} />}
                actions={
                  <span className="flex gap-1">
                    <Badge tone="blue">予約 {dAppt.length}</Badge>
                    <Badge tone="amber">受付中 {dEnc.length}</Badge>
                  </span>
                }
              />
              <div className="mb-2 text-2xs font-bold uppercase text-muted">現在 受付中</div>
              {dEnc.length === 0 ? (
                <p className="mb-3 text-xs text-muted">受付中の患者なし</p>
              ) : (
                <ul className="mb-3 divide-y divide-line text-sm">
                  {dEnc.map((e) => (
                    <li key={e.id} className="flex items-center justify-between py-1.5">
                      <span>
                        {e.patient.kanjiLastName} {e.patient.kanjiFirstName}（{age(e.patient.dateOfBirth)}）
                      </span>
                      <Badge tone="amber">
                        {RECEPTION_STATUS_LABEL[e.receptionStatus as ReceptionStatus]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mb-2 text-2xs font-bold uppercase text-muted">予約</div>
              {dAppt.length === 0 ? (
                <p className="text-xs text-muted">予約なし</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {dAppt.slice(0, 8).map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-1.5">
                      <span className="tabular-nums text-muted">
                        {a.scheduledAt.toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="flex-1 px-3">
                        {a.patient.kanjiLastName} {a.patient.kanjiFirstName}
                      </span>
                      <Badge tone="blue">{a.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}
        {depts.length === 0 && (
          <Panel>
            <EmptyState title="診療科が未登録です" />
          </Panel>
        )}
      </div>
    </PageBody>
  );
}
