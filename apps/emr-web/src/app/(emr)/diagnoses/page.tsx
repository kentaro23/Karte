import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Icon, EmptyState, Badge } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  DiagnosesSearchClient,
  type MasterRow,
  type DiagnosisRow,
  type DeptRow,
} from './search-client';

// 病名登録・転帰・エクスポートは受診/患者コンテキストに依存するため常に動的描画。
export const dynamic = 'force-dynamic';

type PatientLite = {
  id: string;
  patientNo: string;
  kanjiLastName: string;
  kanjiFirstName: string;
  dateOfBirth: Date;
};

/** DB未接続でも画面が出るよう、取得はすべて try/catch で fail-soft・null安全。 */
async function loadData(patientId: string | undefined, q: string) {
  const out: {
    recent: PatientLite[];
    master: MasterRow[];
    patient: PatientLite | null;
    diagnoses: DiagnosisRow[];
    departments: DeptRow[];
    demo: boolean;
  } = { recent: [], master: [], patient: null, diagnoses: [], departments: [], demo: false };

  try {
    const [recent, master, departments] = await Promise.all([
      prisma.patient.findMany({
        orderBy: { createdAt: 'asc' },
        take: 12,
        select: {
          id: true,
          patientNo: true,
          kanjiLastName: true,
          kanjiFirstName: true,
          dateOfBirth: true,
        },
      }),
      q
        ? prisma.diseaseMaster.findMany({
            where: { OR: [{ name: { contains: q } }, { code: { contains: q } }] },
            take: 60,
            select: { id: true, code: true, name: true, icd10: true },
          })
        : prisma.diseaseMaster.findMany({
            take: 60,
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true, icd10: true },
          }),
      prisma.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    out.recent = recent;
    out.master = master;
    out.departments = departments;

    if (patientId) {
      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        select: {
          id: true,
          patientNo: true,
          kanjiLastName: true,
          kanjiFirstName: true,
          dateOfBirth: true,
        },
      });
      out.patient = patient;
      if (patient) {
        const diagnoses = await prisma.patientDiagnosis.findMany({
          where: { patientId: patient.id },
          orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
        });
        out.diagnoses = diagnoses.map((d) => ({
          id: d.id,
          displayName: d.displayName,
          masterCode: d.masterCode,
          icd10: d.icd10,
          isMain: d.isMain,
          isSuspected: d.isSuspected,
          acuteChronic: d.acuteChronic,
          departmentId: d.departmentId,
          startDate: d.startDate.toISOString(),
          outcome: d.outcome,
          outcomeDate: d.outcomeDate ? d.outcomeDate.toISOString() : null,
          forBilling: d.forBilling,
          status: d.status,
        }));
      }
    }
  } catch (err) {
    console.error('[diagnoses] loadData failed (fail-soft):', err);
    out.demo = true;
  }
  return out;
}

export default async function DiagnosesPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const { recent, master, patient, diagnoses, departments, demo } = await loadData(sp.patientId, q);

  return (
    <PageBody>
      <PageHeader
        title="病名・転帰"
        desc="標準病名（MEDIS＋ICD-10）をキーワード検索し、確定/主病/疑い の三連ボタンでワンクリック登録。修飾語プリ合成・主併・開始日・転帰・一括転帰・当月有効・エクスポート（174項 19 / FR-DX-01）"
        crumbs={['Medixus カルテ', '診療', '病名・転帰']}
        actions={<Badge tone="blue">{master.length} 病名</Badge>}
      />

      {demo && (
        <Panel className="mb-4">
          <p className="text-xs text-muted">
            バックエンド未接続のため病名マスタ・患者は空です。画面操作は可能で、登録・転帰・エクスポートはデモ表示になります。
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <Panel>
          <PanelHeader title="患者選択" icon={<Icon name="patients" size={15} />} />
          {recent.length === 0 ? (
            <p className="px-1 py-3 text-2xs text-muted">患者がいません（バックエンド未接続）</p>
          ) : (
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
          )}
        </Panel>

        {!patient ? (
          <Panel>
            <EmptyState
              title="患者を選択してください"
              hint="左の一覧から患者を選ぶと病名の登録・転帰管理ができます"
              icon={<Icon name="chart" size={32} />}
            />
          </Panel>
        ) : (
          <DiagnosesSearchClient
            patientId={patient.id}
            patientLabel={`${patient.kanjiLastName} ${patient.kanjiFirstName}（ID ${patient.patientNo}・${age(
              patient.dateOfBirth,
            )}歳）`}
            master={master}
            diagnoses={diagnoses}
            departments={departments}
            initialQuery={q}
            demo={demo}
          />
        )}
      </div>
    </PageBody>
  );
}
