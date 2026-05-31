import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { scheduleVisit, startVisit, cancelVisit, shareCareDocument, syncOfflineRecords } from './actions';
import { OfflineVisitClient, type PatientOpt } from './offline-client';

// 訪問予定・Encounter(HOMECARE) を Prisma から読むため動的化。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

type VisitRow = {
  appointmentId: string | null;
  patientLabel: string;
  patientNo: string;
  scheduledAt: Date;
  visitKind: string;
  status: string;
  receptionStatus: string | null;
};

// ── デモ（DB未接続）用の決定論サンプル ──────────────────────────────────────
const DEMO_PATIENTS: PatientOpt[] = [
  { id: 'demo-pat-1', label: '100001 佐藤 太郎（84）' },
  { id: 'demo-pat-2', label: '100002 鈴木 ハナ（79）' },
  { id: 'demo-pat-3', label: '100003 高橋 みどり（91）' },
];

/** 予約 comment 先頭の "[KIND] ..." から訪問種別を抽出（無ければ DOCTOR）。 */
function parseVisitKind(comment: string | null): string {
  if (!comment) return 'DOCTOR';
  const m = comment.match(/^\[([A-Z_]+)\]/);
  return m?.[1] ?? 'DOCTOR';
}

function visitKindLabel(v: string): string {
  switch (v) {
    case 'NURSE':
      return '訪問看護';
    case 'CARE_GUIDANCE':
      return '居宅療養管理指導';
    case 'REHAB':
      return '訪問リハビリ';
    default:
      return '医師訪問診療';
  }
}

function demoVisits(): VisitRow[] {
  const base = new Date();
  base.setHours(9, 0, 0, 0);
  const at = (h: number, m = 0) => {
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d;
  };
  return [
    {
      appointmentId: 'demo-apt-1',
      patientLabel: '佐藤 太郎（84）',
      patientNo: '100001',
      scheduledAt: at(9, 0),
      visitKind: 'DOCTOR',
      status: 'BOOKED',
      receptionStatus: 'UNRECEIVED',
    },
    {
      appointmentId: 'demo-apt-2',
      patientLabel: '鈴木 ハナ（79）',
      patientNo: '100002',
      scheduledAt: at(10, 30),
      visitKind: 'NURSE',
      status: 'ARRIVED',
      receptionStatus: 'ARRIVED',
    },
    {
      appointmentId: 'demo-apt-3',
      patientLabel: '高橋 みどり（91）',
      patientNo: '100003',
      scheduledAt: at(13, 30),
      visitKind: 'CARE_GUIDANCE',
      status: 'BOOKED',
      receptionStatus: 'UNRECEIVED',
    },
  ];
}

function fmtTime(d: Date): string {
  try {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}
function fmtDate(d: Date): string {
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()] ?? '';
  return `${d.getMonth() + 1}/${d.getDate()}（${wd}）`;
}

export default async function HomecarePage() {
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = new Date(`${today}T00:00:00`);
  const dayEnd = new Date(`${today}T23:59:59`);

  let dbDown = false;
  let patients: PatientOpt[] = DEMO_PATIENTS;
  let visits: VisitRow[] = [];

  // 患者（フォーム用）。
  try {
    const ps = await prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 80 });
    if (ps.length > 0) {
      patients = ps.map((p) => ({
        id: p.id,
        label: `${p.patientNo} ${p.kanjiLastName} ${p.kanjiFirstName}（${age(p.dateOfBirth)}）`,
      }));
    }
  } catch (err) {
    console.error('[HomecarePage] patient load failed, demo fallback:', err);
    dbDown = true;
  }

  // 当日の訪問予定（Appointment.kind = HOMECARE）。
  try {
    const rows = await prisma.appointment.findMany({
      where: { kind: 'HOMECARE', scheduledAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: { patient: true, encounter: true },
    });
    visits = rows.map((a) => ({
      appointmentId: a.id,
      patientLabel: `${a.patient.kanjiLastName} ${a.patient.kanjiFirstName}（${age(a.patient.dateOfBirth)}）`,
      patientNo: a.patient.patientNo,
      scheduledAt: a.scheduledAt,
      visitKind: parseVisitKind(a.comment),
      status: a.status,
      receptionStatus: a.encounter?.receptionStatus ?? null,
    }));
  } catch (err) {
    console.error('[HomecarePage] visit load failed, demo fallback:', err);
    dbDown = true;
  }

  // 実データが無ければデモ予定（DB接続済でも当日未投入なら操作体感のため提示）。
  const usingDemoVisits = visits.length === 0;
  if (usingDemoVisits) visits = demoVisits();

  const firstPatient = patients[0]?.id ?? '';
  const activeCount = visits.filter((v) => v.status !== 'CANCELLED').length;

  return (
    <PageBody>
      <PageHeader
        title="訪問診療"
        desc="訪問スケジュール／タブレットでのオフライン入力→復帰後同期／訪問看護指示書・居宅療養管理指導・多職種連携（FR-HOM-01 / 174項 134-158）"
        crumbs={['Medixus カルテ', '在宅・訪問', '訪問診療']}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone="teal">{fmtDate(new Date())} {activeCount} 件</Badge>
            {(dbDown || usingDemoVisits) && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />
      {dbDown && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB未接続）：予約の作成・訪問開始・同期は無効です。オフライン入力→キュー保持／スケジュールUIを提示します。
        </div>
      )}
      {!dbDown && usingDemoVisits && (
        <div className="mb-3 rounded border border-line bg-soft px-3 py-1.5 text-2xs text-muted">
          本日の訪問予定が未登録のためサンプル予定を表示しています。右の「訪問を予約」で当日訪問を登録できます。
        </div>
      )}

      {/* オフライン入力→同期（client島）：FR-HOM-01 AC1 */}
      <OfflineVisitClient patients={patients} syncAction={syncOfflineRecords} dbDown={dbDown} />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        {/* 左：本日の訪問スケジュール（AC2） */}
        <div className="flex flex-col gap-4">
          <Panel pad={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="flex items-center gap-1.5 text-sm font-bold">
                <Icon name="calendar" size={15} /> 本日の訪問スケジュール
              </span>
              <Badge tone="gray">{visits.length} 件</Badge>
            </div>
            {visits.length === 0 ? (
              <EmptyState
                title="本日の訪問予定はありません"
                hint="右の「訪問を予約」から登録できます"
                icon={<Icon name="calendar" size={30} />}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {visits.map((v) => {
                  const done = v.receptionStatus === 'CONSULTATION_DONE';
                  const arrived = v.status === 'ARRIVED' || v.receptionStatus === 'ARRIVED';
                  const cancelled = v.status === 'CANCELLED';
                  return (
                    <li
                      key={v.appointmentId ?? v.patientNo + v.scheduledAt.toISOString()}
                      className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                    >
                      <span className="w-14 shrink-0 font-mono text-sm font-semibold text-ink">
                        {fmtTime(v.scheduledAt)}
                      </span>
                      <span className="min-w-[10rem] flex-1">
                        <span className="font-mono text-2xs text-muted">{v.patientNo}</span>{' '}
                        <span className="text-sm font-medium text-ink">{v.patientLabel}</span>
                        <span className="ml-2 inline-block">
                          <Badge tone="blue">{visitKindLabel(v.visitKind)}</Badge>
                        </span>
                      </span>
                      <Badge
                        tone={cancelled ? 'red' : done ? 'green' : arrived ? 'teal' : 'amber'}
                      >
                        {cancelled ? '取消' : done ? '訪問完了' : arrived ? '訪問中' : '予定'}
                      </Badge>
                      <span className="flex items-center gap-1.5">
                        {!cancelled && !arrived && !done && (
                          <form action={startVisit}>
                            <input type="hidden" name="appointmentId" value={v.appointmentId ?? ''} />
                            <Button size="sm" variant="primary" type="submit" disabled={dbDown || usingDemoVisits}>
                              訪問開始
                            </Button>
                          </form>
                        )}
                        {!cancelled && (
                          <form action={cancelVisit}>
                            <input type="hidden" name="appointmentId" value={v.appointmentId ?? ''} />
                            <Button size="sm" variant="ghost" type="submit" disabled={dbDown || usingDemoVisits}>
                              取消
                            </Button>
                          </form>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* 多職種連携：訪問看護指示書／居宅療養管理指導の共有（interop シーム） */}
          <Panel>
            <PanelHeader
              title="多職種連携・在宅文書"
              desc="訪問看護指示書／居宅療養管理指導をケアマネ・薬局・訪問看護へ地域連携基盤経由で共有（IF-EXT-06 SS-MIX2/地域連携）"
              icon={<Icon name="referral" size={15} />}
            />
            <form action={shareCareDocument} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="患者" required>
                <Select name="patientId" required defaultValue={firstPatient}>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="文書種別">
                <Select name="docType" defaultValue="VISITING_NURSE_INSTRUCTION">
                  <option value="VISITING_NURSE_INSTRUCTION">訪問看護指示書</option>
                  <option value="HOME_CARE_GUIDANCE">居宅療養管理指導報告書</option>
                  <option value="CARE_PLAN">ケアプラン共有</option>
                </Select>
              </Field>
              <Button type="submit" variant="secondary" disabled={dbDown}>
                <Icon name="refresh" size={13} /> 連携先へ共有
              </Button>
            </form>
            <p className="mt-2 text-2xs text-muted/70">
              連携アダプタは現段階 STUB（status:&apos;STUB&apos;）です。共有操作は監査ログに記録され、本番接続は IOP スクワッドが実装します。
            </p>
          </Panel>
        </div>

        {/* 右：訪問を予約 */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="訪問を予約" icon={<Icon name="plus" size={15} />} />
            <form action={scheduleVisit} className="flex flex-col gap-3">
              <Field label="患者" required>
                <Select name="patientId" required defaultValue="">
                  <option value="" disabled>
                    選択
                  </option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="訪問種別">
                <Select name="visitKind" defaultValue="DOCTOR">
                  <option value="DOCTOR">医師訪問診療</option>
                  <option value="NURSE">訪問看護</option>
                  <option value="CARE_GUIDANCE">居宅療養管理指導</option>
                  <option value="REHAB">訪問リハビリ</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="訪問日" required>
                  <Input name="date" type="date" required defaultValue={today} />
                </Field>
                <Field label="時刻">
                  <Input name="time" type="time" defaultValue="09:00" />
                </Field>
              </div>
              <Field label="メモ">
                <Input name="comment" placeholder="任意（経路・留意点など）" />
              </Field>
              <Button type="submit" variant="primary" disabled={dbDown}>
                訪問を予約
              </Button>
              <p className="text-2xs text-muted/70">
                予約と同時に HOMECARE の Encounter を先行生成します。訪問先で「訪問開始」を押すと受付（ARRIVED）になります。
              </p>
            </form>
          </Panel>

          <Panel>
            <PanelHeader title="訪問ルート" desc="本日の訪問順" icon={<Icon name="pin" size={15} />} />
            {visits.filter((v) => v.status !== 'CANCELLED').length === 0 ? (
              <p className="text-xs text-muted">本日の訪問はありません。</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {visits
                  .filter((v) => v.status !== 'CANCELLED')
                  .map((v, i) => (
                    <li
                      key={(v.appointmentId ?? v.patientNo) + '-route'}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-50 font-mono text-2xs font-bold text-accent-700">
                        {i + 1}
                      </span>
                      <span className="font-mono text-2xs text-muted">{fmtTime(v.scheduledAt)}</span>
                      <span className="truncate text-ink">{v.patientLabel}</span>
                    </li>
                  ))}
              </ol>
            )}
            <p className="mt-2 text-2xs text-muted/70">
              訪問予定を時刻順に並べた当日ルートです。各訪問先での記録は上のオフライン入力から行えます。
            </p>
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
