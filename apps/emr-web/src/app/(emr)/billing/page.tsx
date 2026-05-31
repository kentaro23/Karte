import Link from 'next/link';
import { prisma } from '@medixus/db';
import {
  age,
  pointsToYen,
  buildBillingBreakdown,
  type CopayRatio,
} from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { finalizeBilling } from './actions';

// 受付/カルテ同様、Prisma を読むため明示的に動的化。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

/* ── 型 ─────────────────────────────────────────────────────────────────── */
type RxLine = { name: string; pricePoints: number; qty: number; lineYen: number };
type BillRow = {
  encounterId: string;
  patientId: string;
  patientNo: string;
  patientName: string;
  patientAge: number | null;
  status: ReceptionStatusLike;
  createdAt: Date;
  drugPoints: number; // 薬剤の点数合計（nhiPrice/10 × 数量）
  rxLines: RxLine[];
  rxIds: string[];
  hasOutOfHouseRx: boolean;
};
type ReceptionStatusLike = string;

type LoadResult = { rows: BillRow[]; dbDown: boolean };

/* ── デモ（DB未接続）用の決定論サンプル ───────────────────────────────────── */
const DEMO_ROWS: BillRow[] = [
  {
    encounterId: 'demo-enc-1',
    patientId: 'demo-pat-1',
    patientNo: '000123',
    patientName: '見本 太郎',
    patientAge: 58,
    status: 'CONSULTATION_DONE',
    createdAt: new Date('2026-05-31T10:20:00'),
    drugPoints: 1.0 * 28 + 4.6 * 28, // = 156.8（アムロジピン5mg + ロスバスタチン2.5mg 28日分）
    rxLines: [
      { name: 'アムロジピン錠5mg', pricePoints: 1.0, qty: 28, lineYen: 280 },
      { name: 'ロスバスタチン錠2.5mg', pricePoints: 4.6, qty: 28, lineYen: 1288 },
    ],
    rxIds: ['demo-rx-1'],
    hasOutOfHouseRx: true,
  },
  {
    encounterId: 'demo-enc-2',
    patientId: 'demo-pat-2',
    patientNo: '000124',
    patientName: '試験 花子',
    patientAge: 41,
    status: 'CONSULTATION_DONE',
    createdAt: new Date('2026-05-31T11:05:00'),
    drugPoints: 0.9 * 10, // = 9（カロナール500mg 10回分）
    rxLines: [{ name: 'カロナール錠500mg', pricePoints: 0.9, qty: 10, lineYen: 90 }],
    rxIds: ['demo-rx-2'],
    hasOutOfHouseRx: false,
  },
];

/** 直近の会計対象（処方のある受診）を点数集計付きで取得（DB無/未登録時はデモ）。 */
async function loadBills(): Promise<LoadResult> {
  try {
    const rxs = await prisma.prescription.findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: {
        items: { include: { drug: { select: { brandName: true, nhiPrice: true } } } },
      },
    });
    if (rxs.length === 0) return { rows: DEMO_ROWS, dbDown: false };

    const patientIds = [...new Set(rxs.map((r) => r.patientId))];
    const encounterIds = [...new Set(rxs.map((r) => r.encounterId))];
    const [pts, encs] = await Promise.all([
      prisma.patient.findMany({
        where: { id: { in: patientIds } },
        select: {
          id: true,
          patientNo: true,
          kanjiLastName: true,
          kanjiFirstName: true,
          dateOfBirth: true,
        },
      }),
      prisma.encounter.findMany({
        where: { id: { in: encounterIds } },
        select: { id: true, receptionStatus: true, createdAt: true },
      }),
    ]);
    const pMap = new Map(pts.map((p) => [p.id, p]));
    const eMap = new Map(encs.map((e) => [e.id, e]));

    // 受診（Encounter）単位に集約。1受診に複数処方があれば合算する。
    const byEnc = new Map<string, BillRow>();
    for (const rx of rxs) {
      const p = pMap.get(rx.patientId);
      const e = eMap.get(rx.encounterId);
      const existing = byEnc.get(rx.encounterId);
      const outOfHouse = rx.dispenseType === 'OUT_OF_HOUSE';
      const lines: RxLine[] = rx.items.map((it) => {
        const pricePoints = (it.drug.nhiPrice ?? 0) / 10; // 円→点（1点=10円）
        const qty = it.dosePerTime * it.timesPerDay * it.days;
        return {
          name: it.drug.brandName,
          pricePoints: Math.round(pricePoints * 10) / 10,
          qty,
          lineYen: Math.round((it.drug.nhiPrice ?? 0) * qty),
        };
      });
      const drugPoints = lines.reduce((s, l) => s + l.pricePoints * l.qty, 0);
      if (existing) {
        existing.drugPoints += drugPoints;
        existing.rxLines.push(...lines);
        existing.rxIds.push(rx.id);
        existing.hasOutOfHouseRx = existing.hasOutOfHouseRx || outOfHouse;
      } else {
        byEnc.set(rx.encounterId, {
          encounterId: rx.encounterId,
          patientId: rx.patientId,
          patientNo: p?.patientNo ?? '—',
          patientName: p ? `${p.kanjiLastName} ${p.kanjiFirstName}` : '—',
          patientAge: p ? age(p.dateOfBirth) : null,
          status: (e?.receptionStatus as ReceptionStatusLike) ?? 'CONSULTATION_DONE',
          createdAt: e?.createdAt ?? rx.createdAt,
          drugPoints,
          rxLines: lines,
          rxIds: [rx.id],
          hasOutOfHouseRx: outOfHouse,
        });
      }
    }
    const rows = [...byEnc.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return { rows, dbDown: false };
  } catch (err) {
    console.error('[BillingPage] loadBills failed, demo fallback:', err);
    return { rows: DEMO_ROWS, dbDown: true };
  }
}

/* ── 数値ヘルパ ─────────────────────────────────────────────────────────── */
function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}
function toInt(v: string | undefined, fallback = 0): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function ratioFromAge(a: number | null): CopayRatio {
  // 慣行に基づく既定（実際の負担割合は保険資格に従う。会計画面で調整可）。
  if (a == null) return 0.3;
  if (a < 6) return 0.2; // 未就学児（自治体助成で変動）
  if (a >= 75) return 0.1; // 後期高齢者（所得で1〜3割）
  if (a >= 70) return 0.2; // 高齢受給者（所得で2〜3割）
  return 0.3;
}
const RATIO_OPTIONS: { v: CopayRatio; label: string }[] = [
  { v: 0.3, label: '3割' },
  { v: 0.2, label: '2割' },
  { v: 0.1, label: '1割' },
  { v: 0, label: '0割（公費全額等）' },
];

const STATUS_LABEL: Record<string, string> = {
  CONSULTATION_DONE: '診察終了',
  BILLING_DONE: '会計済',
  IN_CONSULTATION: '診察中',
  READY: '到着済',
};

/* ── 発行物（一括発行）定義 — FR-BIL-01 AC(2) ─────────────────────────────── */
type IssueDoc = {
  key: string;
  label: string;
  hint: string;
  href?: (row: BillRow, calcQs: string) => string | null;
};
const ISSUE_DOCS: IssueDoc[] = [
  {
    key: 'receipt',
    label: '領収書',
    hint: '一部負担金・自費・合計',
    href: (r, q) => `/print/receipt/${r.encounterId}${q}`,
  },
  {
    key: 'statement',
    label: '診療明細書',
    hint: '明細（点数内訳）',
    href: (r, q) => `/print/receipt/${r.encounterId}${q ? `${q}&detail=1` : '?detail=1'}`,
  },
  {
    key: 'rx',
    label: '院外処方箋',
    hint: '院外処方時のみ',
    href: (r) => (r.rxIds[0] ? `/print/prescription/${r.rxIds[0]}` : null),
  },
  { key: 'druginfo', label: '薬剤情報提供書', hint: '患者向け薬剤情報' },
  { key: 'medbook', label: 'お薬手帳（シール）', hint: '調剤連携' },
];

/** 領収書/明細へ会計入力を引き継ぐ query 文字列を組み立てる（空値は省略）。 */
function buildCalcQuery(p: {
  action: number;
  ratio: number;
  self: number;
  carry: number;
  adj: number;
  deposit: number;
}): string {
  const qp = new URLSearchParams();
  if (p.action) qp.set('action', String(p.action));
  qp.set('ratio', String(p.ratio));
  if (p.self) qp.set('self', String(p.self));
  if (p.carry) qp.set('carry', String(p.carry));
  if (p.adj) qp.set('adj', String(p.adj));
  if (p.deposit) qp.set('deposit', String(p.deposit));
  const s = qp.toString();
  return s ? `?${s}` : '';
}

/* ── ページ本体 ─────────────────────────────────────────────────────────── */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { rows, dbDown } = await loadBills();
  const selectedId = sp.encounterId ?? '';
  const selected = rows.find((r) => r.encounterId === selectedId) ?? null;

  // 当日合計（請求見込み）— 一覧ヘッダ用。
  const totalDrugPoints = rows.reduce((s, r) => s + r.drugPoints, 0);

  // 選択受診の会計内訳（searchParams 駆動・JS不要の GET フォームで再計算）。
  let bd: ReturnType<typeof buildBillingBreakdown> | null = null;
  let depositYen = 0;
  let changeYen = 0;
  let actionPoints = 0;
  let copayRatio: CopayRatio = 0.3;
  if (selected) {
    actionPoints = toInt(sp.action, 0); // 診療行為点数（レセコン算定の暫定手入力）
    copayRatio = (toInt(sp.ratio, ratioFromAge(selected.patientAge)) as CopayRatio);
    const totalPoints = Math.round(selected.drugPoints) + actionPoints;
    bd = buildBillingBreakdown({
      totalPoints,
      copayRatio,
      selfPayYen: toInt(sp.self, 0),
      carryOverYen: toInt(sp.carry, 0),
      adjustmentYen: toInt(sp.adj, 0),
    });
    depositYen = toInt(sp.deposit, 0);
    changeYen = depositYen > 0 ? depositYen - bd.billedYen : 0;
  }

  // 発行物リンクへ会計入力を引き継ぐ query。
  const calcQs = selected
    ? buildCalcQuery({
        action: actionPoints,
        ratio: copayRatio,
        self: toInt(sp.self, 0),
        carry: toInt(sp.carry, 0),
        adj: toInt(sp.adj, 0),
        deposit: depositYen,
      })
    : '';

  // 会計確定（サーバアクション束縛）。確定後の内訳を監査に保存し BILLING_DONE へ。
  async function confirm(formData: FormData) {
    'use server';
    if (!selected || !bd) return;
    await finalizeBilling({
      encounterId: selected.encounterId,
      patientId: selected.patientId,
      totalPoints: bd.totalPoints,
      copayRatio: bd.copayRatio,
      copayYen: bd.copayYen,
      selfPayYen: bd.selfPayYen,
      carryOverYen: bd.carryOverYen,
      adjustmentYen: bd.adjustmentYen,
      billedYen: bd.billedYen,
      depositYen: toInt(String(formData.get('deposit') ?? '')),
      changeYen: toInt(String(formData.get('change') ?? '')),
    });
  }

  return (
    <PageBody>
      <PageHeader
        title="会計・レセプト"
        desc="点→円・自己負担/自費/繰越・調整/入金/差額、発行物の一括発行、会計確定（FR-BIL-01）"
        crumbs={['Medixus カルテ', '管理', '会計']}
        actions={
          <Badge tone="blue">
            本日 薬剤点数 {Math.round(totalDrugPoints).toLocaleString()}点（≒
            {yen(pointsToYen(totalDrugPoints))}）
          </Badge>
        }
      />

      {dbDown && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB未接続）：会計確定・発行記録は無効です。点→円・自己負担計算と一括発行UIを提示します。
        </div>
      )}

      <Panel className="mb-4" pad={false}>
        <div className="px-4 py-2.5 text-2xs text-muted">
          ※ 1点=10円。薬剤点数は薬価（nhiPrice）から自動集計。診察料・処置・検査などの
          <b>診療行為点数</b>と<b>レセプト本体</b>は標準型レセコン／共通算定モジュール連携（IF-EXT-01）に委譲し、
          本画面では点数合計→自己負担・請求額の即時表示と発行物・会計確定を担います。
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(360px,440px)]">
        {/* ── 会計対象一覧 ── */}
        <Panel pad={false}>
          <div className="border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-bold text-ink">会計対象（直近の受診）</h2>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="会計対象がありません" icon={<Icon name="billing" size={30} />} />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="px-3 py-2 text-left">日時</th>
                  <th className="px-3 py-2 text-left">患者</th>
                  <th className="px-3 py-2 text-left">処方</th>
                  <th className="px-3 py-2 text-left">状態</th>
                  <th className="px-3 py-2 text-right">薬剤点数</th>
                  <th className="px-3 py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isSel = r.encounterId === selectedId;
                  return (
                    <tr
                      key={r.encounterId}
                      className={
                        isSel ? 'bg-accent-50' : i % 2 ? 'bg-soft/40' : ''
                      }
                    >
                      <td className="px-3 py-2 text-2xs text-muted">
                        {r.createdAt.toLocaleString('ja-JP')}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-2xs text-muted">{r.patientNo}</span>{' '}
                        {r.patientName}
                        {r.patientAge != null && (
                          <span className="ml-1 text-2xs text-muted">（{r.patientAge}）</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-2xs">
                        {r.rxLines
                          .slice(0, 2)
                          .map((l) => l.name)
                          .join(' / ')}
                        {r.rxLines.length > 2 && ` 他${r.rxLines.length - 2}件`}
                        {r.hasOutOfHouseRx && (
                          <Badge tone="teal" className="ml-1">
                            院外
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={r.status === 'BILLING_DONE' ? 'green' : 'amber'}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {Math.round(r.drugPoints).toLocaleString()}点
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/billing?encounterId=${r.encounterId}`}
                          className="text-xs font-semibold text-accent-700 hover:underline"
                        >
                          会計 →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        {/* ── 会計内訳（選択時） ── */}
        {!selected ? (
          <Panel>
            <EmptyState
              title="会計する受診を選択してください"
              hint="左の一覧で「会計 →」を押すと、点→円・自己負担計算と発行物・会計確定ができます"
              icon={<Icon name="billing" size={30} />}
            />
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            {/* 患者・計算入力（GET フォーム＝JS不要で再計算） */}
            <Panel>
              <PanelHeader
                title={`${selected.patientName} の会計`}
                desc={`受診日時 ${selected.createdAt.toLocaleString('ja-JP')}`}
                icon={<Icon name="billing" size={15} />}
                actions={
                  <Badge tone={selected.status === 'BILLING_DONE' ? 'green' : 'amber'}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </Badge>
                }
              />

              {/* 薬剤明細（点数内訳） */}
              <div className="mb-3 overflow-hidden rounded border border-line">
                <table className="w-full border-collapse text-2xs">
                  <thead>
                    <tr className="bg-soft uppercase text-muted">
                      <th className="px-2 py-1 text-left">薬剤</th>
                      <th className="px-2 py-1 text-right">点/単位</th>
                      <th className="px-2 py-1 text-right">数量</th>
                      <th className="px-2 py-1 text-right">小計(点)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rxLines.map((l, idx) => (
                      <tr key={idx} className="border-t border-line">
                        <td className="px-2 py-1">{l.name}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{l.pricePoints}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{l.qty}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {Math.round(l.pricePoints * l.qty).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-line bg-soft/60 font-semibold">
                      <td className="px-2 py-1" colSpan={3}>
                        薬剤点数 小計
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {Math.round(selected.drugPoints).toLocaleString()}点
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <form method="GET" className="grid grid-cols-2 gap-2.5 text-sm">
                <input type="hidden" name="encounterId" value={selected.encounterId} />
                <label className="flex flex-col gap-0.5">
                  <span className="text-2xs text-muted">診療行為点数（手入力／レセコン暫定）</span>
                  <input
                    name="action"
                    inputMode="numeric"
                    defaultValue={actionPoints || ''}
                    placeholder="例: 初診291 など"
                    className="rounded border border-line px-2 py-1.5 text-sm tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-2xs text-muted">自己負担割合</span>
                  <select
                    name="ratio"
                    defaultValue={String(copayRatio)}
                    className="rounded border border-line px-2 py-1.5 text-sm"
                  >
                    {RATIO_OPTIONS.map((o) => (
                      <option key={o.v} value={String(o.v)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-2xs text-muted">自費（保険外・円）</span>
                  <input
                    name="self"
                    inputMode="numeric"
                    defaultValue={toInt(sp.self) || ''}
                    placeholder="0"
                    className="rounded border border-line px-2 py-1.5 text-sm tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-2xs text-muted">前回繰越（未収・円）</span>
                  <input
                    name="carry"
                    inputMode="numeric"
                    defaultValue={toInt(sp.carry) || ''}
                    placeholder="0"
                    className="rounded border border-line px-2 py-1.5 text-sm tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-2xs text-muted">調整金（割引は負・円）</span>
                  <input
                    name="adj"
                    inputMode="numeric"
                    defaultValue={toInt(sp.adj) || ''}
                    placeholder="0"
                    className="rounded border border-line px-2 py-1.5 text-sm tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-2xs text-muted">預り金（入金・円）</span>
                  <input
                    name="deposit"
                    inputMode="numeric"
                    defaultValue={depositYen || ''}
                    placeholder="0"
                    className="rounded border border-line px-2 py-1.5 text-sm tabular-nums"
                  />
                </label>
                <div className="col-span-2">
                  <Button type="submit" variant="secondary" size="sm">
                    <Icon name="check" size={13} /> 再計算
                  </Button>
                </div>
              </form>
            </Panel>

            {/* 会計内訳（点→円・自己負担） */}
            {bd && (
              <Panel>
                <PanelHeader title="会計内訳" icon={<Icon name="billing" size={15} />} />
                <dl className="divide-y divide-line text-sm">
                  <Line label="総点数" value={`${bd.totalPoints.toLocaleString()}点`} />
                  <Line label="総額（10割）" value={yen(bd.totalYen)} sub={`${YEN_HINT}`} />
                  <Line
                    label={`自己負担（${Math.round(bd.copayRatio * 10)}割）`}
                    value={yen(bd.copayYen)}
                    strong
                  />
                  <Line label="保険者負担" value={yen(bd.insurerYen)} muted />
                  <Line label="自費（保険外）" value={yen(bd.selfPayYen)} />
                  <Line label="前回繰越" value={yen(bd.carryOverYen)} />
                  <Line
                    label="調整金"
                    value={`${bd.adjustmentYen < 0 ? '−' : ''}${yen(Math.abs(bd.adjustmentYen))}`}
                  />
                  <div className="flex items-center justify-between bg-accent-50 px-1 py-2.5">
                    <dt className="text-sm font-bold text-ink">今回請求額</dt>
                    <dd className="text-lg font-bold tabular-nums text-accent-700">
                      {yen(bd.billedYen)}
                    </dd>
                  </div>
                  <Line label="預り金" value={yen(depositYen)} />
                  <div className="flex items-center justify-between px-1 py-2">
                    <dt className="text-sm font-semibold text-ink">お釣り／不足</dt>
                    <dd
                      className={`text-base font-bold tabular-nums ${
                        changeYen < 0 ? 'text-alert' : 'text-ink'
                      }`}
                    >
                      {changeYen < 0
                        ? `不足 ${yen(Math.abs(changeYen))}`
                        : yen(changeYen)}
                    </dd>
                  </div>
                </dl>

                {/* 会計確定 — AC(3) BILLING_DONE */}
                <form action={confirm} className="mt-3">
                  <input type="hidden" name="deposit" value={depositYen} />
                  <input type="hidden" name="change" value={changeYen} />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={dbDown || selected.status === 'BILLING_DONE'}
                    className="w-full justify-center"
                  >
                    <Icon name="check" size={14} />
                    {selected.status === 'BILLING_DONE' ? '会計済' : '会計確定（→ 会計済）'}
                  </Button>
                </form>
                {selected.status !== 'BILLING_DONE' && (
                  <p className="mt-1.5 text-2xs text-muted/80">
                    確定すると受付ステータスが「会計済（BILLING_DONE）」になり、内訳が監査に記録されます。
                  </p>
                )}
              </Panel>
            )}

            {/* 発行物 一括発行 — AC(2) */}
            <Panel>
              <PanelHeader
                title="発行物（一括発行）"
                desc="領収書・診療明細書・院外処方箋・薬剤情報・お薬手帳"
                icon={<Icon name="print" size={15} />}
              />
              <div className="mb-2.5 flex flex-wrap gap-2">
                {ISSUE_DOCS.map((d) => {
                  const href = d.href?.(selected, calcQs) ?? null;
                  const disabled = !href;
                  return (
                    <div key={d.key} className="min-w-[150px] flex-1">
                      {href ? (
                        <Link href={href} target="_blank" className="block">
                          <div className="rounded border border-accent-200 bg-accent-50 px-3 py-2 transition-colors hover:bg-accent-100">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-700">
                              <Icon name="print" size={13} /> {d.label}
                            </div>
                            <div className="mt-0.5 text-2xs text-muted">{d.hint}</div>
                          </div>
                        </Link>
                      ) : (
                        <div className="rounded border border-line bg-soft px-3 py-2 opacity-70">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                            <Icon name="print" size={13} /> {d.label}
                          </div>
                          <div className="mt-0.5 text-2xs text-muted">
                            {disabled && d.key === 'rx' ? '院外処方なし' : `${d.hint}（準備中）`}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* 一括＝領収書＋明細を新規タブで開く（ブラウザ印刷でまとめて出力） */}
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/print/receipt/${selected.encounterId}${
                    calcQs ? `${calcQs}&detail=1` : '?detail=1'
                  }`}
                  target="_blank"
                >
                  <Button variant="secondary" size="sm">
                    <Icon name="print" size={13} /> 領収書＋明細をまとめて表示
                  </Button>
                </Link>
                <span className="text-2xs text-muted">
                  ※ 院外処方箋は処方画面の様式（/print/prescription）と共通。薬剤情報・お薬手帳は調剤/服薬指導連携で発行。
                </span>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </PageBody>
  );
}

const YEN_HINT = '1点=10円';

/** 内訳の1行（dt/dd）。 */
function Line({
  label,
  value,
  sub,
  strong,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-1 py-2">
      <dt className={`text-sm ${muted ? 'text-muted' : 'text-ink'}`}>
        {label}
        {sub && <span className="ml-1 text-2xs text-muted">（{sub}）</span>}
      </dt>
      <dd
        className={`tabular-nums ${
          strong ? 'text-base font-bold text-ink' : muted ? 'text-muted' : 'font-semibold text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
