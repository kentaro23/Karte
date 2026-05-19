import { Panel, PanelHeader, Badge, Icon } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

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

export default function SettingsPage() {
  return (
    <PageBody>
      <PageHeader
        title="システム設定"
        desc="セキュリティ・権限・真正性の現行ポリシー（別紙1 §1 / 別紙3 #15-34）"
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
      <p className="mt-4 text-2xs text-muted">
        ※ 値の編集UI（端末別SS時間・締切時間・機能フラグ）は設定永続化モデル実装で有効化。現行は本番基準の既定値で動作。
      </p>
    </PageBody>
  );
}
