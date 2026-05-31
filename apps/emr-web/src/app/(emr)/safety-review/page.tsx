import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, Button, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { getSession } from '@/lib/session';
import { promoteSafetyData, type SafetyEntityTable } from './actions';

/* ── 型（フロントのみモードのフォールバックにも使う） ───────────────────── */
type SafetyRow = {
  id: string;
  entityTable: SafetyEntityTable;
  targetKind: string; // PRODUCT | INGREDIENT
  targetId: string;
  targetName: string;
  summary: string; // 内容の要約（適応症・用量・禁忌条件・相互作用相手）
  source: string;
  sourceCitation: string;
  isProvisional: boolean;
};
type ReviewLogRow = {
  id: string;
  entityTable: string;
  entityId: string;
  action: string;
  beforeSource: string | null;
  afterSource: string | null;
  reviewedByUserId: string | null;
  reason: string | null;
  sourceCitation: string | null;
  createdAt: Date | null;
};

const ENTITY_LABEL: Record<SafetyEntityTable, string> = {
  DrugIndication: '適応症',
  DrugDosage: '用法・用量',
  DrugContraindication: '禁忌',
  DrugInteraction: '相互作用',
};
const ENTITY_ICON: Record<SafetyEntityTable, 'rx' | 'warning' | 'order'> = {
  DrugIndication: 'rx',
  DrugDosage: 'rx',
  DrugContraindication: 'warning',
  DrugInteraction: 'order',
};
const SOURCE_LABEL: Record<string, string> = {
  MHLW_RECEIPT: '厚労省レセ電',
  MEDIS: 'MEDIS',
  PMDA_PI_STRUCTURED: 'PMDA添付文書(構造化)',
  PMDA_PI_XML: 'PMDA添付文書(XML)',
  PHARMACIST_VERIFIED: '薬剤師承認済',
  CURATED_SEED: 'キュレート初期データ',
};
const SOURCE_TONE: Record<string, 'green' | 'amber' | 'blue' | 'gray'> = {
  PHARMACIST_VERIFIED: 'green',
  PMDA_PI_STRUCTURED: 'blue',
  PMDA_PI_XML: 'blue',
  MEDIS: 'blue',
  MHLW_RECEIPT: 'blue',
  CURATED_SEED: 'amber',
};

function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}
function sourceTone(s: string): 'green' | 'amber' | 'blue' | 'gray' {
  return SOURCE_TONE[s] ?? 'gray';
}

/* ── フロントのみモード用デモデータ ─────────────────────────────────────── */
function demoPending(): SafetyRow[] {
  return [
    {
      id: 'demo-saf-1',
      entityTable: 'DrugContraindication',
      targetKind: 'PRODUCT',
      targetId: 'demo-drug-37',
      targetName: 'ワーファリン錠1mg',
      summary: '【絶対禁忌】出血している患者（消化管出血・頭蓋内出血等）への投与禁止',
      source: 'PMDA_PI_STRUCTURED',
      sourceCitation: 'PMDA添付文書 2026年3月改訂 第8版',
      isProvisional: true,
    },
    {
      id: 'demo-saf-2',
      entityTable: 'DrugDosage',
      targetKind: 'PRODUCT',
      targetId: 'demo-drug-1',
      targetName: 'カロナール錠200mg',
      summary: '成人 1回300〜1000mg・1日最大4000mg（アセトアミノフェンとして）',
      source: 'PMDA_PI_STRUCTURED',
      sourceCitation: 'PMDA添付文書 2025年11月改訂',
      isProvisional: true,
    },
    {
      id: 'demo-saf-3',
      entityTable: 'DrugInteraction',
      targetKind: 'PRODUCT',
      targetId: 'demo-drug-11',
      targetName: 'クラビット錠500mg',
      summary: '相互作用：アルミニウム・マグネシウム含有制酸剤と併用で吸収低下（同時服用回避）',
      source: 'PMDA_PI_STRUCTURED',
      sourceCitation: 'PMDA添付文書 2025年9月改訂',
      isProvisional: true,
    },
    {
      id: 'demo-saf-4',
      entityTable: 'DrugIndication',
      targetKind: 'PRODUCT',
      targetId: 'demo-drug-24',
      targetName: 'ノルバスク錠5mg',
      summary: '適応症：高血圧症、狭心症（ICD-10: I10, I20）',
      source: 'CURATED_SEED',
      sourceCitation: '社内キュレート暫定（要薬剤師確認）',
      isProvisional: true,
    },
  ];
}
function demoLogs(): ReviewLogRow[] {
  return [
    {
      id: 'demo-log-1',
      entityTable: 'DrugContraindication',
      entityId: 'demo-drug-39-ci',
      action: 'supersede',
      beforeSource: 'PMDA_PI_STRUCTURED',
      afterSource: 'PHARMACIST_VERIFIED',
      reviewedByUserId: 'demo-staff-3',
      reason: '添付文書と一致を確認、院内採用品に適用。',
      sourceCitation: 'PMDA添付文書 2026年2月改訂',
      createdAt: new Date('2026-05-28T11:20:00'),
    },
    {
      id: 'demo-log-2',
      entityTable: 'DrugDosage',
      entityId: 'demo-drug-30-dose',
      action: 'supersede',
      beforeSource: 'CURATED_SEED',
      afterSource: 'PHARMACIST_VERIFIED',
      reviewedByUserId: 'demo-staff-3',
      reason: '腎機能別用量を添付文書で再確認のうえ承認。',
      sourceCitation: 'PMDA添付文書 2025年12月改訂',
      createdAt: new Date('2026-05-26T16:05:00'),
    },
  ];
}

/** before/after の JSON から source の遷移を取り出す（ログ表示用・null安全）。 */
function readSource(v: unknown): string | null {
  if (v && typeof v === 'object' && 'source' in v) {
    const s = (v as { source?: unknown }).source;
    return typeof s === 'string' ? s : null;
  }
  return null;
}

/**
 * フェイルソフトなデータ取得。DB 未接続／未マイグレーション／空シードでも
 * 画面が成立するよう、例外時・空時はデモデータにフォールバックする。
 * 暫定（isProvisional）または source≠PHARMACIST_VERIFIED の安全データを昇格候補とする。
 */
async function loadData(): Promise<{ pending: SafetyRow[]; logs: ReviewLogRow[]; live: boolean }> {
  try {
    const notVerified = { OR: [{ isProvisional: true }, { NOT: { source: 'PHARMACIST_VERIFIED' as const } }] };
    const [indications, dosages, contras, interactions, logs, products] = await Promise.all([
      prisma.drugIndication.findMany({ where: notVerified, orderBy: { createdAt: 'desc' }, take: 40 }),
      prisma.drugDosage.findMany({ where: notVerified, orderBy: { createdAt: 'desc' }, take: 40 }),
      prisma.drugContraindication.findMany({ where: notVerified, orderBy: { createdAt: 'desc' }, take: 40 }),
      prisma.drugInteraction.findMany({
        where: { OR: [{ isProvisional: true }, { NOT: { source: 'PHARMACIST_VERIFIED' as const } }] },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
      prisma.drugSafetyReviewLog.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
      prisma.drugProduct.findMany({ take: 500, select: { id: true, brandName: true } }),
    ]);

    const nameOf = (() => {
      const m = new Map(products.map((p) => [p.id, p.brandName]));
      return (id: string) => m.get(id) ?? id;
    })();

    const pending: SafetyRow[] = [
      ...indications.map((r): SafetyRow => ({
        id: r.id,
        entityTable: 'DrugIndication',
        targetKind: r.targetKind,
        targetId: r.targetId,
        targetName: nameOf(r.targetId),
        summary: r.indicationText + (r.icd10Codes?.length ? `（ICD-10: ${r.icd10Codes.join(', ')}）` : ''),
        source: r.source,
        sourceCitation: r.sourceCitation,
        isProvisional: r.isProvisional,
      })),
      ...dosages.map((r): SafetyRow => ({
        id: r.id,
        entityTable: 'DrugDosage',
        targetKind: r.targetKind,
        targetId: r.targetId,
        targetName: nameOf(r.targetId),
        summary: r.dosageText ?? `${r.population} ${r.route}・最大 ${r.maxDoseDaily ?? '—'}/日`,
        source: r.source,
        sourceCitation: r.sourceCitation,
        isProvisional: r.isProvisional,
      })),
      ...contras.map((r): SafetyRow => ({
        id: r.id,
        entityTable: 'DrugContraindication',
        targetKind: r.targetKind,
        targetId: r.targetId,
        targetName: nameOf(r.targetId),
        summary: `【${r.severity === 'ABSOLUTE' ? '絶対禁忌' : '相対禁忌'}】${r.conditionText}`,
        source: r.source,
        sourceCitation: r.sourceCitation,
        isProvisional: r.isProvisional,
      })),
      ...interactions.map((r): SafetyRow => ({
        id: r.id,
        entityTable: 'DrugInteraction',
        targetKind: r.subjectKind,
        targetId: r.subjectId,
        targetName: nameOf(r.subjectId),
        summary: r.clinicalEffect ?? r.mechanism ?? r.management ?? '相互作用',
        source: r.source,
        sourceCitation: r.sourceCitation,
        isProvisional: r.isProvisional,
      })),
    ];

    const logRows: ReviewLogRow[] = logs.map((l) => ({
      id: l.id,
      entityTable: l.entityTable,
      entityId: l.entityId,
      action: l.action,
      beforeSource: readSource(l.before),
      afterSource: readSource(l.after),
      reviewedByUserId: l.reviewedByUserId,
      reason: l.reason,
      sourceCitation: l.sourceCitation,
      createdAt: l.createdAt,
    }));

    if (pending.length === 0 && logRows.length === 0) {
      return { pending: demoPending(), logs: demoLogs(), live: false };
    }
    return { pending, logs: logRows, live: true };
  } catch (err) {
    console.error('[safety-review] loadData failed; showing demo data:', err);
    return { pending: demoPending(), logs: demoLogs(), live: false };
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

export default async function SafetyReviewPage() {
  const session = await getSession();
  const { pending, logs, live } = await loadData();
  const canPromote = !session?.jobType || session.jobType === 'PHARMACIST' || session.jobType === 'ADMIN';

  return (
    <PageBody>
      <PageHeader
        title="安全データ 薬剤師レビュー"
        desc="取込／暫定の医薬品安全データ（適応症・用量・禁忌・相互作用）を薬剤師が確認し PHARMACIST_VERIFIED へ昇格。差分は追記専用ログに記録（FR-RXSAFE-06 / 真正性）"
        crumbs={['Medixus カルテ', '医薬品安全', '薬剤師レビュー']}
        actions={
          <span className="flex items-center gap-2">
            {pending.length > 0 && (
              <Badge tone="amber" title="昇格待ちの暫定安全データ">
                昇格待ち {pending.length}
              </Badge>
            )}
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      {!canPromote && (
        <Panel className="mb-4">
          <p className="flex items-center gap-2 text-xs text-amber-800">
            <Icon name="lock" size={14} />
            安全データの昇格は薬剤師（PHARMACIST）権限が必要です。現在の職種（{session?.jobType}）では閲覧のみ可能です。
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        {/* ── 昇格待ちリスト ── */}
        <Panel>
          <PanelHeader
            title="昇格待ち 暫定安全データ"
            icon={<Icon name="rx" size={15} />}
            actions={<Badge tone={pending.length ? 'amber' : 'gray'}>{pending.length} 件</Badge>}
          />
          {pending.length === 0 ? (
            <EmptyState
              title="昇格待ちの安全データはありません"
              hint="取込・暫定（isProvisional）のデータがあるとここに表示され、薬剤師が PHARMACIST_VERIFIED へ昇格できます"
              icon={<Icon name="rx" size={28} />}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((r) => (
                <li key={`${r.entityTable}-${r.id}`} className="rounded border border-amber-300 bg-amber-50/40 p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone="blue">
                      <Icon name={ENTITY_ICON[r.entityTable]} size={11} className="mr-1 inline align-text-bottom" />
                      {ENTITY_LABEL[r.entityTable]}
                    </Badge>
                    <span className="text-sm font-semibold text-ink">{r.targetName}</span>
                    <span className="text-2xs text-muted">
                      {r.targetKind === 'PRODUCT' ? '製品' : '成分'}
                    </span>
                    <Badge tone={sourceTone(r.source)}>{sourceLabel(r.source)}</Badge>
                    {r.isProvisional && <Badge tone="amber">暫定</Badge>}
                  </div>
                  <p className="mb-2 whitespace-pre-wrap rounded border border-line bg-white px-2.5 py-2 text-xs leading-relaxed text-ink">
                    {r.summary}
                  </p>
                  <p className="mb-2 text-2xs text-muted">出典: {r.sourceCitation}</p>
                  <form action={promoteSafetyData} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <input type="hidden" name="entityTable" value={r.entityTable} />
                    <input type="hidden" name="id" value={r.id} />
                    <label className="flex-1 text-2xs text-muted">
                      レビュー理由・確認内容（任意）
                      <input
                        name="reason"
                        placeholder="例：添付文書と一致を確認"
                        className="mt-0.5 w-full rounded border border-line px-2 py-1 text-xs text-ink"
                      />
                    </label>
                    <Button size="sm" variant="primary" type="submit" disabled={!canPromote}>
                      薬剤師承認（昇格）
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── 追記専用 レビュー証跡 ── */}
        <Panel>
          <PanelHeader
            title="レビュー証跡（追記専用）"
            icon={<Icon name="audit" size={15} />}
            actions={<Badge tone="gray">{logs.length} 件</Badge>}
          />
          {logs.length === 0 ? (
            <EmptyState title="レビュー記録はありません" icon={<Icon name="audit" size={28} />} />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {logs.map((l) => (
                <li key={l.id} className="rounded border border-line p-2.5 text-xs">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="blue">
                      {ENTITY_LABEL[l.entityTable as SafetyEntityTable] ?? l.entityTable}
                    </Badge>
                    <Badge tone="gray">{l.action}</Badge>
                    <span className="ml-auto text-2xs text-muted">{fmt(l.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-2xs">
                    {l.beforeSource && (
                      <>
                        <Badge tone={sourceTone(l.beforeSource)}>{sourceLabel(l.beforeSource)}</Badge>
                        <Icon name="chevron" size={11} />
                      </>
                    )}
                    <Badge tone={sourceTone(l.afterSource ?? 'PHARMACIST_VERIFIED')}>
                      {sourceLabel(l.afterSource ?? 'PHARMACIST_VERIFIED')}
                    </Badge>
                  </div>
                  {l.reason && <p className="mt-1 text-2xs text-ink/80">{l.reason}</p>}
                  {l.sourceCitation && <p className="mt-0.5 text-2xs text-muted">出典: {l.sourceCitation}</p>}
                  <p className="mt-0.5 text-2xs text-muted">承認者: {l.reviewedByUserId ?? '—'}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="mt-4 text-2xs text-muted">
        ※ 昇格すると `source` が PHARMACIST_VERIFIED へ変化し、before/after・出典・理由が追記専用の
        `DrugSafetyReviewLog` に記録されます（物理 UPDATE/DELETE は DB トリガで拒否）。安全データは AI 非生成・provenance 厳格。
      </p>
    </PageBody>
  );
}
