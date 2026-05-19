import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { saveIntake } from './actions';

export default async function QuestionnairePage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const sp = await searchParams;
  const patients = await prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 14 });
  const patient = sp.patientId
    ? await prisma.patient.findUnique({
        where: { id: sp.patientId },
        include: { allergies: true, histories: true, profile: true },
      })
    : null;

  return (
    <PageBody>
      <PageHeader
        title="問診"
        desc="問診テンプレート入力。患者基本情報（既往歴・アレルギー・身長体重・生活）を正規化保存（別紙3 #88-115）"
        crumbs={['Medixus カルテ', '外来', '問診']}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <Panel>
          <PanelHeader title="患者選択" icon={<Icon name="patients" size={15} />} />
          <ul className="flex flex-col gap-0.5">
            {patients.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/questionnaire?patientId=${p.id}`}
                  className={`block rounded px-2 py-1.5 text-xs hover:bg-soft ${patient?.id === p.id ? 'bg-accent-50 font-semibold text-accent-700' : ''}`}
                >
                  <span className="font-mono text-2xs text-muted">{p.patientNo}</span>{' '}
                  {p.kanjiLastName} {p.kanjiFirstName}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        {!patient ? (
          <Panel>
            <EmptyState title="患者を選択してください" icon={<Icon name="template" size={32} />} />
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader
                title={`${patient.kanjiLastName} ${patient.kanjiFirstName} の登録情報`}
                desc={`ID ${patient.patientNo} ・ ${age(patient.dateOfBirth)}歳`}
                icon={<Icon name="chart" size={15} />}
              />
              <div className="flex flex-wrap gap-2 text-xs">
                {patient.allergies.length === 0 && patient.histories.length === 0 ? (
                  <Badge tone="green">登録情報なし</Badge>
                ) : (
                  <>
                    {patient.allergies.map((a) => (
                      <Badge key={a.id} tone="red">
                        {a.type === 'DRUG' ? '薬剤' : a.type === 'FOOD' ? '食物' : ''}: {a.substance}
                      </Badge>
                    ))}
                    {patient.histories.map((h) => (
                      <Badge key={h.id} tone="blue">
                        既往: {h.name}
                      </Badge>
                    ))}
                  </>
                )}
                {patient.profile?.heightCm && (
                  <Badge tone="gray">
                    {patient.profile.heightCm}cm / {patient.profile.weightKg ?? '—'}kg
                  </Badge>
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="問診票入力" icon={<Icon name="template" size={15} />} />
              <form action={saveIntake} className="flex flex-col gap-3">
                <input type="hidden" name="patientId" value={patient.id} />
                <Field label="主訴">
                  <Input name="chiefComplaint" placeholder="例: 3日前からの発熱と咳" />
                </Field>
                <Field label="既往歴（改行・読点区切り）">
                  <textarea
                    name="pastIllness"
                    rows={3}
                    className="rounded border border-line px-2.5 py-1.5 text-sm"
                    placeholder="高血圧、糖尿病、…"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="薬剤アレルギー（読点区切り）">
                    <Input name="drugAllergy" placeholder="ペニシリン、アスピリン" />
                  </Field>
                  <Field label="食物アレルギー（読点区切り）">
                    <Input name="foodAllergy" placeholder="卵、そば" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="身長(cm)">
                    <Input name="heightCm" type="number" step="0.1" />
                  </Field>
                  <Field label="体重(kg)">
                    <Input name="weightKg" type="number" step="0.1" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="喫煙">
                    <Input name="smoking" placeholder="20本/日 × 20年 等" />
                  </Field>
                  <Field label="飲酒">
                    <Input name="drinking" placeholder="ビール500ml/日 等" />
                  </Field>
                </div>
                <Button type="submit" variant="primary">
                  問診を保存（アレルギーは処方安全チェックに自動連携）
                </Button>
              </form>
            </Panel>
          </div>
        )}
      </div>
    </PageBody>
  );
}
