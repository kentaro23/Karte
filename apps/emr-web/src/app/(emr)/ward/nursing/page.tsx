import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Icon, Button, Field, Input, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { addNursing } from '../actions';

export default async function NursingPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const sp = await searchParams;
  const inpatients = await prisma.encounter.findMany({
    where: { encounterType: 'INPATIENT', receptionStatus: { not: 'BILLING_DONE' } },
    include: { patient: true },
  });
  const patient = sp.patientId
    ? await prisma.patient.findUnique({ where: { id: sp.patientId } })
    : null;
  const records = patient
    ? await prisma.clinicalDocument.findMany({
        where: { patientId: patient.id, docType: '看護記録' },
        orderBy: { createdAt: 'desc' },
        take: 30,
      })
    : [];

  return (
    <PageBody>
      <PageHeader
        title="看護記録・看護計画"
        desc="看護記録（自由/フォーカス）、チーム医療連携、褥瘡管理。174項 121-125"
        crumbs={['Medixus カルテ', '病棟', '看護記録']}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        <Panel>
          <PanelHeader title="入院患者" icon={<Icon name="bed" size={15} />} />
          {inpatients.length === 0 ? (
            <p className="text-xs text-muted">在院患者なし</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {inpatients.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/ward/nursing?patientId=${e.patientId}`}
                    className={`block rounded px-2 py-1.5 text-xs hover:bg-soft ${patient?.id === e.patientId ? 'bg-accent-50 font-semibold text-accent-700' : ''}`}
                  >
                    {e.patient.kanjiLastName} {e.patient.kanjiFirstName}（
                    {age(e.patient.dateOfBirth)}）
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {!patient ? (
          <Panel>
            <EmptyState title="入院患者を選択してください" icon={<Icon name="teach" size={32} />} />
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader title="看護記録 入力（SOAP/フォーカス）" icon={<Icon name="plus" size={15} />} />
              <form action={addNursing} className="flex flex-col gap-3">
                <input type="hidden" name="patientId" value={patient.id} />
                <Field label="フォーカス">
                  <Input name="titleFocus" placeholder="例: 疼痛コントロール" />
                </Field>
                <Field label="記録（O-A-P / 経過）">
                  <textarea
                    name="body"
                    rows={5}
                    className="rounded border border-line px-2.5 py-1.5 text-sm"
                    placeholder="観察事項・実施・評価を記載"
                  />
                </Field>
                <Button type="submit" variant="primary">
                  看護記録を保存
                </Button>
              </form>
            </Panel>
            <Panel>
              <PanelHeader title="看護記録 履歴" icon={<Icon name="teach" size={15} />} />
              {records.length === 0 ? (
                <EmptyState title="記録がありません" />
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {records.map((r) => (
                    <li key={r.id} className="py-2">
                      <div className="text-2xs text-muted">
                        {r.createdAt.toLocaleString('ja-JP')}
                      </div>
                      <div className="whitespace-pre-wrap">{r.body}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </div>
    </PageBody>
  );
}
