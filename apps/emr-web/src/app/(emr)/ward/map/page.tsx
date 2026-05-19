import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

export default async function WardMapPage() {
  const wards = await prisma.ward.findMany({
    include: { rooms: { include: { beds: true } } },
  });
  const inpatients = await prisma.encounter.findMany({
    where: { encounterType: 'INPATIENT', receptionStatus: { notIn: ['BILLING_DONE', 'CANCELLED'] } },
    include: { patient: true },
    orderBy: { createdAt: 'asc' },
  });

  return (
    <PageBody>
      <PageHeader
        title="病床マップ"
        desc="病棟・病室・病床の在床/空床状況（174項 110-112）"
        crumbs={['Medixus カルテ', '病棟', '病床マップ']}
        actions={
          <span className="flex gap-2">
            <Badge tone="amber">在床 {inpatients.length}</Badge>
          </span>
        }
      />
      {wards.map((w) => {
        const wardPatients = inpatients.filter((e) => e.wardId === w.id);
        let cursor = 0;
        const allBeds = w.rooms.flatMap((r) => r.beds.map((b) => ({ room: r, bed: b })));
        return (
          <Panel key={w.id} className="mb-4">
            <PanelHeader
              title={w.name}
              icon={<Icon name="bed" size={15} />}
              actions={
                <span className="text-2xs text-muted">
                  {allBeds.length} 床中 {wardPatients.length} 在床
                </span>
              }
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {allBeds.map(({ room, bed }) => {
                const occ = cursor < wardPatients.length ? wardPatients[cursor++] : null;
                const female = occ?.patient.gender === 'FEMALE';
                return (
                  <div
                    key={bed.id}
                    className={`rounded-card border p-3 text-xs ${
                      occ
                        ? female
                          ? 'border-pink-300 bg-pink-50'
                          : 'border-blue-200 bg-blue-50'
                        : 'border-dashed border-line bg-soft'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-2xs text-muted">
                        {room.code}-{bed.code.split('-').pop()}
                      </span>
                      {occ ? (
                        <Badge tone={female ? 'red' : 'blue'}>在床</Badge>
                      ) : (
                        <Badge tone="gray">空床</Badge>
                      )}
                    </div>
                    {occ ? (
                      <div>
                        <div className="font-semibold text-ink">
                          {occ.patient.kanjiLastName} {occ.patient.kanjiFirstName}
                        </div>
                        <div className="text-2xs text-muted">
                          {occ.patient.gender === 'FEMALE' ? '女' : '男'} ・{' '}
                          {age(occ.patient.dateOfBirth)}歳
                        </div>
                      </div>
                    ) : (
                      <div className="text-2xs text-muted">—</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      })}
      <p className="text-2xs text-muted">
        ※ ドラッグ移動シミュレーション・転棟転室・新生児母子同室は BedAssignment モデル実装（Phase 5）で拡張。
      </p>
    </PageBody>
  );
}
