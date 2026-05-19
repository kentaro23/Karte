import { prisma } from '@medixus/db';
import { verifyAuditChain } from '@medixus/audit';
import { Badge, Panel, PanelHeader, Icon, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

const ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: 'ログイン成功',
  LOGIN_FAILURE: 'ログイン失敗',
  LOGOUT: 'ログアウト',
  USER_SWITCH: '利用者変更',
  SCREENSAVER_UNLOCK: 'SS解除',
  PATIENT_SELECT: '患者選択',
  CHART_OPEN: 'カルテ参照',
  CHART_WRITE: 'カルテ記載',
  CHART_AMEND: 'カルテ改版',
  ORDER_ISSUE: 'オーダ発行',
  ORDER_CHECK: '処方安全チェック',
  PRESCRIPTION_OVERRIDE: 'チェック解除(override)',
  COUNTERSIGN: 'カウンターサイン',
  PRINT: '印刷',
  FILE_EXPORT: 'ファイル出力',
  RESTRICTED_ACCESS: '制限患者アクセス',
  MASTER_IMPORT: 'マスタ取込',
  PATIENT_MERGE: '患者ID統合',
};
const TONE: Record<string, 'gray' | 'blue' | 'amber' | 'red' | 'green'> = {
  LOGIN_FAILURE: 'red',
  PRESCRIPTION_OVERRIDE: 'amber',
  CHART_AMEND: 'amber',
  RESTRICTED_ACCESS: 'red',
  ORDER_ISSUE: 'blue',
  CHART_WRITE: 'green',
};

export default async function AuditPage() {
  const [events, chain, total] = await Promise.all([
    prisma.auditEvent.findMany({ orderBy: { seq: 'desc' }, take: 150 }),
    verifyAuditChain(),
    prisma.auditEvent.count(),
  ]);
  return (
    <PageBody>
      <PageHeader
        title="監査ログ"
        desc="全操作の追跡（ログイン・患者選択・カルテ記載/改版・オーダ・解除・印刷）。別紙3 #25-30"
        crumbs={['Medixus カルテ', '管理', '監査ログ']}
        actions={
          chain.ok ? (
            <Badge tone="green">
              <Icon name="check" size={12} /> ハッシュチェーン整合 OK
            </Badge>
          ) : (
            <Badge tone="red">不整合 (seq {String(chain.brokenAtSeq)})</Badge>
          )
        }
      />
      <Panel className="mb-4" pad={false}>
        <div className="flex items-center gap-4 px-4 py-2.5 text-xs">
          <Icon name="audit" size={16} className="text-accent-600" />
          <span>
            総レコード <strong>{total}</strong> 件
          </span>
          <span className="text-muted">
            監査ログは追記専用・UPDATE/DELETE はDBトリガで物理拒否（真正性）。各行は sha256 で前行に連鎖。
          </span>
        </div>
      </Panel>
      <Panel pad={false}>
        {events.length === 0 ? (
          <EmptyState title="監査ログがありません" />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0">
              <tr className="bg-soft text-2xs uppercase text-muted">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">日時</th>
                <th className="px-3 py-2 text-left">操作</th>
                <th className="px-3 py-2 text-left">資源</th>
                <th className="px-3 py-2 text-left">利用者</th>
                <th className="px-3 py-2 text-left">患者</th>
                <th className="px-3 py-2 text-left">結果</th>
                <th className="px-3 py-2 text-left">rowHash</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-3 py-1.5 tabular-nums">{String(e.seq)}</td>
                  <td className="px-3 py-1.5">{e.createdAt.toLocaleString('ja-JP')}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={TONE[e.action] ?? 'gray'}>
                      {ACTION_LABEL[e.action] ?? e.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-muted">
                    {e.resource ?? '—'}
                    {e.resourceId ? `:${e.resourceId.slice(0, 8)}` : ''}
                  </td>
                  <td className="px-3 py-1.5 font-mono">{e.actorUserId?.slice(0, 8) ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono">{e.patientId?.slice(0, 8) ?? '—'}</td>
                  <td className="px-3 py-1.5">{e.result}</td>
                  <td className="px-3 py-1.5 font-mono text-muted">
                    {e.rowHash?.slice(0, 12) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </PageBody>
  );
}
