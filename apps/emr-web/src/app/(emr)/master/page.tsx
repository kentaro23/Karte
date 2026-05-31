import { prisma, isDemoMode } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, Button } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  runFullDrugImport,
  runExamImport,
  runDiseaseImport,
  rollbackImport,
} from './actions';

/**
 * マスタ管理 — 174項 161-165（医事/医薬品/検査/特定器材）。
 * WP-MST1: 医薬品全量取込・検査JLAC取込・病名取込／版・チェックサム記録／ロールバック。
 *
 * 安全データ（禁忌/相互/極量/適応）は本画面の取込経路では一切扱わない（provenance 強制・AI非生成）。
 * Prisma を読むため明示的に動的化。DB 未接続でもデモ（件数0・取込ボタンは curated 取込）で描画。
 */
export const dynamic = 'force-dynamic';

type DrugRow = {
  id: string;
  receiptCode: string;
  brandName: string;
  ingredients: string;
  dosageForm: string;
  nhiPrice: number | null;
};
type ExamRow = { id: string; code: string; name: string; jlac10: string | null; ref: string; unit: string | null };
type DiseaseRow = { id: string; code: string; name: string; icd10: string };
type VersionRow = {
  id: string;
  masterType: string;
  source: string;
  sourceRelease: string;
  validFrom: Date;
  validTo: Date | null;
  checksum: string | null;
};
type RunRow = {
  id: string;
  source: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  checksum: string | null;
  imported: number | null;
  priceUpdated: number | null;
  isDrug: boolean;
  isExam: boolean;
};

type LoadResult = {
  counts: { drug: number; ingredient: number; safety: number; exam: number; disease: number };
  drugs: DrugRow[];
  exams: ExamRow[];
  diseases: DiseaseRow[];
  versions: VersionRow[];
  runs: RunRow[];
  dbDown: boolean;
};

const EMPTY: LoadResult = {
  counts: { drug: 0, ingredient: 0, safety: 0, exam: 0, disease: 0 },
  drugs: [],
  exams: [],
  diseases: [],
  versions: [],
  runs: [],
  dbDown: true,
};

/** 取込元種別の判定（ロールバック時の kind 振分け）。 */
function runKind(source: string): { isDrug: boolean; isExam: boolean } {
  return { isDrug: source.startsWith('FULL_DRUG') || source.startsWith('MHLW_RECEIPT'), isExam: source.startsWith('EXAM') };
}

/** 全データを fail-soft 取得。DB 未接続なら dbDown=true で空集合（画面は出る）。 */
async function load(): Promise<LoadResult> {
  try {
    const [drugCount, ingCount, safety, examCount, diseaseCount] = await Promise.all([
      prisma.drugProduct.count(),
      prisma.drugIngredient.count(),
      prisma.drugContraindication.count(),
      prisma.examMaster.count(),
      prisma.diseaseMaster.count(),
    ]);
    const [drugs, exams, diseases, versions, runs] = await Promise.all([
      prisma.drugProduct.findMany({
        take: 20,
        orderBy: { brandName: 'asc' },
        include: { ingredients: { include: { ingredient: true } } },
      }),
      prisma.examMaster.findMany({ take: 20, orderBy: { code: 'asc' } }),
      prisma.diseaseMaster.findMany({ take: 20, orderBy: { code: 'asc' } }),
      prisma.masterVersion.findMany({ orderBy: { importedAt: 'desc' }, take: 12 }),
      prisma.importRun.findMany({ orderBy: { startedAt: 'desc' }, take: 12 }),
    ]);
    return {
      counts: { drug: drugCount, ingredient: ingCount, safety, exam: examCount, disease: diseaseCount },
      drugs: drugs.map((d) => ({
        id: d.id,
        receiptCode: d.receiptCode,
        brandName: d.brandName,
        ingredients: d.ingredients.map((x) => x.ingredient.ingredientName).join('・'),
        dosageForm: d.dosageForm,
        nhiPrice: d.nhiPrice,
      })),
      exams: exams.map((e) => ({
        id: e.id,
        code: e.code,
        name: e.name,
        jlac10: e.jlac10,
        ref: e.refLow != null || e.refHigh != null ? `${e.refLow ?? ''}〜${e.refHigh ?? ''}` : '—',
        unit: e.unit,
      })),
      diseases: diseases.map((d) => ({ id: d.id, code: d.code, name: d.name, icd10: d.icd10.join(', ') })),
      versions: versions.map((v) => ({
        id: v.id,
        masterType: v.masterType,
        source: v.source,
        sourceRelease: v.sourceRelease,
        validFrom: v.validFrom,
        validTo: v.validTo,
        checksum: v.checksum,
      })),
      runs: runs.map((r) => {
        const c = (r.counts as { imported?: number; priceUpdated?: number } | null) ?? null;
        const k = runKind(r.source);
        return {
          id: r.id,
          source: r.source,
          status: r.status,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          checksum: r.checksum,
          imported: c?.imported ?? null,
          priceUpdated: c?.priceUpdated ?? null,
          ...k,
        };
      }),
      dbDown: false,
    };
  } catch (err) {
    console.error('[MasterPage] load failed, demo fallback:', err);
    return EMPTY;
  }
}

const statusTone: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  SUCCESS: 'green',
  RUNNING: 'amber',
  FAILED: 'red',
  ROLLED_BACK: 'gray',
};

function fmt(d: Date | null): string {
  return d ? d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}
function short(cs: string | null): string {
  return cs ? `${cs.slice(0, 12)}…` : '—';
}

export default async function MasterPage() {
  const data = await load();
  const demo = isDemoMode || data.dbDown;

  // ── サーバアクション束縛（progressive enhancement・戻り値は破棄して void 化）──
  async function importDrugFull(formData: FormData) {
    'use server';
    await runFullDrugImport(formData);
  }
  async function importDrugRevision(formData: FormData) {
    'use server';
    formData.set('revisionOnly', 'on');
    await runFullDrugImport(formData);
  }
  async function importExam(formData: FormData) {
    'use server';
    await runExamImport(formData);
  }
  async function importDisease(formData: FormData) {
    'use server';
    await runDiseaseImport(formData);
  }
  async function doRollback(formData: FormData) {
    'use server';
    await rollbackImport(formData);
  }

  return (
    <PageBody>
      <PageHeader
        title="マスタ管理"
        desc="医薬品・検査・病名・医事・特定器材マスタの全量取込／版・チェックサム記録／ロールバック（174:161-165）。安全データは公的出典のみ（AI非生成・provenance強制）"
        crumbs={['Medixus カルテ', '管理', 'マスタ管理']}
        actions={<Badge tone="blue">WP-MST1</Badge>}
      />

      {demo && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB未接続）：件数は0ですが、取込ボタンは curated サンプルで取込フロー（版・チェックサム記録）を実演します。
        </div>
      )}

      {/* 件数サマリ */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['医薬品', data.counts.drug],
          ['成分', data.counts.ingredient],
          ['禁忌データ', data.counts.safety],
          ['検査', data.counts.exam],
          ['病名', data.counts.disease],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-card border border-line bg-white px-4 py-3 shadow-panel">
            <div className="text-2xs uppercase text-muted">{l}</div>
            <div className="text-2xl font-bold text-ink">{v as number}</div>
          </div>
        ))}
      </div>

      {/* 取込コンソール（医薬品全量／点数改定追従／検査／病名） */}
      <Panel className="mb-4">
        <PanelHeader
          title="マスタ取込コンソール"
          desc="サーバ上の絶対パスを指定（未指定時は curated サンプルで取込）。取込ごとに MasterVersion と ImportRun に版・チェックサムを記録"
          icon={<Icon name="master" size={16} />}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* 医薬品 全量取込 */}
          <form action={importDrugFull} className="rounded border border-line bg-soft/40 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <Icon name="rx" size={14} />
              <span className="text-xs font-bold text-ink">医薬品マスタ 全量取込（レセ電 ~2万品目）</span>
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input name="filePath" placeholder="/path/to/y_ALL.csv（任意）" className="rounded border border-line px-2 py-1 text-xs" />
              <input name="sourceRelease" placeholder="例 2026-04" className="rounded border border-line px-2 py-1 text-xs" />
            </div>
            <div className="mt-2">
              <Button type="submit" size="sm" variant="primary">
                <Icon name="plus" size={12} /> 全量取込を実行
              </Button>
            </div>
            <p className="mt-1 text-2xs text-muted/70">code/名称/剤形/薬価のみ。安全データは投入されません（provenance）。</p>
          </form>

          {/* 医薬品 点数改定追従 */}
          <form action={importDrugRevision} className="rounded border border-line bg-soft/40 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <Icon name="billing" size={14} />
              <span className="text-xs font-bold text-ink">点数改定追従（薬価のみ差分更新）</span>
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input name="filePath" placeholder="/path/to/y_DELTA.csv（任意）" className="rounded border border-line px-2 py-1 text-xs" />
              <input name="sourceRelease" placeholder="例 2026-10" className="rounded border border-line px-2 py-1 text-xs" />
            </div>
            <div className="mt-2">
              <Button type="submit" size="sm" variant="secondary">
                <Icon name="refresh" size={12} /> 改定差分を反映
              </Button>
            </div>
            <p className="mt-1 text-2xs text-muted/70">既存品目の nhiPrice/改定日のみ更新（新規 upsert なし）。</p>
          </form>

          {/* 検査 JLAC 取込 */}
          <form action={importExam} className="rounded border border-line bg-soft/40 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <Icon name="lab" size={14} />
              <span className="text-xs font-bold text-ink">臨床検査マスタ取込（JLAC10/11・HS014）</span>
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input name="filePath" placeholder="/path/to/jlac.csv（任意）" className="rounded border border-line px-2 py-1 text-xs" />
              <input name="sourceRelease" placeholder="例 2026-04" className="rounded border border-line px-2 py-1 text-xs" />
            </div>
            <div className="mt-2">
              <Button type="submit" size="sm" variant="secondary">
                <Icon name="plus" size={12} /> 検査マスタを取込
              </Button>
            </div>
            <p className="mt-1 text-2xs text-muted/70">code/名称/JLAC10/基準値/単位。検査結果の基準値判定に連動。</p>
          </form>

          {/* 病名 取込 */}
          <form action={importDisease} className="rounded border border-line bg-soft/40 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <Icon name="edit" size={14} />
              <span className="text-xs font-bold text-ink">病名マスタ取込（MEDIS ICD-10対応・HS005）</span>
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input name="filePath" placeholder="/path/to/MEDIS_s.zip|.csv" className="rounded border border-line px-2 py-1 text-xs" />
              <input name="sourceRelease" placeholder="例 2026-05" className="rounded border border-line px-2 py-1 text-xs" />
            </div>
            <div className="mt-2">
              <Button type="submit" size="sm" variant="secondary">
                <Icon name="plus" size={12} /> 病名マスタを取込
              </Button>
            </div>
            <p className="mt-1 text-2xs text-muted/70">ファイル未指定時は取込されません（標準病名 ZIP/CSV を指定）。</p>
          </form>
        </div>
      </Panel>

      {/* マスタ版（MasterVersion）— 版・チェックサム・有効期間 */}
      <Panel className="mb-4">
        <PanelHeader
          title="マスタ版（MasterVersion）"
          desc="取込ごとに発行。validTo=null が現行版。旧版は版改定/ロールバックで失効"
          icon={<Icon name="master" size={16} />}
        />
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-soft text-2xs uppercase text-muted">
              <th className="px-2 py-1.5 text-left">種別</th>
              <th className="px-2 py-1.5 text-left">出典</th>
              <th className="px-2 py-1.5 text-left">リリース</th>
              <th className="px-2 py-1.5 text-left">有効期間</th>
              <th className="px-2 py-1.5 text-left">チェックサム</th>
              <th className="px-2 py-1.5 text-center">状態</th>
            </tr>
          </thead>
          <tbody>
            {data.versions.map((v, i) => (
              <tr key={v.id} className={i % 2 ? 'bg-soft/40' : ''}>
                <td className="px-2 py-1.5"><Badge tone="teal">{v.masterType}</Badge></td>
                <td className="px-2 py-1.5 font-mono text-2xs">{v.source}</td>
                <td className="px-2 py-1.5 text-xs">{v.sourceRelease}</td>
                <td className="px-2 py-1.5 text-2xs text-muted">
                  {fmt(v.validFrom)} 〜 {v.validTo ? fmt(v.validTo) : '現行'}
                </td>
                <td className="px-2 py-1.5 font-mono text-2xs text-muted" title={v.checksum ?? ''}>{short(v.checksum)}</td>
                <td className="px-2 py-1.5 text-center">
                  {v.validTo ? <Badge tone="gray">失効</Badge> : <Badge tone="green">現行</Badge>}
                </td>
              </tr>
            ))}
            {data.versions.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-3 text-center text-2xs text-muted">マスタ版なし（取込を実行すると記録されます）</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      {/* 取込履歴（ImportRun）＋ ロールバック */}
      <Panel className="mb-4">
        <PanelHeader
          title="取込履歴（ImportRun）"
          desc="取込実行のライフサイクル。SUCCESS の取込はロールバックで版を失効できる（追記専用のため取込済データは物理削除しない）"
          icon={<Icon name="audit" size={16} />}
        />
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-soft text-2xs uppercase text-muted">
              <th className="px-2 py-1.5 text-left">取込元</th>
              <th className="px-2 py-1.5 text-center">状態</th>
              <th className="px-2 py-1.5 text-right">件数</th>
              <th className="px-2 py-1.5 text-left">開始</th>
              <th className="px-2 py-1.5 text-left">チェックサム</th>
              <th className="px-2 py-1.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-2 py-1.5 font-mono text-2xs">{r.source}</td>
                <td className="px-2 py-1.5 text-center">
                  <Badge tone={statusTone[r.status] ?? 'gray'}>{r.status}</Badge>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-xs">
                  {r.imported != null ? r.imported : '—'}
                  {r.priceUpdated ? <span className="ml-1 text-2xs text-info">改定{r.priceUpdated}</span> : null}
                </td>
                <td className="px-2 py-1.5 text-2xs text-muted">{fmt(r.startedAt)}</td>
                <td className="px-2 py-1.5 font-mono text-2xs text-muted" title={r.checksum ?? ''}>{short(r.checksum)}</td>
                <td className="px-2 py-1.5 text-right">
                  {r.status === 'SUCCESS' && (r.isDrug || r.isExam) ? (
                    <form action={doRollback} className="inline">
                      <input type="hidden" name="runId" value={r.id} />
                      <input type="hidden" name="kind" value={r.isExam ? 'exam' : 'drug'} />
                      <Button type="submit" size="sm" variant="danger">
                        <Icon name="refresh" size={11} /> ロールバック
                      </Button>
                    </form>
                  ) : r.status === 'ROLLED_BACK' ? (
                    <span className="text-2xs text-muted">失効済</span>
                  ) : (
                    <span className="text-2xs text-muted/60">—</span>
                  )}
                </td>
              </tr>
            ))}
            {data.runs.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-3 text-center text-2xs text-muted">取込履歴なし</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      {/* マスタ閲覧（医薬品・検査・病名） */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="医薬品マスタ（抜粋）" icon={<Icon name="rx" size={15} />} />
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr className="bg-soft uppercase text-muted">
                <th className="px-1.5 py-1 text-left">コード</th>
                <th className="px-1.5 py-1 text-left">販売名</th>
                <th className="px-1.5 py-1 text-right">薬価</th>
              </tr>
            </thead>
            <tbody>
              {data.drugs.map((d, i) => (
                <tr key={d.id} className={i % 2 ? 'bg-soft/40' : ''} title={d.ingredients}>
                  <td className="px-1.5 py-1 font-mono">{d.receiptCode}</td>
                  <td className="px-1.5 py-1">{d.brandName}</td>
                  <td className="px-1.5 py-1 text-right">{d.nhiPrice ?? '—'}</td>
                </tr>
              ))}
              {data.drugs.length === 0 && (
                <tr><td colSpan={3} className="px-1.5 py-2 text-center text-muted">未取込</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <PanelHeader title="検査マスタ（JLAC）" icon={<Icon name="lab" size={15} />} />
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr className="bg-soft uppercase text-muted">
                <th className="px-1.5 py-1 text-left">コード</th>
                <th className="px-1.5 py-1 text-left">検査名</th>
                <th className="px-1.5 py-1 text-left">基準値</th>
              </tr>
            </thead>
            <tbody>
              {data.exams.map((e, i) => (
                <tr key={e.id} className={i % 2 ? 'bg-soft/40' : ''} title={e.jlac10 ? `JLAC10: ${e.jlac10}` : ''}>
                  <td className="px-1.5 py-1 font-mono">{e.code}</td>
                  <td className="px-1.5 py-1">{e.name}</td>
                  <td className="px-1.5 py-1">{e.ref}{e.unit ? ` ${e.unit}` : ''}</td>
                </tr>
              ))}
              {data.exams.length === 0 && (
                <tr><td colSpan={3} className="px-1.5 py-2 text-center text-muted">未取込</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <PanelHeader title="病名マスタ（ICD-10）" icon={<Icon name="edit" size={15} />} />
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr className="bg-soft uppercase text-muted">
                <th className="px-1.5 py-1 text-left">コード</th>
                <th className="px-1.5 py-1 text-left">病名</th>
                <th className="px-1.5 py-1 text-left">ICD-10</th>
              </tr>
            </thead>
            <tbody>
              {data.diseases.map((d, i) => (
                <tr key={d.id} className={i % 2 ? 'bg-soft/40' : ''}>
                  <td className="px-1.5 py-1 font-mono">{d.code}</td>
                  <td className="px-1.5 py-1">{d.name}</td>
                  <td className="px-1.5 py-1 font-mono text-muted">{d.icd10 || '—'}</td>
                </tr>
              ))}
              {data.diseases.length === 0 && (
                <tr><td colSpan={3} className="px-1.5 py-2 text-center text-muted">未取込</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>
    </PageBody>
  );
}
