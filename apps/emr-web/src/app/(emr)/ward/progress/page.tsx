import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Icon, Button, Field, Input, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { addProgress } from '../actions';
import { VitalsChart, type VitalPoint } from './vitals-chart';

function parseVitals(body: string, at: Date): VitalPoint {
  const num = (re: RegExp) => {
    const m = re.exec(body);
    return m ? Number(m[1]) : undefined;
  };
  const bp = /血圧\s*(\d+)\s*\/\s*(\d+)/.exec(body);
  return {
    at: at.toISOString(),
    temp: num(/体温\s*([\d.]+)/),
    pulse: num(/脈\s*(\d+)/),
    spo2: num(/SpO2\s*(\d+)/),
    sys: bp ? Number(bp[1]) : undefined,
    dia: bp ? Number(bp[2]) : undefined,
  };
}

export default async function ProgressPage({
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
        where: { patientId: patient.id, docType: '経過記録' },
        orderBy: { createdAt: 'desc' },
        take: 30,
      })
    : [];

  return (
    <PageBody>
      <PageHeader
        title="経過表・熱型表"
        desc="バイタル記録（体温・血圧・脈拍・SpO2）と経過。174項 120"
        crumbs={['Medixus カルテ', '病棟', '経過表']}
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
                    href={`/ward/progress?patientId=${e.patientId}`}
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
            <EmptyState title="入院患者を選択してください" icon={<Icon name="chart" size={32} />} />
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader
                title="熱型表（体温・脈拍・血圧・SpO2）"
                icon={<Icon name="chart" size={15} />}
                desc="経過記録から自動グラフ化"
              />
              {records.length === 0 ? (
                <EmptyState title="バイタル記録がありません（下のフォームから入力）" />
              ) : (
                <VitalsChart
                  points={records.map((r): VitalPoint => parseVitals(r.body ?? '', r.createdAt))}
                />
              )}
            </Panel>
            <Panel>
              <PanelHeader title="バイタル記録" icon={<Icon name="plus" size={15} />} />
              <form action={addProgress} className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <input type="hidden" name="patientId" value={patient.id} />
                <Field label="体温℃">
                  <Input name="temp" type="number" step="0.1" />
                </Field>
                <Field label="血圧">
                  <Input name="bp" placeholder="120/80" />
                </Field>
                <Field label="脈拍">
                  <Input name="pulse" type="number" />
                </Field>
                <Field label="SpO2%">
                  <Input name="spo2" type="number" />
                </Field>
                <div className="flex items-end">
                  <Button type="submit" variant="primary" className="w-full justify-center">
                    記録
                  </Button>
                </div>
                <Field label="記事" className="col-span-2 md:col-span-5">
                  <Input name="note" />
                </Field>
              </form>
            </Panel>
            <Panel>
              <PanelHeader title="経過記録" icon={<Icon name="chart" size={15} />} />
              {records.length === 0 ? (
                <EmptyState title="記録がありません" />
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {records.map((r) => (
                    <li key={r.id} className="py-2">
                      <div className="text-2xs text-muted">
                        {r.createdAt.toLocaleString('ja-JP')}
                      </div>
                      <div>{r.body}</div>
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
