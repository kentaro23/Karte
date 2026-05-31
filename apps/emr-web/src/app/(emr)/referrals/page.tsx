import { prisma } from '@medixus/db';
import {
  type ReferralStatus,
  REFERRAL_STATUS_LABEL,
  canTransitionReferral,
} from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { createReferral, setReferralStatus, registerReply } from './actions';

// 紹介状は受診/患者コンテキストに依存し、状態遷移後の再描画も要るため常に動的描画。
export const dynamic = 'force-dynamic';

const ALL_STATUSES: ReferralStatus[] = [
  'DRAFT',
  'PRINTED',
  'SENT',
  'AWAITING_REPLY',
  'REPLY_RECEIVED',
  'CLOSED',
];

const STATUS_TONE: Record<ReferralStatus, 'gray' | 'blue' | 'amber' | 'green'> = {
  DRAFT: 'gray',
  PRINTED: 'blue',
  SENT: 'blue',
  AWAITING_REPLY: 'amber',
  REPLY_RECEIVED: 'green',
  CLOSED: 'green',
};

type ReferralRow = {
  id: string;
  patientName: string | null;
  partnerFacility: string;
  partnerDoctor: string | null;
  purpose: string;
  status: ReferralStatus;
  replyText: string | null;
  createdAt: Date | null;
};
type PatientOpt = { id: string; patientNo: string; name: string };

/* ── フロントのみモード用デモデータ ─────────────────────────────────────── */
function demoReferrals(): ReferralRow[] {
  return [
    {
      id: 'demo-ref-1',
      patientName: '山田 花子',
      partnerFacility: '済生会中央病院 循環器内科',
      partnerDoctor: '循内 部長',
      purpose: '心房細動 精査加療依頼',
      status: 'AWAITING_REPLY',
      replyText: null,
      createdAt: new Date('2026-05-22T10:15:00'),
    },
    {
      id: 'demo-ref-2',
      patientName: '佐藤 太郎',
      partnerFacility: '東京医大病院 消化器内科',
      partnerDoctor: null,
      purpose: '上部内視鏡 精査依頼',
      status: 'REPLY_RECEIVED',
      replyText:
        '貴院よりご紹介の患者様、上部内視鏡施行いたしました。胃前庭部に慢性胃炎を認めますが悪性所見なし。PPI 8週投与にて経過観察を依頼いたします。',
      createdAt: new Date('2026-05-18T09:40:00'),
    },
    {
      id: 'demo-ref-3',
      patientName: '鈴木 一郎',
      partnerFacility: '丸の内整形外科クリニック',
      partnerDoctor: '整形 院長',
      purpose: '右膝変形性関節症 加療依頼',
      status: 'DRAFT',
      replyText: null,
      createdAt: new Date('2026-05-30T14:05:00'),
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
  referrals: ReferralRow[];
  patients: PatientOpt[];
  live: boolean;
}> {
  try {
    const [referrals, patients] = await Promise.all([
      prisma.referral.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { patient: true },
      }),
      prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 40 }),
    ]);

    const referralRows: ReferralRow[] = referrals.map((r) => ({
      id: r.id,
      patientName: r.patient
        ? `${r.patient.kanjiLastName} ${r.patient.kanjiFirstName}`
        : null,
      partnerFacility: r.partnerFacility,
      partnerDoctor: r.partnerDoctor,
      purpose: r.purpose,
      status: r.status as ReferralStatus,
      replyText: r.replyText,
      createdAt: r.createdAt,
    }));
    const patientOpts: PatientOpt[] = patients.map((p) => ({
      id: p.id,
      patientNo: p.patientNo,
      name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
    }));

    if (referralRows.length === 0 && patientOpts.length === 0) {
      return { referrals: demoReferrals(), patients: demoPatients(), live: false };
    }
    return {
      referrals: referralRows,
      patients: patientOpts.length ? patientOpts : demoPatients(),
      live: true,
    };
  } catch (err) {
    console.error('[referrals] loadData failed; showing demo data:', err);
    return { referrals: demoReferrals(), patients: demoPatients(), live: false };
  }
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  try {
    return d.toLocaleDateString('ja-JP');
  } catch {
    return '—';
  }
}

/** 現状態から状態機械が許す「次に選べる状態」（クローズを除いた近道含む）。 */
function nextChoices(from: ReferralStatus): ReferralStatus[] {
  return ALL_STATUSES.filter((to) => to !== 'CLOSED' && canTransitionReferral(from, to));
}

export default async function ReferralsPage() {
  const { referrals, patients, live } = await loadData();
  const awaiting = referrals.filter((r) => r.status === 'AWAITING_REPLY').length;

  return (
    <PageBody>
      <PageHeader
        title="紹介状"
        desc="紹介状の作成、状態遷移（下書き→印刷→送付→返書待ち→返書受領→クローズ）・返書登録・印刷（174項 20-22）"
        crumbs={['Medixus カルテ', '診療', '紹介状']}
        actions={
          <span className="flex items-center gap-2">
            {awaiting > 0 && (
              <Badge tone="amber" title="返書待ちの紹介状">
                返書待ち {awaiting}
              </Badge>
            )}
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Panel>
          <PanelHeader
            title="紹介状一覧"
            icon={<Icon name="referral" size={15} />}
            actions={<Badge tone="gray">{referrals.length} 件</Badge>}
          />
          {referrals.length === 0 ? (
            <EmptyState
              title="紹介状はありません"
              hint="右の「新規 紹介状」から作成すると、状態遷移・返書登録・印刷が行えます"
              icon={<Icon name="referral" size={28} />}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {referrals.map((r) => {
                const choices = nextChoices(r.status);
                const canClose = canTransitionReferral(r.status, 'CLOSED');
                const showReplyForm =
                  r.status === 'SENT' ||
                  r.status === 'AWAITING_REPLY' ||
                  r.status === 'PRINTED';
                return (
                  <li key={r.id} className="rounded border border-line p-3">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {r.patientName ?? '（患者未指定）'}
                        <Badge tone={STATUS_TONE[r.status]}>
                          {REFERRAL_STATUS_LABEL[r.status]}
                        </Badge>
                      </span>
                      <span className="text-2xs text-muted">作成 {fmt(r.createdAt)}</span>
                    </div>
                    <div className="text-xs text-ink">
                      <span className="font-medium">{r.partnerFacility}</span>
                      {r.partnerDoctor && (
                        <span className="text-muted">　{r.partnerDoctor} 先生</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">目的：{r.purpose}</div>

                    {r.replyText && (
                      <div className="mt-2 rounded border border-emerald-300 bg-emerald-50/50 px-2.5 py-2">
                        <div className="mb-0.5 text-2xs font-semibold text-emerald-800">
                          返書
                        </div>
                        <p className="whitespace-pre-wrap text-2xs leading-relaxed text-ink/80">
                          {r.replyText}
                        </p>
                      </div>
                    )}

                    {/* 操作行：印刷・状態遷移・クローズ */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a
                        href={`/print/referral/${r.id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-xs text-info underline"
                      >
                        <Icon name="print" size={13} /> 印刷
                      </a>
                      {choices.map((to) => (
                        <form key={to} action={setReferralStatus}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="to" value={to} />
                          <Button size="sm" variant="ghost" type="submit">
                            {REFERRAL_STATUS_LABEL[to]}へ →
                          </Button>
                        </form>
                      ))}
                      {canClose && (
                        <form action={setReferralStatus}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="to" value="CLOSED" />
                          <Button size="sm" variant="ghost" type="submit">
                            クローズ
                          </Button>
                        </form>
                      )}
                    </div>

                    {/* 返書登録（送付前後で受領可） */}
                    {showReplyForm && (
                      <form
                        action={registerReply}
                        className="mt-2 flex flex-col gap-1.5 rounded border border-line bg-soft p-2"
                      >
                        <input type="hidden" name="id" value={r.id} />
                        <label className="text-2xs text-muted">返書本文を登録</label>
                        <textarea
                          name="replyText"
                          rows={2}
                          placeholder="返書（診療情報提供書への回答）を貼り付け / 入力"
                          className="rounded border border-line px-2 py-1 text-xs text-ink"
                        />
                        <div className="flex justify-end">
                          <Button size="sm" variant="primary" type="submit">
                            返書を登録（返書受領へ）
                          </Button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
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
                    {p.patientNo} {p.name}
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
