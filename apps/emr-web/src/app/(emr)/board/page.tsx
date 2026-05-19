import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

/** 院内掲示板 — 別紙3 #62-64（初期画面に院内連絡事項、HTML定義画面）。 */
export default async function BoardPage() {
  const stickies = await prisma.sticky.findMany({
    where: { scope: 'CLINIC_WIDE' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const notices = [
    { tag: '運用', tone: 'blue' as const, title: '電子カルテ運用ルール', body: '記載は確定後ロック。修正は「改版」（旧版保持・追記）で行ってください。' },
    { tag: '安全', tone: 'red' as const, title: '処方安全チェック必須', body: '禁忌・相互作用・重複・極量・アレルギーのブロックは理由入力で解除（全件監査記録）。' },
    { tag: '感染', tone: 'amber' as const, title: '標準予防策の徹底', body: '感染症フラグのある患者はカルテ患者バーに常時表示されます。' },
  ];
  return (
    <PageBody>
      <PageHeader
        title="院内掲示板"
        desc="院内連絡事項・運用ルール・安全情報"
        crumbs={['Medixus カルテ', '院内掲示板']}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="お知らせ" icon={<Icon name="board" size={16} />} />
          <ul className="flex flex-col gap-3">
            {notices.map((n) => (
              <li key={n.title} className="rounded border border-line bg-soft/60 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={n.tone}>{n.tag}</Badge>
                  <span className="text-sm font-bold text-ink">{n.title}</span>
                </div>
                <p className="text-xs text-muted">{n.body}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="院内共有付箋" icon={<Icon name="sticky" size={16} />} />
          {stickies.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted">院内共有の付箋はありません</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stickies.map((s) => (
                <li key={s.id} className="rounded border-l-4 border-amber-400 bg-amber-50/60 p-2.5">
                  <div className="text-sm font-semibold text-ink">{s.title}</div>
                  <div className="text-xs text-muted">{s.body}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageBody>
  );
}
