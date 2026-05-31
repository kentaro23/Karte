import { prisma } from '@medixus/db';
import { ORDER_TYPE_LABEL, type OrderType } from '@medixus/domain';
import { Badge, Panel, Icon, Button, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { NewOrderForm } from './new-order';
import { receiveOrder } from './actions';

const STATUS_TONE: Record<string, 'gray' | 'blue' | 'amber' | 'green' | 'red'> = {
  DRAFT: 'gray',
  REQUESTED: 'blue',
  RECEIVED: 'blue',
  IN_PROGRESS: 'amber',
  PARTIALLY_DONE: 'amber',
  DONE: 'green',
  RESULT_ARRIVED: 'green',
  APPROVED: 'green',
  CANCELLED: 'red',
  VOIDED: 'red',
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: '入力中',
  REQUESTED: '依頼',
  RECEIVED: '受付済',
  IN_PROGRESS: '実施中',
  PARTIALLY_DONE: '一部実施',
  DONE: '実施済',
  RESULT_ARRIVED: '結果到着',
  APPROVED: '承認済',
  CANCELLED: '中止',
  VOIDED: '取消',
};

export const dynamic = 'force-dynamic';

type OrderRow = {
  id: string;
  orderNo: string;
  orderType: string;
  status: string;
  isUrgent: boolean;
  createdAt: Date;
  patient: { patientNo: string; kanjiLastName: string; kanjiFirstName: string };
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  // fail-soft: DB 未接続でも画面を描画（空一覧）。
  let orders: OrderRow[] = [];
  let patients: { id: string; patientNo: string; kanjiLastName: string; kanjiFirstName: string }[] =
    [];
  try {
    [orders, patients] = await Promise.all([
      prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 80,
        include: {
          patient: { select: { patientNo: true, kanjiLastName: true, kanjiFirstName: true } },
        },
      }),
      prisma.patient.findMany({
        orderBy: { createdAt: 'asc' },
        take: 60,
        select: { id: true, patientNo: true, kanjiLastName: true, kanjiFirstName: true },
      }),
    ]);
  } catch {
    orders = [];
    patients = [];
  }

  return (
    <PageBody>
      <PageHeader
        title="オーダコンソール"
        desc="全オーダ種別の横断管理（登録・依頼・受付・実施・結果・承認）。174項 23-101,126-133"
        crumbs={['Medixus カルテ', 'オーダ', 'コンソール']}
        actions={<Badge tone="blue">{orders.length} 件</Badge>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <Panel pad={false}>
          <div className="border-b border-line px-4 py-2.5 text-sm font-bold">オーダ一覧</div>
          {orders.length === 0 ? (
            <EmptyState title="オーダはありません" icon={<Icon name="order" size={30} />} />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="px-3 py-2 text-left">オーダNo</th>
                  <th className="px-3 py-2 text-left">患者</th>
                  <th className="px-3 py-2 text-left">種別</th>
                  <th className="px-3 py-2 text-left">状態</th>
                  <th className="px-3 py-2 text-left">発行</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={o.id} className={i % 2 ? 'bg-soft/40' : 'bg-white'}>
                    <td className="px-3 py-2 font-mono text-xs">{o.orderNo}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-2xs text-muted">{o.patient.patientNo}</span>{' '}
                      {o.patient.kanjiLastName} {o.patient.kanjiFirstName}
                    </td>
                    <td className="px-3 py-2">
                      {ORDER_TYPE_LABEL[o.orderType as OrderType]}
                      {o.isUrgent && (
                        <Badge tone="red" className="ml-1">
                          緊急
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[o.status] ?? 'gray'}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-2xs text-muted">
                      {o.createdAt.toLocaleString('ja-JP')}
                    </td>
                    <td className="px-3 py-2">
                      {o.status === 'REQUESTED' && (
                        <form action={receiveOrder}>
                          <input type="hidden" name="id" value={o.id} />
                          <Button size="sm" variant="ghost" type="submit">
                            受付
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <NewOrderForm
          patients={patients.map((p) => ({
            id: p.id,
            label: `${p.patientNo} ${p.kanjiLastName} ${p.kanjiFirstName}`,
          }))}
          defaultType={sp.type}
        />
      </div>
    </PageBody>
  );
}
