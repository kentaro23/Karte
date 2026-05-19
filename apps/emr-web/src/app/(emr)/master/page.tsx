import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

/** マスタ管理 — 174項 161-165。Phase 1: 医薬品マスタ（provenance付き）閲覧。 */
export default async function MasterPage() {
  const [drugCount, ingCount, safety, exam, imports] = await Promise.all([
    prisma.drugProduct.count(),
    prisma.drugIngredient.count(),
    prisma.drugContraindication.count(),
    prisma.examMaster.count(),
    prisma.importRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }),
  ]);
  const drugs = await prisma.drugProduct.findMany({
    take: 30,
    orderBy: { brandName: 'asc' },
    include: { ingredients: { include: { ingredient: true } } },
  });
  return (
    <PageBody>
      <PageHeader
        title="マスタ管理"
        desc="医薬品・検査・医事・特定器材マスタ。安全データは公的出典のみ（AI非生成・provenance強制）"
        crumbs={['Medixus カルテ', '管理', 'マスタ管理']}
        actions={<Badge tone="blue">FE9 で全機能</Badge>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['医薬品', drugCount],
          ['成分', ingCount],
          ['禁忌データ', safety],
          ['検査', exam],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-card border border-line bg-white px-4 py-3 shadow-panel">
            <div className="text-2xs uppercase text-muted">{l}</div>
            <div className="text-2xl font-bold text-ink">{v as number}</div>
          </div>
        ))}
      </div>
      <Panel className="mb-4">
        <PanelHeader title="医薬品マスタ（抜粋）" icon={<Icon name="rx" size={16} />} />
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-soft text-2xs uppercase text-muted">
              <th className="px-2 py-1.5 text-left">レセ電コード</th>
              <th className="px-2 py-1.5 text-left">販売名</th>
              <th className="px-2 py-1.5 text-left">一般名/成分</th>
              <th className="px-2 py-1.5 text-left">剤形</th>
              <th className="px-2 py-1.5 text-right">薬価</th>
            </tr>
          </thead>
          <tbody>
            {drugs.map((d, i) => (
              <tr key={d.id} className={i % 2 ? 'bg-soft/40' : ''}>
                <td className="px-2 py-1.5 font-mono text-2xs">{d.receiptCode}</td>
                <td className="px-2 py-1.5">{d.brandName}</td>
                <td className="px-2 py-1.5 text-xs text-muted">
                  {d.ingredients.map((x) => x.ingredient.ingredientName).join('・')}
                </td>
                <td className="px-2 py-1.5 text-xs">{d.dosageForm}</td>
                <td className="px-2 py-1.5 text-right">{d.nhiPrice ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel>
        <PanelHeader title="取込履歴（ImportRun）" icon={<Icon name="master" size={16} />} />
        <ul className="text-xs">
          {imports.map((r) => (
            <li key={r.id} className="flex gap-3 border-b border-line py-1.5 last:border-0">
              <span className="font-mono">{r.source}</span>
              <Badge tone={r.status === 'SUCCESS' ? 'green' : 'amber'}>{r.status}</Badge>
              <span className="text-muted">{r.startedAt.toLocaleString('ja-JP')}</span>
            </li>
          ))}
          {imports.length === 0 && <li className="py-2 text-muted">取込履歴なし</li>}
        </ul>
      </Panel>
    </PageBody>
  );
}
