import { prisma, type JobType } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { getSession } from '@/lib/session';
import { createUser, setUserActive, unlockUser, resetPassword } from './actions';
import { JOB_TYPES } from './constants';

/** 利用者・権限管理 — 174項 169-170 / FR-SEC-06。利用者登録/変更/無効化・状態・最終ログイン・パスワード更新履歴。 */
export const dynamic = 'force-dynamic';

const JOB_LABEL: Record<string, string> = Object.fromEntries(
  JOB_TYPES.map((j) => [j.value, j.label]),
);

/** 画面表示用の利用者行（DB 由来 / デモ共通）。 */
type UserRow = {
  id: string;
  staffNo: string;
  loginId: string;
  name: string;
  nameKana: string;
  jobType: string;
  isActive: boolean;
  createdAt: Date | null;
  // credential
  lockedAt: Date | null;
  mustChange: boolean;
  failedAttempts: number;
  pwUpdatedAt: Date | null; // パスワード更新（validFrom / updatedAt）
  pwExpiresAt: Date | null;
  // last login
  lastLoginAt: Date | null;
  lastTerminal: string | null;
};

function fmt(d: Date | null): string {
  if (!d) return '—';
  try {
    return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}
function fmtDate(d: Date | null): string {
  if (!d) return '—';
  try {
    return d.toLocaleDateString('ja-JP');
  } catch {
    return '—';
  }
}

/* ── デモデータ（DB 未接続でも画面が出るように）─────────────────────────── */
function demoUsers(): UserRow[] {
  const base = (over: Partial<UserRow>): UserRow => ({
    id: 'demo',
    staffNo: '0000',
    loginId: 'demo',
    name: 'デモ',
    nameKana: 'デモ',
    jobType: 'DOCTOR',
    isActive: true,
    createdAt: new Date('2026-01-04T09:00:00'),
    lockedAt: null,
    mustChange: false,
    failedAttempts: 0,
    pwUpdatedAt: new Date('2026-03-01T09:00:00'),
    pwExpiresAt: new Date('2026-09-01T09:00:00'),
    lastLoginAt: new Date('2026-05-31T08:45:00'),
    lastTerminal: 'EXAM-01',
    ...over,
  });
  return [
    base({ id: 'demo-staff-1', staffNo: '1001', loginId: 'doctor', name: '研修 太郎', nameKana: 'ケンシュウ タロウ', jobType: 'DOCTOR' }),
    base({ id: 'demo-staff-2', staffNo: '1002', loginId: 'nurse', name: '看護 花子', nameKana: 'カンゴ ハナコ', jobType: 'NURSE', lastTerminal: 'WARD-3F' }),
    base({ id: 'demo-staff-3', staffNo: '1003', loginId: 'pharma', name: '薬剤 次郎', nameKana: 'ヤクザイ ジロウ', jobType: 'PHARMACIST', mustChange: true, pwExpiresAt: new Date('2026-06-05T09:00:00') }),
    base({ id: 'demo-staff-4', staffNo: '1004', loginId: 'clerk', name: '医事 三郎', nameKana: 'イジ サブロウ', jobType: 'CLERK', lastTerminal: 'RECEPTION-1' }),
    base({ id: 'demo-staff-5', staffNo: '1005', loginId: 'admin', name: '管理 四郎', nameKana: 'カンリ シロウ', jobType: 'ADMIN' }),
    base({ id: 'demo-staff-6', staffNo: '1006', loginId: 'tech', name: '技師 五郎', nameKana: 'ギシ ゴロウ', jobType: 'TECHNOLOGIST', lockedAt: new Date('2026-05-30T11:00:00'), failedAttempts: 5, lastLoginAt: new Date('2026-05-28T13:00:00') }),
    base({ id: 'demo-staff-7', staffNo: '1007', loginId: 'retired', name: '退職 六子', nameKana: 'タイショク ムツコ', jobType: 'THERAPIST', isActive: false, lastLoginAt: new Date('2026-02-10T10:00:00') }),
  ];
}

async function loadUsers(): Promise<{ rows: UserRow[]; live: boolean }> {
  try {
    const users = await prisma.staffUser.findMany({
      orderBy: { staffNo: 'asc' },
      include: {
        credential: true,
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (users.length === 0) return { rows: demoUsers(), live: false };
    const rows: UserRow[] = users.map((u) => {
      const last = u.sessions[0];
      return {
        id: u.id,
        staffNo: u.staffNo,
        loginId: u.loginId,
        name: u.name,
        nameKana: u.nameKana,
        jobType: u.jobType,
        isActive: u.isActive,
        createdAt: u.createdAt ?? null,
        lockedAt: u.credential?.lockedAt ?? null,
        mustChange: u.credential?.mustChange ?? false,
        failedAttempts: u.credential?.failedAttempts ?? 0,
        pwUpdatedAt: u.credential?.validFrom ?? u.credential?.updatedAt ?? null,
        pwExpiresAt: u.credential?.expiresAt ?? null,
        lastLoginAt: last?.createdAt ?? null,
        lastTerminal: last?.terminalId ?? null,
      };
    });
    return { rows, live: true };
  } catch (err) {
    console.error('[admin/users] loadUsers failed; showing demo data:', err);
    return { rows: demoUsers(), live: false };
  }
}

/** 状態バッジ（無効/ロック/要変更/有効）。 */
function StatusBadge({ u }: { u: UserRow }) {
  if (!u.isActive) return <Badge tone="gray">無効</Badge>;
  if (u.lockedAt) return <Badge tone="red">ロック</Badge>;
  if (u.mustChange) return <Badge tone="amber">要PW変更</Badge>;
  return <Badge tone="green">有効</Badge>;
}

export default async function UsersPage() {
  // セッション取得はフェイルソフト（DB 到達不可時 null）。
  await getSession();
  const { rows: users, live } = await loadUsers();

  // 職種別の人数集計（権限マトリクスの目安）。
  const byJob = users.reduce<Record<string, number>>((m, u) => {
    m[u.jobType] = (m[u.jobType] ?? 0) + 1;
    return m;
  }, {});
  const activeCount = users.filter((u) => u.isActive).length;
  const lockedCount = users.filter((u) => u.lockedAt && u.isActive).length;

  return (
    <PageBody>
      <PageHeader
        title="利用者・権限管理"
        desc="利用者の登録 / 変更 / 無効化・職種（JobType）・状態・最終ログイン・パスワード更新履歴（FR-SEC-06 / 174:169）"
        crumbs={['Medixus カルテ', '管理', '利用者・権限']}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone="green">{activeCount} 有効</Badge>
            {lockedCount > 0 && <Badge tone="red">{lockedCount} ロック</Badge>}
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* ── 利用者登録（全ロール対応）── AC(1) ── */}
        <Panel>
          <PanelHeader title="利用者を登録" icon={<Icon name="plus" size={15} />} />
          <form action={createUser} className="flex flex-col gap-2.5">
            <Field label="職員番号" required>
              <Input name="staffNo" placeholder="例：1008" autoComplete="off" />
            </Field>
            <Field label="ログインID" required>
              <Input name="loginId" placeholder="例：tanaka" autoComplete="off" />
            </Field>
            <Field label="氏名" required>
              <Input name="name" placeholder="例：田中 一郎" autoComplete="off" />
            </Field>
            <Field label="氏名（カナ）">
              <Input name="nameKana" placeholder="例：タナカ イチロウ" autoComplete="off" />
            </Field>
            <Field label="職種（JobType）" required>
              <Select name="jobType" defaultValue="NURSE">
                {JOB_TYPES.map((j) => (
                  <option key={j.value} value={j.value}>
                    {j.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="rounded border border-line bg-soft px-2 py-1.5 text-2xs leading-relaxed text-muted">
              <Icon name="lock" size={12} className="mr-1 inline align-text-bottom" />
              初期パスワードは本人の初回ログイン時に設定します（次回変更を強制）。
              登録・無効化・初期化はすべて監査ログに記録されます。
            </p>
            <Button type="submit" variant="primary">
              <Icon name="plus" size={14} />
              利用者を登録
            </Button>
          </form>
        </Panel>

        {/* ── 職員一覧（状態・操作）── */}
        <Panel>
          <PanelHeader
            title="職員一覧"
            icon={<Icon name="users" size={16} />}
            actions={<Badge tone="gray">{users.length} 名</Badge>}
          />
          {users.length === 0 ? (
            <EmptyState
              title="利用者がいません"
              hint="左のフォームから利用者を登録してください"
              icon={<Icon name="users" size={28} />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft text-2xs uppercase text-muted">
                    <th className="px-2 py-1.5 text-left">職員番号</th>
                    <th className="px-2 py-1.5 text-left">氏名</th>
                    <th className="px-2 py-1.5 text-left">ログインID</th>
                    <th className="px-2 py-1.5 text-left">職種</th>
                    <th className="px-2 py-1.5 text-left">状態</th>
                    <th className="px-2 py-1.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={u.id} className={i % 2 ? 'bg-soft/40' : ''}>
                      <td className="px-2 py-1.5 font-mono text-2xs">{u.staffNo}</td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-ink">{u.name}</div>
                        <div className="text-2xs text-muted">{u.nameKana}</div>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{u.loginId}</td>
                      <td className="px-2 py-1.5 text-xs">{JOB_LABEL[u.jobType] ?? u.jobType}</td>
                      <td className="px-2 py-1.5">
                        <StatusBadge u={u} />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          {/* 有効/無効トグル */}
                          <form action={setUserActive} className="inline">
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="active" value={u.isActive ? 'false' : 'true'} />
                            <Button
                              size="sm"
                              variant={u.isActive ? 'ghost' : 'secondary'}
                              type="submit"
                              title={u.isActive ? '無効化（アカウント停止）' : '再有効化'}
                            >
                              <Icon name={u.isActive ? 'logout' : 'check'} size={13} />
                              {u.isActive ? '無効化' : '有効化'}
                            </Button>
                          </form>
                          {/* ロック解除（ロック中のみ） */}
                          {u.lockedAt && (
                            <form action={unlockUser} className="inline">
                              <input type="hidden" name="id" value={u.id} />
                              <Button size="sm" variant="secondary" type="submit" title="ロックを解除（失敗回数リセット）">
                                <Icon name="lock" size={13} />
                                解除
                              </Button>
                            </form>
                          )}
                          {/* パスワード初期化 */}
                          <form action={resetPassword} className="inline">
                            <input type="hidden" name="id" value={u.id} />
                            <Button size="sm" variant="ghost" type="submit" title="パスワードを初期化（次回変更を強制）">
                              <Icon name="refresh" size={13} />
                              PW初期化
                            </Button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ── ログイン / パスワード更新履歴 ── AC(2) ── */}
      <Panel className="mt-4">
        <PanelHeader
          title="ログイン・パスワード更新履歴"
          icon={<Icon name="clock" size={15} />}
          actions={<Badge tone="blue">監査連携</Badge>}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-soft text-2xs uppercase text-muted">
                <th className="px-2 py-1.5 text-left">氏名</th>
                <th className="px-2 py-1.5 text-left">職種</th>
                <th className="px-2 py-1.5 text-left">最終ログイン</th>
                <th className="px-2 py-1.5 text-left">端末</th>
                <th className="px-2 py-1.5 text-left">PW更新</th>
                <th className="px-2 py-1.5 text-left">PW有効期限</th>
                <th className="px-2 py-1.5 text-left">失敗回数</th>
                <th className="px-2 py-1.5 text-left">登録日</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id} className={i % 2 ? 'bg-soft/40' : ''}>
                  <td className="px-2 py-1.5">{u.name}</td>
                  <td className="px-2 py-1.5 text-xs">{JOB_LABEL[u.jobType] ?? u.jobType}</td>
                  <td className="px-2 py-1.5 text-2xs">{fmt(u.lastLoginAt)}</td>
                  <td className="px-2 py-1.5 font-mono text-2xs text-muted">{u.lastTerminal ?? '—'}</td>
                  <td className="px-2 py-1.5 text-2xs">
                    {fmtDate(u.pwUpdatedAt)}
                    {u.mustChange && <Badge tone="amber" className="ml-1">要変更</Badge>}
                  </td>
                  <td className="px-2 py-1.5 text-2xs">{fmtDate(u.pwExpiresAt)}</td>
                  <td className="px-2 py-1.5 text-xs">
                    {u.failedAttempts > 0 ? (
                      <span className="font-semibold text-alert">{u.failedAttempts}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-2xs text-muted">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-2xs text-muted">
          ※ 最終ログインは `AuthSession`、パスワード更新は `StaffCredential`（validFrom / expiresAt / mustChange）由来。
          全操作の詳細履歴は <span className="font-mono">/audit</span>（ハッシュ連鎖・改竄検知）で確認できます。
        </p>
      </Panel>

      {/* ── 職種別 権限マトリクス（人数の目安）── */}
      <Panel className="mt-4">
        <PanelHeader title="職種別 内訳（RBAC マトリクスの対象）" icon={<Icon name="audit" size={16} />} />
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(byJob).map(([j, n]) => (
            <span key={j} className="rounded border border-line bg-soft px-3 py-1.5">
              {JOB_LABEL[j] ?? j} <span className="font-bold">{n}</span> 名
            </span>
          ))}
        </div>
        <p className="mt-2 text-2xs text-muted">
          職種別権限マトリクス（RolePermission）＋利用者個別オーバーライド（UserPermission）＋患者単位ACL は
          システム設定／各画面で適用されます（FR-SEC-03）。
        </p>
      </Panel>
    </PageBody>
  );
}
