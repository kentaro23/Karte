import { prisma } from '@medixus/db';
import { judgeLabFlag, LAB_FLAG_LABEL } from '@medixus/domain';
import { Badge, Panel, Icon, Button, EmptyState, Field, Input, Select } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  createExamOrderForm,
  importLabResults,
  approveLabResults,
  searchExamMaster,
  type ExamCandidate,
} from './actions';

// 検体検査オーダ・結果連携・承認（FR-EXM-01）。発行/連携は受診コンテキスト依存のため常に動的描画。
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'teal'> = {
  DRAFT: 'gray',
  REQUESTED: 'blue',
  RECEIVED: 'blue',
  IN_PROGRESS: 'amber',
  PARTIALLY_DONE: 'amber',
  DONE: 'green',
  RESULT_ARRIVED: 'teal',
  APPROVED: 'green',
  CANCELLED: 'red',
  VOIDED: 'red',
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: '入力中',
  REQUESTED: '依頼（外注送信済）',
  RECEIVED: '受付済',
  IN_PROGRESS: '実施中',
  PARTIALLY_DONE: '一部実施',
  DONE: '実施済',
  RESULT_ARRIVED: '結果到着',
  APPROVED: '承認済',
  CANCELLED: '中止',
  VOIDED: '取消',
};

/**
 * フロントのみモード（DB 未接続）でも検査項目を選べるよう、ExamMaster の代表サンプル。
 * JLAC10 は外注連携キー（IF-EXT-04）。基準値は H/L 判定（FR-LAB-01）に使う。
 * DB 接続時は searchExamMaster の実データで置き換わる。
 */
const SAMPLE_EXAMS: ExamCandidate[] = [
  { code: '3F015', name: 'AST(GOT)', jlac10: '3F01500000023270', category: '生化学', specimenType: '血清', refLow: 13, refHigh: 30, unit: 'U/L', points: 11 },
  { code: '3F020', name: 'ALT(GPT)', jlac10: '3F02000000023270', category: '生化学', specimenType: '血清', refLow: 10, refHigh: 42, unit: 'U/L', points: 11 },
  { code: '3J010', name: 'クレアチニン', jlac10: '3C02500000023270', category: '生化学', specimenType: '血清', refLow: 0.6, refHigh: 1.1, unit: 'mg/dL', points: 11 },
  { code: '3D045', name: '血糖(随時)', jlac10: '3D04500000023270', category: '生化学', specimenType: '血漿', refLow: 70, refHigh: 109, unit: 'mg/dL', points: 11 },
  { code: '3D046', name: 'HbA1c(NGSP)', jlac10: '3D04600000019283', category: '生化学', specimenType: '全血', refLow: 4.6, refHigh: 6.2, unit: '%', points: 49 },
  { code: '2A020', name: 'WBC(白血球数)', jlac10: '2A02000000019220', category: '血液学', specimenType: '全血', refLow: 3.3, refHigh: 8.6, unit: '10^3/uL', points: 21 },
  { code: '2A030', name: 'Hb(ヘモグロビン)', jlac10: '2A03000000019250', category: '血液学', specimenType: '全血', refLow: 13.7, refHigh: 16.8, unit: 'g/dL', points: 21 },
  { code: '5C070', name: 'CRP(定量)', jlac10: '5C07000000023270', category: '免疫', specimenType: '血清', refLow: 0, refHigh: 0.14, unit: 'mg/dL', points: 35 },
  { code: '5F010', name: 'TSH', jlac10: '5F01000000023270', category: '内分泌', specimenType: '血清', refLow: 0.5, refHigh: 5, unit: 'uIU/mL', points: 95 },
  { code: '4F010', name: 'PSA', jlac10: '4F01000000023270', category: '腫瘍マーカー', specimenType: '血清', refLow: 0, refHigh: 4, unit: 'ng/mL', points: 100 },
];

const LABS: { code: string; name: string }[] = [
  { code: 'SRL', name: 'SRL' },
  { code: 'BML', name: 'BML' },
  { code: 'LSI', name: 'LSIメディエンス' },
];

type ExamOrderRow = {
  id: string;
  orderNo: string;
  status: string;
  isUrgent: boolean;
  createdAt: Date;
  detail: unknown;
  patient: { patientNo: string; kanjiLastName: string; kanjiFirstName: string };
  labResults: {
    id: string;
    value: number | null;
    unit: string | null;
    refLow: number | null;
    refHigh: number | null;
    flag: string | null;
    examMaster: { name: string } | null;
  }[];
};

type PatientOpt = { id: string; label: string };

async function loadData(): Promise<{
  orders: ExamOrderRow[];
  patients: PatientOpt[];
  exams: ExamCandidate[];
}> {
  // fail-soft: DB 未接続でも画面を描画（空一覧 + サンプル検査項目）。
  let orders: ExamOrderRow[] = [];
  let patients: PatientOpt[] = [];
  let exams: ExamCandidate[] = [];
  try {
    const [rawOrders, rawPatients] = await Promise.all([
      prisma.order.findMany({
        where: { orderType: 'LAB' },
        orderBy: { createdAt: 'desc' },
        take: 60,
        include: {
          patient: { select: { patientNo: true, kanjiLastName: true, kanjiFirstName: true } },
          labResults: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              value: true,
              unit: true,
              refLow: true,
              refHigh: true,
              flag: true,
              examMaster: { select: { name: true } },
            },
          },
        },
      }),
      prisma.patient.findMany({
        orderBy: { createdAt: 'asc' },
        take: 60,
        select: { id: true, patientNo: true, kanjiLastName: true, kanjiFirstName: true },
      }),
    ]);
    orders = rawOrders as ExamOrderRow[];
    patients = rawPatients.map((p) => ({
      id: p.id,
      label: `${p.patientNo} ${p.kanjiLastName} ${p.kanjiFirstName}`,
    }));
    // ExamMaster 実検索（空ならサンプルへフォールバック）。
    exams = await searchExamMaster('');
  } catch (err) {
    console.error('[orders/exam] loadData failed (fail-soft):', err);
  }
  if (exams.length === 0) exams = SAMPLE_EXAMS;
  return { orders, patients, exams };
}

/** 結果セルの H/L/N トーン。 */
function flagTone(flag: string | null): 'gray' | 'amber' | 'red' {
  if (flag === 'H' || flag === 'HH') return 'red';
  if (flag === 'L' || flag === 'LL') return 'amber';
  return 'gray';
}

export default async function ExamOrderPage() {
  const { orders, patients, exams } = await loadData();
  const arrived = orders.filter((o) => o.status === 'RESULT_ARRIVED').length;
  const approved = orders.filter((o) => o.status === 'APPROVED').length;

  return (
    <PageBody>
      <PageHeader
        title="検体検査オーダ"
        desc="検体検査（ExamMaster/JLAC10）を外注検査会社へ送信（IF-EXT-04）。結果取込で「結果到着」、医師承認で「承認済」へ。174項 23-29 / FR-EXM-01"
        crumbs={['Medixus カルテ', 'オーダ', '検体検査']}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="teal">結果到着 {arrived}</Badge>
            <Badge tone="green">承認済 {approved}</Badge>
          </div>
        }
      />

      {patients.length === 0 && (
        <Panel className="mb-4">
          <p className="text-xs text-muted">
            バックエンド未接続のため患者・オーダ一覧は空です。画面操作は可能で、発行・外注送信・結果取込・承認はデモ表示になります（状態遷移
            REQUESTED→RESULT_ARRIVED→APPROVED）。
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <Panel pad={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-bold">検体検査オーダ一覧</span>
            <Badge tone="blue">{orders.length} 件</Badge>
          </div>
          {orders.length === 0 ? (
            <EmptyState
              title="検体検査オーダはありません"
              hint="右のフォームから検査項目を選んで発行すると、外注へ送信されます。"
              icon={<Icon name="lab" size={30} />}
            />
          ) : (
            <ul className="divide-y divide-line">
              {orders.map((o) => {
                const detail = (o.detail ?? {}) as {
                  items?: { examName?: string; points?: number }[];
                  specimen?: string;
                  laboratoryCode?: string;
                };
                const items = detail.items ?? [];
                return (
                  <li key={o.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted">{o.orderNo}</span>
                        <Badge tone={STATUS_TONE[o.status] ?? 'gray'}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </Badge>
                        {o.isUrgent && <Badge tone="red">緊急</Badge>}
                        {detail.laboratoryCode && (
                          <Badge tone="gray" title="外注先">
                            外注: {detail.laboratoryCode}
                          </Badge>
                        )}
                      </div>
                      <span className="text-2xs text-muted">
                        {o.createdAt.toLocaleString('ja-JP')}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">
                      <span className="font-mono text-2xs text-muted">{o.patient.patientNo}</span>{' '}
                      {o.patient.kanjiLastName} {o.patient.kanjiFirstName}
                      {detail.specimen && (
                        <span className="ml-2 text-2xs text-muted">検体: {detail.specimen}</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {items.length > 0
                        ? items.map((it) => it.examName).filter(Boolean).join('、')
                        : '（明細なし）'}
                    </div>

                    {/* 取込済みの結果（H/L フラグ付き）。 */}
                    {o.labResults.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {o.labResults.map((r) => {
                          const flag =
                            r.flag ?? judgeLabFlag(r.value, r.refLow, r.refHigh) ?? 'N';
                          return (
                            <Badge
                              key={r.id}
                              tone={flagTone(flag)}
                              title={`基準 ${r.refLow ?? '-'}〜${r.refHigh ?? '-'} ${r.unit ?? ''}`}
                            >
                              {r.examMaster?.name ?? '項目'}: {r.value ?? '-'}
                              {r.unit ?? ''}{' '}
                              {flag !== 'N' && `(${LAB_FLAG_LABEL[flag as 'H' | 'L' | 'N'] ?? flag})`}
                            </Badge>
                          );
                        })}
                      </div>
                    )}

                    {/* 状態遷移操作（正規遷移のみ）。 */}
                    <div className="mt-2 flex items-center gap-2">
                      {(o.status === 'REQUESTED' ||
                        o.status === 'RECEIVED' ||
                        o.status === 'IN_PROGRESS' ||
                        o.status === 'DONE') && (
                        <form action={importLabResults}>
                          <input type="hidden" name="orderId" value={o.id} />
                          <Button size="sm" variant="secondary" type="submit">
                            <Icon name="refresh" size={13} />
                            結果取込
                          </Button>
                        </form>
                      )}
                      {o.status === 'RESULT_ARRIVED' && (
                        <form action={approveLabResults}>
                          <input type="hidden" name="orderId" value={o.id} />
                          <Button size="sm" variant="primary" type="submit">
                            <Icon name="check" size={13} />
                            医師承認
                          </Button>
                        </form>
                      )}
                      {o.status === 'APPROVED' && (
                        <span className="inline-flex items-center gap-1 text-2xs font-semibold text-accent-700">
                          <Icon name="check" size={13} />
                          承認済（結果確定）
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* 新規オーダ発行フォーム（単一項目・サーバーアクション）。 */}
        <Panel>
          <div className="mb-3 border-b border-line pb-2.5">
            <h2 className="text-base font-bold text-ink">検体検査オーダ発行</h2>
            <p className="mt-0.5 text-xs text-muted">
              項目（JLAC10）と外注先を選んで発行 → lab-link で外注送信。
            </p>
          </div>
          <form action={createExamOrderForm} className="flex flex-col gap-3">
            <Field label="患者" required>
              <Select name="patientId" required defaultValue={patients[0]?.id ?? ''}>
                {patients.length === 0 && <option value="">（患者なし・デモ）</option>}
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="検査項目（JLAC10）" required hint="ExamMaster から選択（基準値で H/L 判定）">
              <Select name="__exam" defaultValue={exams[0]?.code ?? ''} disabled>
                {/* 表示用（実値は下の hidden 群を JS 無しで確定するため、先頭項目を既定採用）。 */}
                {exams.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.name}（{e.jlac10 ?? '—'}）/ {e.category}
                  </option>
                ))}
              </Select>
            </Field>

            {/* JS 無し（プログレッシブ）でも確実に発行できるよう、先頭候補を hidden で確定。
                行内マルチ選択の本格 UI は後段。ここでは最頻の単項目発行を担保。 */}
            <input type="hidden" name="examMasterId" value={exams[0]?.examMasterId ?? ''} />
            <input type="hidden" name="code" value={exams[0]?.code ?? ''} />
            <input type="hidden" name="name" value={exams[0]?.name ?? ''} />
            <input type="hidden" name="jlac10" value={exams[0]?.jlac10 ?? ''} />
            <input type="hidden" name="specimenType" value={exams[0]?.specimenType ?? ''} />
            <input type="hidden" name="points" value={exams[0]?.points ?? ''} />

            <Field label="検体" hint="例: 血清 / 全血 / 尿">
              <Input name="specimen" defaultValue={exams[0]?.specimenType ?? '血清'} />
            </Field>

            <Field label="外注先検査会社" hint="IF-EXT-04（約170社）">
              <Select name="laboratoryCode" defaultValue={LABS[0]?.code ?? ''}>
                {LABS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="urgent" className="h-4 w-4" />
              緊急（至急）
            </label>

            <Button type="submit" variant="primary" className="mt-1 justify-center">
              <Icon name="plus" size={14} />
              発行して外注送信
            </Button>
          </form>

          <p className="mt-3 border-t border-line pt-2 text-2xs leading-relaxed text-muted">
            発行で <code className="rounded bg-soft px-1">Order(LAB)</code> を作成し DRAFT→REQUESTED、
            <code className="rounded bg-soft px-1">lab-link.sendLabOrder</code>{' '}
            で外注へ送信します（現状スタブ status:STUB）。一覧の「結果取込」で
            <code className="rounded bg-soft px-1">LabResult</code> を生成し
            REQUESTED→…→RESULT_ARRIVED、「医師承認」で RESULT_ARRIVED→APPROVED へ遷移します（FR-EXM-01）。
          </p>
        </Panel>
      </div>
    </PageBody>
  );
}
