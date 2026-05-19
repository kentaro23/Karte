import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { createAppointment, cancelAppointment } from './actions';

export default async function ReservationsPage() {
  const [appts, patients, depts] = await Promise.all([
    prisma.appointment.findMany({
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: { patient: true },
    }),
    prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 60 }),
    prisma.department.findMany(),
  ]);
  const deptName = new Map(depts.map((d) => [d.id, d.name] as const));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <PageBody>
      <PageHeader
        title="予約管理"
        desc="外来予約の登録・一覧・取消、予約票（174項 3-4）"
        crumbs={['Medixus カルテ', '外来', '予約管理']}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Panel pad={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-bold">予約一覧</span>
            <Badge tone="gray">{appts.length} 件</Badge>
          </div>
          {appts.length === 0 ? (
            <EmptyState title="予約はありません" icon={<Icon name="calendar" size={30} />} />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="px-3 py-2 text-left">予約日時</th>
                  <th className="px-3 py-2 text-left">患者</th>
                  <th className="px-3 py-2 text-left">診療科</th>
                  <th className="px-3 py-2 text-left">種別</th>
                  <th className="px-3 py-2 text-left">状態</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {appts.map((a, i) => (
                  <tr key={a.id} className={i % 2 ? 'bg-soft/40' : ''}>
                    <td className="px-3 py-2">{a.scheduledAt.toLocaleString('ja-JP')}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-2xs text-muted">{a.patient.patientNo}</span>{' '}
                      {a.patient.kanjiLastName} {a.patient.kanjiFirstName}（{age(a.patient.dateOfBirth)}）
                    </td>
                    <td className="px-3 py-2">{deptName.get(a.departmentId) ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{a.kind === 'EXAM' ? '検査' : '診察'}</td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          a.status === 'CANCELLED' ? 'red' : a.status === 'ARRIVED' ? 'green' : 'blue'
                        }
                      >
                        {a.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {a.status !== 'CANCELLED' && (
                        <form action={cancelAppointment}>
                          <input type="hidden" name="id" value={a.id} />
                          <Button size="sm" variant="danger" type="submit">
                            取消
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
          <PanelHeader title="新規予約" icon={<Icon name="plus" size={15} />} />
          <form action={createAppointment} className="flex flex-col gap-3">
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
            <Field label="診療科" required>
              <Select name="departmentId" required defaultValue={depts[0]?.id ?? ''}>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="予約日" required>
                <Input name="date" type="date" required defaultValue={today} />
              </Field>
              <Field label="時刻">
                <Input name="time" type="time" defaultValue="09:00" />
              </Field>
            </div>
            <Field label="種別">
              <Select name="kind" defaultValue="CONSULT">
                <option value="CONSULT">診察</option>
                <option value="EXAM">検査</option>
              </Select>
            </Field>
            <Button type="submit" variant="primary">
              予約を登録
            </Button>
          </form>
        </Panel>
      </div>
    </PageBody>
  );
}
