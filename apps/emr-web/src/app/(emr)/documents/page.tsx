import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  createDocument,
  createDischargeSummary,
  completeDischargeSummary,
  approveDischargeSummary,
} from './actions';

export default async function DocumentsPage() {
  const [docs, summaries, patients] = await Promise.all([
    prisma.clinicalDocument.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.dischargeSummary.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 40 }),
  ]);
  const patMap = new Map(patients.map((p) => [p.id, p]));
  return (
    <PageBody>
      <PageHeader
        title="文書管理"
        desc="院内文書・同意書・説明書・退院サマリ・紙文書スキャン保管（174項 117,166-168）"
        crumbs={['Medixus カルテ', '診療', '文書管理']}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader
              title="院内文書"
              icon={<Icon name="sticky" size={15} />}
              actions={<Badge tone="gray">{docs.length} 件</Badge>}
            />
            {docs.length === 0 ? (
              <EmptyState title="文書はありません" />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft text-2xs uppercase text-muted">
                    <th className="px-2 py-1.5 text-left">種別</th>
                    <th className="px-2 py-1.5 text-left">タイトル</th>
                    <th className="px-2 py-1.5 text-left">形式</th>
                    <th className="px-2 py-1.5 text-left">作成</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className="border-t border-line">
                      <td className="px-2 py-1.5">
                        <Badge tone="blue">{d.docType}</Badge>
                      </td>
                      <td className="px-2 py-1.5">{d.title}</td>
                      <td className="px-2 py-1.5 text-xs">{d.format}</td>
                      <td className="px-2 py-1.5 text-2xs text-muted">
                        {d.createdAt.toLocaleString('ja-JP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="退院サマリ" icon={<Icon name="chart" size={15} />} />
            {summaries.length === 0 ? (
              <EmptyState title="退院サマリはありません（右で作成）" />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {summaries.map((sm) => {
                  const p = sm.patientId ? patMap.get(sm.patientId) : undefined;
                  return (
                    <li key={sm.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {p ? `${p.kanjiLastName} ${p.kanjiFirstName}` : `#${sm.id.slice(0, 8)}`}
                        </span>
                        <span className="flex gap-2">
                          <Badge tone={sm.status === 'COMPLETED' ? 'green' : 'amber'}>
                            {sm.status === 'COMPLETED' ? '作成済' : '作成中'}
                          </Badge>
                          <Badge tone={sm.approvalStatus === 'APPROVED' ? 'green' : 'gray'}>
                            {sm.approvalStatus === 'APPROVED' ? '承認済' : '未承認'}
                          </Badge>
                        </span>
                      </div>
                      {sm.hospitalCourse && (
                        <p className="mt-0.5 line-clamp-2 text-2xs text-muted">
                          経過: {sm.hospitalCourse}
                        </p>
                      )}
                      <div className="mt-1 flex gap-2">
                        {sm.status !== 'COMPLETED' && (
                          <form action={completeDischargeSummary}>
                            <input type="hidden" name="id" value={sm.id} />
                            <Button size="sm" variant="ghost" type="submit">
                              作成完了
                            </Button>
                          </form>
                        )}
                        {sm.status === 'COMPLETED' && sm.approvalStatus !== 'APPROVED' && (
                          <form action={approveDischargeSummary}>
                            <input type="hidden" name="id" value={sm.id} />
                            <Button size="sm" variant="secondary" type="submit">
                              承認
                            </Button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="退院サマリ作成" icon={<Icon name="plus" size={15} />} />
            <form action={createDischargeSummary} className="flex flex-col gap-2">
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
              {(
                [
                  ['admissionCourse', '入院までの経過'],
                  ['presentIllness', '現症・主病名'],
                  ['hospitalCourse', '入院後経過・治療'],
                  ['dischargePlan', '退院時方針・処方・申し送り'],
                ] as const
              ).map(([name, label]) => (
                <Field key={name} label={label}>
                  <textarea
                    name={name}
                    rows={2}
                    className="rounded border border-line px-2.5 py-1.5 text-sm"
                  />
                </Field>
              ))}
              <Button type="submit" variant="primary">
                退院サマリを作成（作成中）
              </Button>
            </form>
          </Panel>
        </div>

        <Panel>
          <PanelHeader title="新規 院内文書" icon={<Icon name="plus" size={15} />} />
          <form action={createDocument} className="flex flex-col gap-3">
            <Field label="文書種別">
              <Select name="docType" defaultValue="院内文書">
                <option>院内文書</option>
                <option>同意書</option>
                <option>説明書</option>
                <option>診断書</option>
                <option>スキャン文書</option>
              </Select>
            </Field>
            <Field label="患者（任意）">
              <Select name="patientId" defaultValue="">
                <option value="">（患者未指定）</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.kanjiLastName} {p.kanjiFirstName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="タイトル" required>
              <Input name="title" required />
            </Field>
            <Field label="本文">
              <textarea
                name="body"
                rows={5}
                className="rounded border border-line px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Button type="submit" variant="primary">
              文書を保存
            </Button>
          </form>
        </Panel>
      </div>
    </PageBody>
  );
}
