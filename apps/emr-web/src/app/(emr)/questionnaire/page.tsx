import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  saveIntake,
  importWebIntakeForm,
  loadWebIntakes,
  verifyAllergySafetyLink,
  type WebIntakeSubmission,
  type AllergyLinkResult,
} from './actions';

// 受付/カルテ同様、Prisma を読むため明示的に動的化。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

type PatientRow = { id: string; patientNo: string; kanjiLastName: string; kanjiFirstName: string };
type AllergyRow = { id: string; type: string; substance: string; ingredientCode: string | null };
type HistoryRow = { id: string; name: string };
type ProfileRow = { heightCm: number | null; weightKg: number | null } | null;
type SelectedPatient = {
  id: string;
  patientNo: string;
  kanjiLastName: string;
  kanjiFirstName: string;
  dateOfBirth: Date;
  allergies: AllergyRow[];
  histories: HistoryRow[];
  profile: ProfileRow;
};

// ── DB 未接続（フロントのみ）用の決定論デモ ──────────────────────────────────
const DEMO_PATIENTS: PatientRow[] = [
  { id: 'demo-pat-1', patientNo: '100001', kanjiLastName: '佐藤', kanjiFirstName: '太郎' },
  { id: 'demo-pat-2', patientNo: '100002', kanjiLastName: '鈴木', kanjiFirstName: '花子' },
  { id: 'demo-pat-4', patientNo: '100004', kanjiLastName: '田中', kanjiFirstName: '美咲' },
];

const DEMO_PATIENT_FALLBACK: PatientRow = DEMO_PATIENTS[0] ?? {
  id: 'demo-pat-1',
  patientNo: '100001',
  kanjiLastName: '佐藤',
  kanjiFirstName: '太郎',
};

function demoSelected(id: string): SelectedPatient {
  const base = DEMO_PATIENTS.find((p) => p.id === id) ?? DEMO_PATIENT_FALLBACK;
  return {
    ...base,
    dateOfBirth: new Date(1968, 4, 12),
    allergies:
      base.id === 'demo-pat-2'
        ? [{ id: 'demo-al-1', type: 'DRUG', substance: 'アモキシシリン水和物', ingredientCode: '6131001' }]
        : [],
    histories: base.id === 'demo-pat-2' ? [{ id: 'demo-hx-1', name: '高血圧症' }] : [],
    profile: base.id === 'demo-pat-2' ? { heightCm: 158, weightKg: 52 } : null,
  };
}

async function loadPatients(): Promise<PatientRow[]> {
  try {
    const rows = await prisma.patient.findMany({
      orderBy: { createdAt: 'asc' },
      take: 14,
      select: { id: true, patientNo: true, kanjiLastName: true, kanjiFirstName: true },
    });
    return rows.length > 0 ? rows : DEMO_PATIENTS;
  } catch (err) {
    console.error('[questionnaire] loadPatients failed (fail-soft):', err);
    return DEMO_PATIENTS;
  }
}

async function loadSelected(patientId: string): Promise<SelectedPatient | null> {
  try {
    const p = await prisma.patient.findUnique({
      where: { id: patientId },
      include: { allergies: true, histories: true, profile: true },
    });
    if (!p) return demoSelected(patientId);
    return {
      id: p.id,
      patientNo: p.patientNo,
      kanjiLastName: p.kanjiLastName,
      kanjiFirstName: p.kanjiFirstName,
      dateOfBirth: p.dateOfBirth,
      // 取込済みアレルギー/既往は null 安全に正規化（DB/デモ双方で動く）。
      allergies: (p.allergies ?? []).map((a) => ({
        id: a.id,
        type: a.type,
        substance: a.substance,
        ingredientCode: a.ingredientCode ?? null,
      })),
      histories: (p.histories ?? []).map((h) => ({ id: h.id, name: h.name })),
      profile: p.profile ? { heightCm: p.profile.heightCm ?? null, weightKg: p.profile.weightKg ?? null } : null,
    };
  } catch (err) {
    console.error('[questionnaire] loadSelected failed (fail-soft):', err);
    return demoSelected(patientId);
  }
}

const CHANNEL_LABEL: Record<WebIntakeSubmission['channel'], string> = {
  PATIENT_APP: '患者アプリ',
  WEB_FORM: 'Webフォーム',
  ONSHI: 'オン資6情報',
};

export default async function QuestionnairePage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const sp = await searchParams;
  const patients = await loadPatients();
  const patientId = sp.patientId ?? null;
  const [patient, webIntakes, link]: [
    SelectedPatient | null,
    WebIntakeSubmission[],
    AllergyLinkResult | null,
  ] = patientId
    ? await Promise.all([
        loadSelected(patientId),
        loadWebIntakes(patientId),
        verifyAllergySafetyLink(patientId),
      ])
    : [null, await loadWebIntakes(), null];

  return (
    <PageBody>
      <PageHeader
        title="問診"
        desc="窓口問診入力＋Web問診（患者アプリ）取込。既往歴・アレルギー・身長体重・生活を正規化保存し、薬剤アレルギーは成分コードで処方安全チェックへ連動（FR-QNR-01）"
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
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader
                title="Web問診（患者アプリ）取込待ち"
                desc="患者アプリ/Webフォーム/オン資6情報から提出された未取込の問診。患者を選択して取込みます。"
                icon={<Icon name="portal" size={15} />}
              />
              {webIntakes.length === 0 ? (
                <EmptyState title="未取込のWeb問診はありません" />
              ) : (
                <ul className="divide-y divide-line">
                  {webIntakes.map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">
                          {q.patientName}{' '}
                          <span className="font-mono text-2xs text-muted">{q.patientNo}</span>
                        </span>
                        <div className="text-2xs text-muted">{q.chiefComplaint}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone="blue">{CHANNEL_LABEL[q.channel]}</Badge>
                        <Link
                          href={`/questionnaire?patientId=${q.patientId}`}
                          className="text-info hover:underline"
                        >
                          開く
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel>
              <EmptyState title="患者を選択してください" icon={<Icon name="template" size={32} />} />
            </Panel>
          </div>
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
                      <Badge
                        key={a.id}
                        tone="red"
                        title={a.ingredientCode ? `成分コード ${a.ingredientCode}（処方安全連動）` : '成分コード未解決（表示のみ）'}
                      >
                        {a.type === 'DRUG' ? '薬剤' : a.type === 'FOOD' ? '食物' : ''}: {a.substance}
                        {a.type === 'DRUG' && a.ingredientCode ? ' 🔗' : ''}
                      </Badge>
                    ))}
                    {patient.histories.map((h) => (
                      <Badge key={h.id} tone="blue">
                        既往: {h.name}
                      </Badge>
                    ))}
                  </>
                )}
                {patient.profile?.heightCm != null && (
                  <Badge tone="gray">
                    {patient.profile.heightCm}cm / {patient.profile.weightKg ?? '—'}kg
                  </Badge>
                )}
              </div>
              {link && (
                <div className="mt-3 flex items-center gap-2 rounded border border-line bg-soft px-3 py-2 text-2xs text-muted">
                  <Icon name="check" size={14} />
                  <span>
                    処方安全連動: 成分コード連動の薬剤アレルギー{' '}
                    <span className="font-semibold text-ink">{link.linkedDrugAllergies}</span> 件
                    {link.allergyFindings > 0 && (
                      <>
                        {' '}・ 最新処方のアレルギー所見{' '}
                        <span className="font-semibold text-alert">{link.allergyFindings}</span> 件
                      </>
                    )}
                  </span>
                </div>
              )}
            </Panel>

            {webIntakes.length > 0 && (
              <Panel>
                <PanelHeader
                  title="Web問診（患者アプリ）取込"
                  desc="患者が事前提出した問診を確認し、患者情報・既往・アレルギー・身長体重へ取込みます（薬剤アレルギーは成分コード解決で処方安全へ連動）"
                  icon={<Icon name="portal" size={15} />}
                />
                <ul className="flex flex-col gap-3">
                  {webIntakes.map((q) => (
                    <li key={q.id} className="rounded border border-line p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          {q.chiefComplaint || '（主訴未記入）'}
                        </div>
                        <Badge tone="blue">{CHANNEL_LABEL[q.channel]}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-2xs">
                        {q.pastIllness.map((h) => (
                          <Badge key={h} tone="gray">
                            既往: {h}
                          </Badge>
                        ))}
                        {q.drugAllergy.map((a) => (
                          <Badge key={a} tone="red">
                            薬剤: {a}
                          </Badge>
                        ))}
                        {q.foodAllergy.map((a) => (
                          <Badge key={a} tone="amber">
                            食物: {a}
                          </Badge>
                        ))}
                        {(q.heightCm != null || q.weightKg != null) && (
                          <Badge tone="gray">
                            {q.heightCm ?? '—'}cm / {q.weightKg ?? '—'}kg
                          </Badge>
                        )}
                      </div>
                      <form action={importWebIntakeForm} className="mt-2">
                        <input type="hidden" name="submissionId" value={q.id} />
                        <input type="hidden" name="patientId" value={patient.id} />
                        <Button type="submit" variant="primary" size="sm">
                          この問診を患者情報へ取込む（アレルギーは処方安全へ連動）
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel>
              <PanelHeader title="問診票入力（窓口）" icon={<Icon name="template" size={15} />} />
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
                  問診を保存（薬剤アレルギーは成分コード解決で処方安全チェックに自動連携）
                </Button>
              </form>
            </Panel>
          </div>
        )}
      </div>
    </PageBody>
  );
}
