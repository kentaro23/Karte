import Link from 'next/link';
import { prisma } from '@medixus/db';
import { RECEPTION_STATUS_LABEL, age, type ReceptionStatus } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, EmptyState, type IconName } from '@medixus/ui';
import { requireSession } from '@/lib/session';
import { PageBody, PageHeader } from '@/components/page';
import { loadWebIntakes } from '../questionnaire/actions';

// Prisma を読むため明示的に動的化。DB 未接続でもデモが描画される（fail-soft）。
export const dynamic = 'force-dynamic';

type RecentLog = { id: string; patientId: string; selectedAt: Date };
type PendingRx = {
  id: string;
  encounterId: string;
  itemNames: string[];
  blocked: number;
  warn: number;
};
type RecentPatient = {
  id: string;
  patientNo: string;
  kanjiLastName: string;
  kanjiFirstName: string;
  dateOfBirth: Date;
};

type PortalData = {
  recentLogs: RecentLog[];
  recentMap: Map<string, RecentPatient>;
  pendingRx: PendingRx[];
  countersignCount: number;
  statusCounts: Record<string, number>;
};

// ── DB 未接続（フロントのみ）用の決定論デモ ──────────────────────────────────
function demoPortalData(): PortalData {
  return {
    recentLogs: [],
    recentMap: new Map(),
    pendingRx: [],
    countersignCount: 0,
    statusCounts: { ARRIVED: 3, IN_CONSULTATION: 1, CONSULTATION_DONE: 2 },
  };
}

/** ポータルの集計データを取得（fail-soft：DB 未接続/未マイグレーションでもデモ描画）。 */
async function loadPortalData(userId: string): Promise<PortalData> {
  try {
    const [recentLogs, pendingRx, countersigns, encounters] = await Promise.all([
      prisma.patientSelectionLog.findMany({
        where: { userId },
        orderBy: { selectedAt: 'desc' },
        take: 8,
      }),
      prisma.prescription.findMany({
        where: { status: 'rule_checked' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { items: { include: { drug: { select: { brandName: true } } } }, checks: true },
      }),
      prisma.countersign.findMany({
        where: { status: 'UNAPPROVED' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true },
      }),
      prisma.encounter.findMany({ select: { receptionStatus: true, patientId: true } }),
    ]);

    const recent = await prisma.patient.findMany({
      where: { id: { in: [...new Set(recentLogs.map((l) => l.patientId))] } },
      select: {
        id: true,
        patientNo: true,
        kanjiLastName: true,
        kanjiFirstName: true,
        dateOfBirth: true,
      },
    });

    const statusCounts = encounters.reduce<Record<string, number>>((m, e) => {
      m[e.receptionStatus] = (m[e.receptionStatus] ?? 0) + 1;
      return m;
    }, {});

    return {
      recentLogs: recentLogs.map((l) => ({
        id: l.id,
        patientId: l.patientId,
        selectedAt: l.selectedAt,
      })),
      recentMap: new Map(recent.map((p) => [p.id, p])),
      pendingRx: pendingRx.map((rx) => ({
        id: rx.id,
        encounterId: rx.encounterId,
        itemNames: rx.items.map((i) => i.drug.brandName),
        blocked: rx.checks.filter((c) => c.result === 'BLOCKED').length,
        warn: rx.checks.filter((c) => c.result === 'WARNING').length,
      })),
      countersignCount: countersigns.length,
      statusCounts,
    };
  } catch (err) {
    console.error('[portal] loadPortalData failed (fail-soft, demo mode?):', err);
    return demoPortalData();
  }
}

export default async function PortalPage() {
  const s = await requireSession();
  const data = await loadPortalData(s.userId);
  // 患者アプリ（PHR）連携：未取込のWeb問診件数を取得（fail-soft）。
  const webIntakes = await loadWebIntakes();
  const { recentLogs, recentMap, pendingRx, countersignCount, statusCounts } = data;

  const stat = (label: string, value: number, tone: 'green' | 'amber' | 'blue' | 'gray') => (
    <div className="rounded-card border border-line bg-white px-4 py-3 shadow-panel">
      <div className="text-2xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-ink">{value}</span>
        <Badge tone={tone}>件</Badge>
      </div>
    </div>
  );

  // 患者アプリ連携で提供する機能（予約/Web問診/キャッシュレス会計/サマリ閲覧）。
  const phrLinks: { label: string; desc: string; href: string; icon: IconName; badge?: string }[] = [
    {
      label: 'Web問診取込',
      desc: '患者アプリ/Webフォーム提出の問診を患者情報・アレルギーへ取込',
      href: '/questionnaire',
      icon: 'template',
      badge: webIntakes.length > 0 ? `未取込 ${webIntakes.length}` : undefined,
    },
    { label: 'オンライン予約', desc: '患者アプリからの予約枠連携・受付待ち', href: '/reservations', icon: 'reception' },
    { label: 'キャッシュレス会計', desc: '会計連携・自費/保険の請求とサマリ', href: '/billing', icon: 'rx' },
    { label: 'サマリ閲覧（PHR）', desc: '患者へ提供する診療サマリ・文書の閲覧連携', href: '/documents', icon: 'chart' },
  ];

  return (
    <PageBody>
      <PageHeader
        title={`${s.name} さんのポータル`}
        desc="本日の担当業務・未処理・最近のカルテ。患者アプリ（予約/Web問診/会計/サマリ閲覧）連携の入口を集約します。"
        crumbs={['Medixus カルテ', 'ポータル']}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat('受付待ち', statusCounts['ARRIVED'] ?? 0, 'blue')}
        {stat('診察中', statusCounts['IN_CONSULTATION'] ?? 0, 'amber')}
        {stat('未確定処方', pendingRx.length, 'amber')}
        {stat('Web問診取込待ち', webIntakes.length, 'blue')}
      </div>

      <Panel className="mt-4">
        <PanelHeader
          title="患者アプリ連携（PHR）"
          icon={<Icon name="portal" size={16} />}
          desc="予約・Web問診・キャッシュレス会計・診療サマリ閲覧を患者アプリと連携（FR-QNR-01）"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {phrLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex flex-col gap-1 rounded-card border border-line bg-white px-3 py-2.5 shadow-panel transition-colors hover:bg-soft"
            >
              <div className="flex items-center gap-2">
                <Icon name={l.icon} size={15} />
                <span className="text-sm font-semibold text-ink">{l.label}</span>
                {l.badge && <Badge tone="amber">{l.badge}</Badge>}
              </div>
              <span className="text-2xs leading-relaxed text-muted">{l.desc}</span>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="未確定処方（安全チェック実行済・医師確認待ち）"
            icon={<Icon name="rx" size={16} />}
            desc="禁忌・相互作用・重複・極量・アレルギーの自動チェック結果を確認し確定します"
          />
          {pendingRx.length === 0 ? (
            <EmptyState title="未確定の処方はありません" />
          ) : (
            <ul className="divide-y divide-line">
              {pendingRx.map((rx) => (
                <li key={rx.id} className="flex items-center gap-3 py-2 text-sm">
                  <Link
                    href={`/chart/${rx.encounterId}`}
                    className="flex-1 truncate text-info hover:underline"
                  >
                    {rx.itemNames.join(' / ')}
                  </Link>
                  {rx.blocked > 0 && <Badge tone="red">ブロック {rx.blocked}</Badge>}
                  {rx.warn > 0 && <Badge tone="amber">警告 {rx.warn}</Badge>}
                  {rx.blocked === 0 && rx.warn === 0 && <Badge tone="green">問題なし</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="最近開いた患者" icon={<Icon name="patients" size={16} />} />
          {recentLogs.length === 0 ? (
            <EmptyState title="履歴がありません" />
          ) : (
            <ul className="divide-y divide-line">
              {recentLogs.map((l) => {
                const p = recentMap.get(l.patientId);
                if (!p) return null;
                return (
                  <li key={l.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {p.kanjiLastName} {p.kanjiFirstName}
                      </span>
                      <span className="font-mono text-2xs text-muted">{p.patientNo}</span>
                    </div>
                    <div className="text-2xs text-muted">
                      {age(p.dateOfBirth)}歳 ・ {new Date(l.selectedAt).toLocaleString('ja-JP')}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="受付状況サマリ" icon={<Icon name="reception" size={16} />} />
          <div className="flex flex-wrap gap-2">
            {Object.entries(statusCounts).map(([k, v]) => (
              <div key={k} className="rounded border border-line bg-soft px-3 py-1.5 text-xs">
                {RECEPTION_STATUS_LABEL[k as ReceptionStatus] ?? k}{' '}
                <span className="font-bold">{v}</span>
              </div>
            ))}
            {Object.keys(statusCounts).length === 0 && (
              <span className="text-xs text-muted">本日の受付はありません</span>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="未承認カウンターサイン" icon={<Icon name="check" size={16} />} />
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-ink">{countersignCount}</span>
            <Link href="/countersign" className="text-xs text-info hover:underline">
              承認待ちを開く
            </Link>
          </div>
        </Panel>
      </div>
    </PageBody>
  );
}
