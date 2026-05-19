import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { addDiagnosis, setOutcome } from './actions';

const OUTCOME_LABEL: Record<string, string> = {
  CURED: '治癒',
  IMPROVED: '軽快',
  UNCHANGED: '不変',
  TRANSFERRED: '転医',
  DECEASED: '死亡',
  STOPPED: '中止',
};

export default async function DiagnosesPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();

  const recent = await prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 12 });
  const master = q
    ? await prisma.diseaseMaster.findMany({
        where: { OR: [{ name: { contains: q } }, { code: { contains: q } }] },
        take: 30,
      })
    : await prisma.diseaseMaster.findMany({ take: 20, orderBy: { name: 'asc' } });

  const patient = sp.patientId
    ? await prisma.patient.findUnique({ where: { id: sp.patientId } })
    : null;
  const diagnoses = patient
    ? await prisma.patientDiagnosis.findMany({
        where: { patientId: patient.id },
        orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      })
    : [];

  return (
    <PageBody>
      <PageHeader
        title="病名・転帰"
        desc="標準病名/ICD10検索、主病名・疑い・急性慢性の登録、転帰管理（174項 19）"
        crumbs={['Medixus カルテ', '診療', '病名・転帰']}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <Panel>
          <PanelHeader title="患者選択" icon={<Icon name="patients" size={15} />} />
          <ul className="flex flex-col gap-0.5">
            {recent.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/diagnoses?patientId=${p.id}`}
                  className={`block rounded px-2 py-1.5 text-xs hover:bg-soft ${
                    patient?.id === p.id ? 'bg-accent-50 font-semibold text-accent-700' : ''
                  }`}
                >
                  <span className="font-mono text-2xs text-muted">{p.patientNo}</span>{' '}
                  {p.kanjiLastName} {p.kanjiFirstName}（{age(p.dateOfBirth)}）
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-4">
          {!patient ? (
            <Panel>
              <EmptyState
                title="患者を選択してください"
                hint="左の一覧から患者を選ぶと病名の登録・転帰管理ができます"
                icon={<Icon name="chart" size={32} />}
              />
            </Panel>
          ) : (
            <>
              <Panel>
                <PanelHeader
                  title={`${patient.kanjiLastName} ${patient.kanjiFirstName} の病名`}
                  desc={`ID ${patient.patientNo} ・ ${age(patient.dateOfBirth)}歳`}
                  icon={<Icon name="chart" size={15} />}
                />
                {diagnoses.length === 0 ? (
                  <EmptyState title="登録病名はありません" />
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-soft text-2xs uppercase text-muted">
                        <th className="px-2 py-1.5 text-left">病名</th>
                        <th className="px-2 py-1.5 text-left">ICD10</th>
                        <th className="px-2 py-1.5 text-left">区分</th>
                        <th className="px-2 py-1.5 text-left">開始</th>
                        <th className="px-2 py-1.5 text-left">転帰</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnoses.map((d) => (
                        <tr key={d.id} className="border-t border-line">
                          <td className="px-2 py-1.5">
                            {d.displayName}
                            {d.isMain && <Badge tone="green" className="ml-1">主病名</Badge>}
                            {d.isSuspected && <Badge tone="amber" className="ml-1">疑い</Badge>}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-xs">{d.icd10 ?? '—'}</td>
                          <td className="px-2 py-1.5 text-xs">{d.acuteChronic ?? '—'}</td>
                          <td className="px-2 py-1.5 text-xs">
                            {d.startDate.toLocaleDateString('ja-JP')}
                          </td>
                          <td className="px-2 py-1.5">
                            {d.outcome ? (
                              <Badge tone={d.status === 'RESOLVED' ? 'gray' : 'blue'}>
                                {OUTCOME_LABEL[d.outcome]}
                              </Badge>
                            ) : (
                              <form action={setOutcome} className="flex items-center gap-1">
                                <input type="hidden" name="id" value={d.id} />
                                <select
                                  name="outcome"
                                  className="rounded border border-line px-1 py-0.5 text-2xs"
                                >
                                  {Object.entries(OUTCOME_LABEL).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                                <Button size="sm" variant="ghost" type="submit">
                                  登録
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
                <PanelHeader title="病名登録（標準病名マスタ）" icon={<Icon name="plus" size={15} />} />
                <form method="get" className="mb-3 flex gap-2">
                  <input type="hidden" name="patientId" value={patient.id} />
                  <input
                    name="q"
                    defaultValue={q}
                    placeholder="病名 / ICD10 検索"
                    className="w-72 rounded border border-line px-2.5 py-1.5 text-sm"
                  />
                  <Button type="submit" variant="secondary">
                    検索
                  </Button>
                </form>
                <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                  {master.map((m) => (
                    <form
                      key={m.id}
                      action={addDiagnosis}
                      className="flex items-center justify-between rounded border border-line px-2.5 py-1.5 text-sm"
                    >
                      <input type="hidden" name="patientId" value={patient.id} />
                      <input type="hidden" name="masterCode" value={m.code} />
                      <input type="hidden" name="displayName" value={m.name} />
                      <input type="hidden" name="icd10" value={m.icd10[0] ?? ''} />
                      <span>
                        {m.name}{' '}
                        <span className="font-mono text-2xs text-muted">{m.icd10[0] ?? ''}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <label className="flex items-center gap-0.5 text-2xs text-muted">
                          <input type="checkbox" name="isMain" /> 主
                        </label>
                        <label className="flex items-center gap-0.5 text-2xs text-muted">
                          <input type="checkbox" name="isSuspected" /> 疑
                        </label>
                        <Button size="sm" variant="primary" type="submit">
                          追加
                        </Button>
                      </span>
                    </form>
                  ))}
                  {master.length === 0 && (
                    <p className="col-span-2 py-4 text-center text-xs text-muted">
                      該当する標準病名がありません
                    </p>
                  )}
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </PageBody>
  );
}
