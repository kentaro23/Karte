import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { createReferral, advanceReferral } from './actions';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '作成中',
  PRINTED: '印刷済',
  SENT: '送付済',
  AWAITING_REPLY: '返書待ち',
  REPLY_RECEIVED: '返書受領',
  CLOSED: '完了',
};
const STATUS_TONE: Record<string, 'gray' | 'blue' | 'amber' | 'green'> = {
  DRAFT: 'gray',
  PRINTED: 'blue',
  SENT: 'blue',
  AWAITING_REPLY: 'amber',
  REPLY_RECEIVED: 'green',
  CLOSED: 'green',
};

export default async function ReferralsPage() {
  const [referrals, patients] = await Promise.all([
    prisma.referral.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { patient: true },
    }),
    prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 40 }),
  ]);
  return (
    <PageBody>
      <PageHeader
        title="紹介状"
        desc="紹介状の作成、送付/返書ステータス管理、印刷（174項 20-22）"
        crumbs={['Medixus カルテ', '診療', '紹介状']}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Panel>
          <PanelHeader
            title="紹介状一覧"
            icon={<Icon name="referral" size={15} />}
            actions={<Badge tone="gray">{referrals.length} 件</Badge>}
          />
          {referrals.length === 0 ? (
            <EmptyState title="紹介状はありません" />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="px-2 py-1.5 text-left">患者</th>
                  <th className="px-2 py-1.5 text-left">紹介先</th>
                  <th className="px-2 py-1.5 text-left">目的</th>
                  <th className="px-2 py-1.5 text-left">状態</th>
                  <th className="px-2 py-1.5 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-2 py-1.5">
                      {r.patient
                        ? `${r.patient.kanjiLastName} ${r.patient.kanjiFirstName}`
                        : '（仮）'}
                    </td>
                    <td className="px-2 py-1.5">{r.partnerFacility}</td>
                    <td className="px-2 py-1.5 text-xs text-muted">{r.purpose}</td>
                    <td className="px-2 py-1.5">
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.status !== 'CLOSED' && (
                        <form action={advanceReferral}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button size="sm" variant="ghost" type="submit">
                            次の状態へ →
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
          <PanelHeader title="新規 紹介状" icon={<Icon name="plus" size={15} />} />
          <form action={createReferral} className="flex flex-col gap-3">
            <Field label="患者">
              <Select name="patientId" defaultValue="">
                <option value="">（仮・患者未指定）</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.kanjiLastName} {p.kanjiFirstName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="紹介先医療機関" required>
              <Input name="partnerFacility" required placeholder="○○病院 循環器内科" />
            </Field>
            <Field label="紹介先医師">
              <Input name="partnerDoctor" placeholder="担当医名" />
            </Field>
            <Field label="紹介目的" required>
              <Input name="purpose" required placeholder="精査加療依頼" />
            </Field>
            <Field label="主訴">
              <Input name="chiefComplaint" />
            </Field>
            <Field label="現病歴・経過">
              <textarea
                name="diseaseState"
                rows={3}
                className="rounded border border-line px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Button type="submit" variant="primary">
              紹介状を作成
            </Button>
          </form>
        </Panel>
      </div>
    </PageBody>
  );
}
