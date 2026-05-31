import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  createDischargeSummary,
  completeDischargeSummary,
  approveDischargeSummary,
  unapproveDischargeSummary,
} from './actions';

// 退院サマリは患者/入院コンテキスト・承認状態に依存するため常に動的描画。
export const dynamic = 'force-dynamic';

type SummaryStatus = 'DRAFT' | 'COMPLETED';
type ApprovalStatus = 'UNAPPROVED' | 'APPROVED';

type SummaryRow = {
  id: string;
  patientName: string | null;
  admissionRef: string | null;
  status: SummaryStatus;
  approvalStatus: ApprovalStatus;
  authorUserId: string;
  approverUserId: string | null;
  approvedAt: Date | null;
  admissionCourse: string | null;
  presentIllness: string | null;
  hospitalCourse: string | null;
  dischargePlan: string | null;
  createdAt: Date | null;
};
type PatientOpt = { id: string; patientNo: string; name: string };

const STATUS_LABEL: Record<SummaryStatus, string> = {
  DRAFT: '起草中',
  COMPLETED: '記載完了',
};
const STATUS_TONE: Record<SummaryStatus, 'gray' | 'blue'> = {
  DRAFT: 'gray',
  COMPLETED: 'blue',
};
const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  UNAPPROVED: '未承認',
  APPROVED: '承認済',
};
const APPROVAL_TONE: Record<ApprovalStatus, 'amber' | 'green'> = {
  UNAPPROVED: 'amber',
  APPROVED: 'green',
};

/* ── フロントのみモード用デモデータ ─────────────────────────────────────── */
function demoSummaries(): SummaryRow[] {
  return [
    {
      id: 'demo-ds-1',
      patientName: '佐藤 太郎',
      admissionRef: '入院 2026-05-10 〜 2026-05-24',
      status: 'COMPLETED',
      approvalStatus: 'UNAPPROVED',
      authorUserId: 'demo-resident-1',
      approverUserId: null,
      approvedAt: null,
      admissionCourse:
        '労作時呼吸困難を主訴に外来受診。胸部X線で心拡大・肺うっ血を認め、うっ血性心不全の診断で入院。',
      presentIllness:
        '高血圧・心房細動の既往。3日前より下腿浮腫と起坐呼吸が出現し増悪。',
      hospitalCourse:
        '利尿薬（フロセミド）静注で速やかに利尿が得られ、第5病日に体重 −4.2kg。第7病日に内服へ切替。心エコーで EF 42%。レートコントロール良好。',
      dischargePlan:
        '内服：フロセミド20mg、ビソプロロール2.5mg、アピキサバン10mg/日。塩分6g制限・毎日体重測定を指導。2週間後 循環器外来で再評価。',
      createdAt: new Date('2026-05-24T11:00:00'),
    },
    {
      id: 'demo-ds-2',
      patientName: '鈴木 一郎',
      admissionRef: '入院 2026-05-15 〜 2026-05-21',
      status: 'COMPLETED',
      approvalStatus: 'APPROVED',
      authorUserId: 'demo-resident-2',
      approverUserId: 'demo-staff-1',
      approvedAt: new Date('2026-05-21T16:30:00'),
      admissionCourse:
        '右下腹部痛・発熱で救急受診。CT で急性虫垂炎と診断し、緊急腹腔鏡下虫垂切除術を施行。',
      presentIllness: '前日夜より心窩部痛が出現し右下腹部へ移動。',
      hospitalCourse:
        '手術合併症なく経過良好。第2病日より食事再開、創部感染なし。WBC・CRP 正常化を確認。',
      dischargePlan:
        '抗菌薬は退院時で終了。創部は外来で抜糸（1週間後）。重労働は2週間控えるよう指導。',
      createdAt: new Date('2026-05-21T15:10:00'),
    },
    {
      id: 'demo-ds-3',
      patientName: '山田 花子',
      admissionRef: '入院 2026-05-28 〜（在院中）',
      status: 'DRAFT',
      approvalStatus: 'UNAPPROVED',
      authorUserId: 'demo-staff-1',
      approverUserId: null,
      approvedAt: null,
      admissionCourse: '肺炎の診断で入院。抗菌薬加療中。',
      presentIllness: '咳嗽・発熱・呼吸困難。',
      hospitalCourse: '（在院中・記載途中）',
      dischargePlan: null,
      createdAt: new Date('2026-05-30T09:00:00'),
    },
  ];
}
function demoPatients(): PatientOpt[] {
  return [
    { id: 'demo-pat-1', patientNo: '100001', name: '山田 花子' },
    { id: 'demo-pat-2', patientNo: '100002', name: '佐藤 太郎' },
    { id: 'demo-pat-3', patientNo: '100003', name: '鈴木 一郎' },
  ];
}

/**
 * フェイルソフトなデータ取得。DB 未接続・未マイグレーション・エンジン読込失敗でも
 * 画面が描画できるよう、例外時はデモのサンプルデータにフォールバックする。
 */
async function loadData(): Promise<{
  summaries: SummaryRow[];
  patients: PatientOpt[];
  live: boolean;
}> {
  try {
    const [summaries, patients] = await Promise.all([
      prisma.dischargeSummary.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 40 }),
    ]);

    const patMap = new Map(patients.map((p) => [p.id, p]));
    const summaryRows: SummaryRow[] = summaries.map((d) => {
      const p = patMap.get(d.patientId);
      return {
        id: d.id,
        patientName: p ? `${p.kanjiLastName} ${p.kanjiFirstName}` : null,
        admissionRef: d.admissionRef,
        status: d.status as SummaryStatus,
        approvalStatus: (d.approvalStatus as ApprovalStatus) ?? 'UNAPPROVED',
        authorUserId: d.authorUserId,
        approverUserId: d.approverUserId,
        approvedAt: d.approvedAt,
        admissionCourse: d.admissionCourse,
        presentIllness: d.presentIllness,
        hospitalCourse: d.hospitalCourse,
        dischargePlan: d.dischargePlan,
        createdAt: d.createdAt,
      };
    });
    const patientOpts: PatientOpt[] = patients.map((p) => ({
      id: p.id,
      patientNo: p.patientNo,
      name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
    }));

    if (summaryRows.length === 0 && patientOpts.length === 0) {
      return { summaries: demoSummaries(), patients: demoPatients(), live: false };
    }
    return {
      summaries: summaryRows,
      patients: patientOpts.length ? patientOpts : demoPatients(),
      live: true,
    };
  } catch (err) {
    console.error('[discharge-summary] loadData failed; showing demo data:', err);
    return { summaries: demoSummaries(), patients: demoPatients(), live: false };
  }
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  try {
    return d.toLocaleString('ja-JP');
  } catch {
    return '—';
  }
}

function SummarySection({ label, body }: { label: string; body: string | null }) {
  if (!body) return null;
  return (
    <div className="mt-1.5">
      <div className="text-2xs font-semibold text-muted">{label}</div>
      <p className="whitespace-pre-wrap text-2xs leading-relaxed text-ink/80">{body}</p>
    </div>
  );
}

export default async function DischargeSummaryPage() {
  const { summaries, patients, live } = await loadData();
  const pendingApproval = summaries.filter(
    (d) => d.status === 'COMPLETED' && d.approvalStatus === 'UNAPPROVED',
  ).length;

  return (
    <PageBody>
      <PageHeader
        title="退院時サマリー"
        desc="退院時サマリーの起草・記載完了・承認フロー（DRAFT→COMPLETED→承認）。FHIR(HS039) 出力源（174項 117）"
        crumbs={['Medixus カルテ', '診療', '退院時サマリー']}
        actions={
          <span className="flex items-center gap-2">
            {pendingApproval > 0 && (
              <Badge tone="amber" title="承認待ちの退院サマリ">
                承認待ち {pendingApproval}
              </Badge>
            )}
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Panel>
          <PanelHeader
            title="退院時サマリー一覧"
            icon={<Icon name="referral" size={15} />}
            actions={<Badge tone="gray">{summaries.length} 件</Badge>}
          />
          {summaries.length === 0 ? (
            <EmptyState
              title="退院時サマリーはありません"
              hint="右の「新規 退院時サマリー」から作成すると、記載完了・承認フローが行えます"
              icon={<Icon name="referral" size={28} />}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {summaries.map((d) => (
                <li key={d.id} className="rounded border border-line p-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {d.patientName ?? '（患者未指定）'}
                      <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                      <Badge tone={APPROVAL_TONE[d.approvalStatus]}>
                        {APPROVAL_LABEL[d.approvalStatus]}
                      </Badge>
                    </span>
                    <span className="text-2xs text-muted">作成 {fmt(d.createdAt)}</span>
                  </div>
                  {d.admissionRef && (
                    <div className="text-xs text-muted">{d.admissionRef}</div>
                  )}

                  <SummarySection label="入院時経過・入院理由" body={d.admissionCourse} />
                  <SummarySection label="現病歴" body={d.presentIllness} />
                  <SummarySection label="入院後経過" body={d.hospitalCourse} />
                  <SummarySection label="退院時方針・処方" body={d.dischargePlan} />

                  {d.approvalStatus === 'APPROVED' && (
                    <div className="mt-2 text-2xs text-emerald-800">
                      承認者：{d.approverUserId ?? '—'}　承認日時：{fmt(d.approvedAt)}
                    </div>
                  )}

                  {/* 操作行：記載完了・承認・差し戻し */}
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                    {d.status === 'DRAFT' && (
                      <form action={completeDischargeSummary}>
                        <input type="hidden" name="id" value={d.id} />
                        <Button size="sm" variant="ghost" type="submit">
                          記載完了にする
                        </Button>
                      </form>
                    )}
                    {d.approvalStatus === 'UNAPPROVED' ? (
                      <form action={approveDischargeSummary}>
                        <input type="hidden" name="id" value={d.id} />
                        <Button size="sm" variant="primary" type="submit">
                          承認する
                        </Button>
                      </form>
                    ) : (
                      <form action={unapproveDischargeSummary}>
                        <input type="hidden" name="id" value={d.id} />
                        <Button size="sm" variant="ghost" type="submit">
                          承認を取り消す
                        </Button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="新規 退院時サマリー" icon={<Icon name="plus" size={15} />} />
          <form action={createDischargeSummary} className="flex flex-col gap-3">
            <Field label="患者" required>
              <Select name="patientId" defaultValue="" required>
                <option value="" disabled>
                  患者を選択
                </option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="入院情報（任意）">
              <Input name="admissionRef" placeholder="入院 2026-05-10 〜 2026-05-24" />
            </Field>
            <Field label="入院時経過・入院理由">
              <textarea
                name="admissionCourse"
                rows={2}
                className="rounded border border-line px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Field label="現病歴">
              <textarea
                name="presentIllness"
                rows={2}
                className="rounded border border-line px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Field label="入院後経過">
              <textarea
                name="hospitalCourse"
                rows={3}
                className="rounded border border-line px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Field label="退院時方針・処方">
              <textarea
                name="dischargePlan"
                rows={2}
                className="rounded border border-line px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Button type="submit" variant="primary">
              退院時サマリーを作成（起草）
            </Button>
          </form>
        </Panel>
      </div>
    </PageBody>
  );
}
