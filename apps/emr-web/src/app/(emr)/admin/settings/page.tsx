import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Select, Input, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { getSession } from '@/lib/session';
import { createSuppression, deleteSuppression } from './actions';
import { NON_SUPPRESSIBLE_CHECK_TYPES } from './constants';

const GROUPS: { title: string; icon: 'lock' | 'users' | 'audit' | 'settings'; rows: [string, string, 'green' | 'blue' | 'amber'][] }[] = [
  {
    title: '認証・スクリーンセーバー',
    icon: 'lock',
    rows: [
      ['パスワード方式', 'scrypt（本番: Argon2id）・ハッシュ保存・平文不可', 'green'],
      ['パスワード複雑性', '10文字以上・英大小・数字・記号', 'green'],
      ['リトライロック', '5回失敗で自動終了・アカウントロック', 'green'],
      ['二要素認証', 'TOTP（RFC6238）実装済', 'blue'],
      ['スクリーンセーバー', 'アイドル300秒で自動ロック→正式手順のみ解除', 'green'],
      ['前回ログイン確認', 'ログイン後に日時・端末を提示', 'green'],
    ],
  },
  {
    title: '権限・排他制御',
    icon: 'users',
    rows: [
      ['RBAC', '職種別マトリクス＋利用者個別オーバーライド', 'green'],
      ['患者単位ACL', '不可/参照のみ/参照+更新・VIPブレークグラス', 'green'],
      ['排他制御', 'カルテ単位ロック・他端末使用中検出（参照は許可）', 'green'],
      ['利用者変更', 'ログオフせず切替・記載責任は切替後', 'green'],
    ],
  },
  {
    title: '記録の真正性（電子保存の三原則）',
    icon: 'audit',
    rows: [
      ['追記専用', '診療録/オーダ/安全データ/監査の物理UPDATE/DELETEをDBトリガで拒否', 'green'],
      ['版数管理', '改版＝旧版SUPERSEDED＋新版INSERT・旧版消し線表示', 'green'],
      ['監査ハッシュチェーン', 'sha256で前行連鎖・改竄検知', 'green'],
      ['薬剤安全データ', 'provenance強制・AIソース不在（DB enumで物理担保）', 'green'],
    ],
  },
];

/* ── 警告管理（無効化制御）— FR-RXSAFE-05 ─────────────────────────────────── */

type SuppressionRow = {
  id: string;
  scope: string;
  targetKey: string;
  checkType: string | null;
  minLevel: string | null;
  showIn: string;
  createdByUserId: string | null;
  createdAt: Date | null;
};

const SCOPE_LABEL: Record<string, string> = {
  PROCEDURE: '処置行為',
  DRUG: '医薬品',
  DRUG_CLASS: '医薬品種類',
  CHECK_TYPE: 'チェック種類',
};
const CHECK_TYPE_LABEL: Record<string, string> = {
  CONTRAINDICATION: '禁忌',
  INTERACTION: '相互作用',
  DOSE_MAX: '極量',
  DUPLICATE: '重複投与',
  ALLERGY: 'アレルギー',
  DISEASE_CONTRA: '病名禁忌',
  PREGNANCY_LACTATION: '妊娠・授乳',
  RENAL: '腎機能',
  HEPATIC: '肝機能',
  AGE: '年齢',
  INFECTION: '感染症',
};
const SHOW_IN_LABEL: Record<string, string> = {
  CHART: 'カルテ',
  RECEIPT_REVIEW: '要確認レセプト一覧',
};
// 抑止可能なチェック種類（ALLERGY は安全側で常に除外）。
const SUPPRESSIBLE_CHECK_TYPES = (Object.keys(CHECK_TYPE_LABEL) as string[]).filter(
  (t) => !(NON_SUPPRESSIBLE_CHECK_TYPES as readonly string[]).includes(t),
);

function demoSuppressions(): SuppressionRow[] {
  return [
    {
      id: 'demo-sup-1',
      scope: 'CHECK_TYPE',
      targetKey: 'DUPLICATE',
      checkType: 'DUPLICATE',
      minLevel: 'WARNING',
      showIn: 'RECEIPT_REVIEW',
      createdByUserId: 'demo-staff-5',
      createdAt: new Date('2026-05-20T10:00:00'),
    },
    {
      id: 'demo-sup-2',
      scope: 'DRUG',
      targetKey: 'demo-drug-1',
      checkType: 'DOSE_MAX',
      minLevel: 'WARNING',
      showIn: 'CHART',
      createdByUserId: 'demo-staff-5',
      createdAt: new Date('2026-05-25T14:30:00'),
    },
  ];
}

async function loadSuppressions(): Promise<{ rows: SuppressionRow[]; live: boolean }> {
  try {
    const rows = await prisma.ruleSuppression.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const mapped: SuppressionRow[] = rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      targetKey: r.targetKey,
      checkType: r.checkType ?? null,
      minLevel: r.minLevel ?? null,
      showIn: r.showIn,
      createdByUserId: r.createdByUserId ?? null,
      createdAt: r.createdAt ?? null,
    }));
    if (mapped.length === 0) return { rows: demoSuppressions(), live: false };
    return { rows: mapped, live: true };
  } catch (err) {
    console.error('[settings] loadSuppressions failed; showing demo data:', err);
    return { rows: demoSuppressions(), live: false };
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

export default async function SettingsPage() {
  // セッション取得はフェイルソフト（DB 到達不可時 null）。
  await getSession();
  const { rows: suppressions, live } = await loadSuppressions();

  return (
    <PageBody>
      <PageHeader
        title="システム設定"
        desc="セキュリティ・権限・真正性の現行ポリシー＋警告管理（無効化制御）（別紙1 §1 / 別紙3 #15-34 / FR-RXSAFE-05）"
        crumbs={['Medixus カルテ', '管理', 'システム設定']}
        actions={<Badge tone="blue">FE9</Badge>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {GROUPS.map((g) => (
          <Panel key={g.title}>
            <PanelHeader title={g.title} icon={<Icon name={g.icon} size={15} />} />
            <ul className="flex flex-col gap-2">
              {g.rows.map(([k, v, t]) => (
                <li key={k} className="text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={t}>{t === 'green' ? '有効' : t === 'blue' ? '実装' : '設定'}</Badge>
                    <span className="font-semibold text-ink">{k}</span>
                  </div>
                  <p className="mt-0.5 pl-1 text-muted">{v}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      {/* ── 警告管理（無効化制御）— FR-RXSAFE-05 ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        <Panel>
          <PanelHeader title="警告抑止ルールを追加" icon={<Icon name="warning" size={15} />} />
          <form action={createSuppression} className="flex flex-col gap-2.5">
            <Field label="対象種別">
              <Select name="scope" defaultValue="CHECK_TYPE">
                <option value="CHECK_TYPE">チェック種類単位</option>
                <option value="DRUG">医薬品単位</option>
                <option value="DRUG_CLASS">医薬品種類単位</option>
                <option value="PROCEDURE">処置行為単位</option>
              </Select>
            </Field>
            <Field label="対象キー（処置コード／医薬品ID／種類名 など）">
              <Input name="targetKey" placeholder="例：demo-drug-1 / DUPLICATE" />
            </Field>
            <Field label="チェック種類（任意・抑止対象の警告種別）">
              <Select name="checkType" defaultValue="">
                <option value="">（指定しない）</option>
                {SUPPRESSIBLE_CHECK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CHECK_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="抑止する最低レベル">
              <Select name="minLevel" defaultValue="WARNING">
                <option value="WARNING">WARNING 以上</option>
                <option value="BLOCKED">BLOCKED のみ</option>
              </Select>
            </Field>
            <Field label="表示先">
              <Select name="showIn" defaultValue="CHART">
                <option value="CHART">カルテ</option>
                <option value="RECEIPT_REVIEW">要確認レセプト一覧</option>
              </Select>
            </Field>
            <p className="rounded border border-amber-300 bg-amber-50/60 px-2 py-1.5 text-2xs leading-relaxed text-amber-800">
              <Icon name="warning" size={12} className="mr-1 inline align-text-bottom" />
              アレルギー警告・絶対禁忌（ABSOLUTE）は安全上の理由により抑止できません。
              抑止設定の作成・削除はすべて監査ログに記録されます。
            </p>
            <Button type="submit" variant="primary">
              抑止ルールを追加
            </Button>
          </form>
        </Panel>

        <Panel>
          <PanelHeader
            title="警告抑止ルール（無効化設定）"
            icon={<Icon name="settings" size={15} />}
            actions={
              <span className="flex items-center gap-2">
                <Badge tone="gray">{suppressions.length} 件</Badge>
                {!live && <Badge tone="gray">サンプル表示</Badge>}
              </span>
            }
          />
          {suppressions.length === 0 ? (
            <EmptyState
              title="警告抑止ルールはありません"
              hint="左のフォームから処置/医薬品/種類/レベル単位の抑止を追加できます"
              icon={<Icon name="warning" size={28} />}
            />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="px-2 py-1.5 text-left">対象種別</th>
                  <th className="px-2 py-1.5 text-left">対象キー</th>
                  <th className="px-2 py-1.5 text-left">警告種類</th>
                  <th className="px-2 py-1.5 text-left">最低レベル</th>
                  <th className="px-2 py-1.5 text-left">表示先</th>
                  <th className="px-2 py-1.5 text-left">登録</th>
                  <th className="px-2 py-1.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {suppressions.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-2 py-1.5 text-xs">
                      <Badge tone="blue">{SCOPE_LABEL[r.scope] ?? r.scope}</Badge>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-2xs text-ink">{r.targetKey}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {r.checkType ? (CHECK_TYPE_LABEL[r.checkType] ?? r.checkType) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{r.minLevel ?? '—'}</td>
                    <td className="px-2 py-1.5 text-xs">{SHOW_IN_LABEL[r.showIn] ?? r.showIn}</td>
                    <td className="px-2 py-1.5 text-2xs text-muted">{fmt(r.createdAt)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <form action={deleteSuppression} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <Button size="sm" variant="ghost" type="submit" title="抑止を解除">
                          <Icon name="x" size={13} />
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <p className="mt-4 text-2xs text-muted">
        ※ 値の編集UI（端末別SS時間・締切時間・機能フラグ）は設定永続化モデル実装で有効化。現行は本番基準の既定値で動作。
        警告管理は `RuleSuppression` に永続化され、アレルギー・絶対禁忌は除外されます（FR-RXSAFE-05 / G13）。
      </p>
    </PageBody>
  );
}
