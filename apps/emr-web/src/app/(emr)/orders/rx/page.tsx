import { prisma } from '@medixus/db';
import { Panel, Badge } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { RxClient } from './rx-client';

// 安全チェック・発行は受診コンテキストに依存するため常に動的描画。
export const dynamic = 'force-dynamic';

type Drug = {
  id: string;
  brandName: string;
  genericName: string | null;
  strengthUnit: string | null;
  administrationRoute: string;
};

/** DB未接続でも画面が出るよう、取得は try/catch で fail-soft。 */
async function loadData(): Promise<{ patients: { id: string; label: string }[]; drugs: Drug[] }> {
  try {
    const [patients, drugs] = await Promise.all([
      prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 60 }),
      prisma.drugProduct.findMany({
        orderBy: { brandName: 'asc' },
        take: 30000,
        select: {
          id: true,
          brandName: true,
          genericName: true,
          strengthUnit: true,
          administrationRoute: true,
        },
      }),
    ]);
    return {
      patients: patients.map((p) => ({
        id: p.id,
        label: `${p.patientNo} ${p.kanjiLastName} ${p.kanjiFirstName}`,
      })),
      drugs,
    };
  } catch (err) {
    console.error('[orders/rx] loadData failed (fail-soft):', err);
    return { patients: [], drugs: [] };
  }
}

export default async function Page() {
  const { patients, drugs } = await loadData();

  return (
    <PageBody>
      <PageHeader
        title="処方オーダ"
        desc="院内/院外・臨時・用法・一包化・適応外を行内指定。発行時に4大＋アレルギー安全チェック（決定論・出典付き）を実行します。174項 57-63"
        crumbs={['Medixus カルテ', 'オーダ', '処方']}
        actions={<Badge tone="blue">{drugs.length} 品目</Badge>}
      />

      {drugs.length === 0 && (
        <Panel className="mb-4">
          <p className="text-xs text-muted">
            バックエンド未接続のため薬剤マスタは空です。画面操作は可能で、発行・安全チェックはデモ表示になります。
          </p>
        </Panel>
      )}

      <RxClient patients={patients} drugs={drugs} />

      <Panel className="mt-4">
        <p className="text-2xs leading-relaxed text-muted">
          院外処方は <code className="rounded bg-soft px-1">dispenseType=OUT_OF_HOUSE</code>{' '}
          として記録され、院外内服で投与日数が未入力の場合は保存をブロックし該当行を赤表示します（FR-RXSAFE-03）。
          安全チェック（禁忌・相互作用・重複・極量・アレルギー）は処方日時点のマスタで決定論判定し、ブロックは理由入力＋監査記録で解除します（FR-RXSAFE-01/04 / 別紙1 §6.1）。
          前回処方の Do・処方セットの保存/呼出にも対応（FR-RX-02 / Order.setId）。
        </p>
      </Panel>
    </PageBody>
  );
}
