import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

/** 利用者・権限管理 — 174項 169-170。Phase 1: 利用者/RBAC 閲覧。 */
export default async function UsersPage() {
  const [users, rolePerms] = await Promise.all([
    prisma.staffUser.findMany({ orderBy: { staffNo: 'asc' }, include: { credential: true } }),
    prisma.rolePermission.findMany(),
  ]);
  const byJob = rolePerms.reduce<Record<string, number>>((m, r) => {
    m[r.jobType] = (m[r.jobType] ?? 0) + 1;
    return m;
  }, {});
  return (
    <PageBody>
      <PageHeader
        title="利用者・権限管理"
        desc="職員アカウント、職種別RBAC、患者単位ACL、二要素認証、利用者個別オーバーライド"
        crumbs={['Medixus カルテ', '管理', '利用者・権限']}
        actions={<Badge tone="blue">FE9 で編集機能</Badge>}
      />
      <Panel className="mb-4">
        <PanelHeader title="職員一覧" icon={<Icon name="users" size={16} />} />
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-soft text-2xs uppercase text-muted">
              <th className="px-2 py-1.5 text-left">職員番号</th>
              <th className="px-2 py-1.5 text-left">氏名</th>
              <th className="px-2 py-1.5 text-left">ログインID</th>
              <th className="px-2 py-1.5 text-left">職種</th>
              <th className="px-2 py-1.5 text-left">状態</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u.id} className={i % 2 ? 'bg-soft/40' : ''}>
                <td className="px-2 py-1.5 font-mono text-2xs">{u.staffNo}</td>
                <td className="px-2 py-1.5">{u.name}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{u.loginId}</td>
                <td className="px-2 py-1.5">{u.jobType}</td>
                <td className="px-2 py-1.5">
                  {u.credential?.lockedAt ? (
                    <Badge tone="red">ロック</Badge>
                  ) : u.isActive ? (
                    <Badge tone="green">有効</Badge>
                  ) : (
                    <Badge tone="gray">無効</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel>
        <PanelHeader title="職種別 権限マトリクス（RolePermission）" icon={<Icon name="audit" size={16} />} />
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(byJob).map(([j, n]) => (
            <span key={j} className="rounded border border-line bg-soft px-3 py-1.5">
              {j} <span className="font-bold">{n}</span> 権限
            </span>
          ))}
        </div>
      </Panel>
    </PageBody>
  );
}
