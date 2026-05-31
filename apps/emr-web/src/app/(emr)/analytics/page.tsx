import { Panel, PanelHeader, Badge, Icon } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { loadAnalytics } from './actions';
import { RangeToggle, KpiCard, BarList, RevisitDonut, TrendBlock } from './charts-client';

// 受付/カルテ/検査同様、Prisma を読むため明示的に動的化。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>;
}) {
  const sp = await searchParams;
  const months = Number(sp.months ?? '6');

  // 集計は actions 側で fail-soft（DB無/空はデモ）。ここでは描画に専念。
  const data = await loadAnalytics(Number.isFinite(months) ? months : 6);
  const { kpi } = data;

  return (
    <PageBody>
      <PageHeader
        title="経営ダッシュボード"
        desc="疾患別・医師別・点数推移・再診率・収益分析を可視化（FR-ANL / G28）。算定本体はレセコン連携（IF-EXT-01）に委譲し、ここでは経営指標スナップショットを提示します。"
        crumbs={['Medixus カルテ', '分析', '経営ダッシュボード']}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={data.live ? 'green' : 'blue'}>{data.live ? '実データ' : 'デモ'}</Badge>
            <RangeToggle value={data.rangeMonths} />
          </div>
        }
      />

      {!data.live && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB未接続または当期間の実績なし）：受診・オーダ・病名の蓄積に応じて自動で実データへ切り替わります。
        </div>
      )}

      {/* ── KPIサマリ ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="延べ受診数" value={kpi.totalVisits.toLocaleString('ja-JP')} sub={`直近${data.rangeMonths}ヶ月`} />
        <KpiCard
          label="再診率"
          value={`${Math.round(kpi.revisitRate * 100)}%`}
          sub={`初診 ${kpi.firstVisits.toLocaleString('ja-JP')} / 再診 ${kpi.returnVisits.toLocaleString('ja-JP')}`}
          tone="accent"
        />
        <KpiCard label="延べオーダ数" value={kpi.totalOrders.toLocaleString('ja-JP')} sub="最新版オーダ" />
        <KpiCard
          label="推計収益"
          value={`¥${Math.round(kpi.totalRevenueYen).toLocaleString('ja-JP')}`}
          sub="点→円換算（1点=10円）"
          tone="accent"
        />
        <KpiCard label="平均点数 / 受診" value={`${kpi.avgPointsPerVisit.toLocaleString('ja-JP')} 点`} sub="基本料＋オーダ概算" />
      </div>

      {/* ── 時系列：収益・点数推移 ── */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="月次 収益推移"
            desc="オーダ点数＋基本診療料（初診291点/再診75点 概算）の点→円換算"
            icon={<Icon name="billing" size={15} />}
          />
          <TrendBlock points={data.revenueTrend} unit="円" format="yen" />
        </Panel>
        <Panel>
          <PanelHeader title="月次 点数推移" desc="診療報酬点数の総量推移" icon={<Icon name="chart" size={15} />} />
          <TrendBlock points={data.pointsTrend} unit="点" format="num" />
        </Panel>
      </div>

      {/* ── カテゴリ別：疾患別・医師別・再診率 ── */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="疾患別 件数（上位）" desc="有効病名の登録件数" icon={<Icon name="referral" size={15} />} />
          <BarList data={data.byDisease} unit="件" />
        </Panel>
        <Panel>
          <PanelHeader title="医師別 オーダ件数（上位）" desc="オーダ起票者ベース" icon={<Icon name="users" size={15} />} />
          <BarList data={data.byDoctor} unit="件" />
        </Panel>
        <Panel>
          <PanelHeader title="再診率" desc="再診 / 延べ受診" icon={<Icon name="refresh" size={15} />} />
          <RevisitDonut rate={kpi.revisitRate} first={kpi.firstVisits} ret={kpi.returnVisits} />
        </Panel>
      </div>

      {/* ── 月次 受診数（初診/再診 内訳）── */}
      <Panel>
        <PanelHeader title="月次 受診数（初診 / 再診 内訳）" icon={<Icon name="reception" size={15} />} />
        <MonthlyVisitTable rows={data.visitTrend} />
      </Panel>

      <p className="mt-3 text-2xs text-muted/70">
        ※ DigiKar の内蔵統計は「月別受付回数」のみ。本ダッシュボードは疾患別／医師別／点数・収益推移／再診率を一画面で提示し凌駕します（要件定義書 3.2.2）。
        点数・収益は経営概況の目安であり、確定算定はレセコン（共通算定モジュール / WebORCA 系）連携に委ねます。
      </p>
    </PageBody>
  );
}

// 月次受診の表（初診/再診の積み上げをミニバーで併記）。サーバ描画で十分なため非client。
function MonthlyVisitTable({ rows }: { rows: { label: string; first: number; ret: number }[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.first + r.ret), 0) || 1;
  if (rows.length === 0) {
    return <div className="py-6 text-center text-2xs text-muted">データなし</div>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="bg-soft text-2xs uppercase text-muted">
          <th className="px-2 py-1.5 text-left">月</th>
          <th className="px-2 py-1.5 text-right">初診</th>
          <th className="px-2 py-1.5 text-right">再診</th>
          <th className="px-2 py-1.5 text-right">合計</th>
          <th className="px-2 py-1.5 text-left">構成</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const total = r.first + r.ret;
          const fw = (r.first / max) * 100;
          const rw = (r.ret / max) * 100;
          return (
            <tr key={r.label} className="border-t border-line">
              <td className="px-2 py-1.5 font-mono text-2xs">{r.label}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.first.toLocaleString('ja-JP')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.ret.toLocaleString('ja-JP')}</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{total.toLocaleString('ja-JP')}</td>
              <td className="px-2 py-1.5">
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-soft">
                  <div className="h-full bg-accent-300" style={{ width: `${fw}%` }} title={`初診 ${r.first}`} />
                  <div className="h-full bg-accent-600" style={{ width: `${rw}%` }} title={`再診 ${r.ret}`} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
