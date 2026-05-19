import Link from 'next/link';
import { Panel, Icon, Button } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';

export default function Page() {
  return (
    <PageBody>
      <PageHeader
        title="処方オーダ"
        desc="処方は患者コンテキストで安全チェック（禁忌・相互作用・重複・極量・アレルギー）を実行します"
        crumbs={['Medixus カルテ', 'オーダ', '処方']}
      />
      <Panel>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Icon name="rx" size={40} className="text-line" />
          <p className="text-sm font-medium text-ink">
            処方は患者カルテ画面から発行します（4大安全チェック付き）
          </p>
          <p className="text-xs text-muted">
            禁忌・相互作用・重複・極量・アレルギーを処方日時点のマスタで決定論判定し、
            ブロックは理由入力＋監査記録で解除します（別紙1 §6.1 / 174項 57-63）。
          </p>
          <Link href="/patients/select?tab=reception">
            <Button variant="primary">患者を選択して処方</Button>
          </Link>
        </div>
      </Panel>
    </PageBody>
  );
}
