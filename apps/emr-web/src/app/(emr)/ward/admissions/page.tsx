import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { admitPatient, dischargePatient } from '../actions';

export default async function AdmissionsPage() {
  const [inpatients, patients, wards] = await Promise.all([
    prisma.encounter.findMany({
      where: { encounterType: 'INPATIENT' },
      orderBy: { createdAt: 'desc' },
      include: { patient: true },
      take: 60,
    }),
    prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 60 }),
    prisma.ward.findMany(),
  ]);
  const active = inpatients.filter((e) => e.receptionStatus !== 'BILLING_DONE');

  return (
    <PageBody>
      <PageHeader
        title="入退院管理"
        desc="入院受付・在院患者・退院確定（174項 103-119）"
        crumbs={['Medixus カルテ', '病棟', '入退院']}
        actions={<Badge tone="amber">在院 {active.length}</Badge>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Panel pad={false}>
          <div className="border-b border-line px-4 py-2.5 text-sm font-bold">入院患者一覧</div>
          {inpatients.length === 0 ? (
            <EmptyState title="入院患者はいません" icon={<Icon name="ward" size={30} />} />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="px-3 py-2 text-left">患者</th>
                  <th className="px-3 py-2 text-left">入院日</th>
                  <th className="px-3 py-2 text-left">病棟</th>
                  <th className="px-3 py-2 text-left">状態</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {inpatients.map((e, i) => (
                  <tr key={e.id} className={i % 2 ? 'bg-soft/40' : ''}>
                    <td className="px-3 py-2">
                      <span className="font-mono text-2xs text-muted">{e.patient.patientNo}</span>{' '}
                      {e.patient.kanjiLastName} {e.patient.kanjiFirstName}（
                      {age(e.patient.dateOfBirth)}）
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {e.arrivedAt?.toLocaleDateString('ja-JP') ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">{e.wardId ? '3階病棟' : '—'}</td>
                    <td className="px-3 py-2">
                      {e.receptionStatus === 'BILLING_DONE' ? (
                        <Badge tone="gray">退院済</Badge>
                      ) : (
                        <Badge tone="green">在院</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {e.receptionStatus !== 'BILLING_DONE' && (
                        <form action={dischargePatient}>
                          <input type="hidden" name="id" value={e.id} />
                          <Button size="sm" variant="secondary" type="submit">
                            退院確定
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="入院受付" icon={<Icon name="plus" size={15} />} />
          <form action={admitPatient} className="flex flex-col gap-3">
            <Field label="患者" required>
              <Select name="patientId" required defaultValue="">
                <option value="" disabled>
                  選択
                </option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.kanjiLastName} {p.kanjiFirstName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="病棟" required>
              <Select name="wardId" required defaultValue={wards[0]?.id ?? ''}>
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="primary">
              入院受付
            </Button>
            <p className="text-2xs text-muted">
              ※ 入院診療計画書・クリティカルパス・持参薬は Phase 5（Admission モデル）で拡張。
            </p>
          </form>
        </Panel>
      </div>
    </PageBody>
  );
}
