'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ORDER_TYPE_LABEL, type OrderType } from '@medixus/domain';
import { Panel, PanelHeader, Field, Input, Select, Button, Icon, Badge } from '@medixus/ui';
import { createOrder } from './actions';
import { OrderMasterSearch } from './master-search';

const ITEM_LABEL: Partial<Record<OrderType, string>> = {
  LAB: '検査項目（例: 血算・生化学）',
  BACTERIOLOGY: '培養検体（例: 喀痰・尿）',
  PATHOLOGY: '病理検体',
  PHYSIOLOGY: '生理検査（例: 心電図・肺機能）',
  RADIOLOGY: '撮影部位（例: 胸部X線）',
  ENDOSCOPY: '内視鏡（例: 上部消化管）',
  INJECTION: '注射薬剤',
  TREATMENT: '処置手技',
  DIALYSIS: '透析指示',
  REHAB: 'リハビリ種別',
  GUIDANCE: '指導内容',
  CHEMO: 'レジメン',
  SURGERY: '術式',
  TRANSFUSION: '血液製剤',
  MEAL: '食種（例: 全粥食・糖尿病食）',
  REFERRAL: '紹介目的',
};

const TYPES: OrderType[] = [
  'LAB', 'BACTERIOLOGY', 'PATHOLOGY', 'PHYSIOLOGY', 'RADIOLOGY', 'ENDOSCOPY',
  'INJECTION', 'TREATMENT', 'DIALYSIS', 'REHAB', 'GUIDANCE', 'CHEMO',
  'SURGERY', 'TRANSFUSION', 'MEAL',
];

export function NewOrderForm({
  patients,
  defaultType,
}: {
  patients: { id: string; label: string }[];
  defaultType?: string;
}) {
  const [mode, setMode] = React.useState<'master' | 'simple'>('master');
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex self-start overflow-hidden rounded border border-line text-xs">
        {(
          [
            ['master', 'マスタ実検索'],
            ['simple', '簡易入力'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1 ${mode === m ? 'bg-accent-500 text-white' : 'bg-white text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'master' ? (
        <OrderMasterSearch patients={patients} defaultType={defaultType} />
      ) : (
        <SimpleOrderForm patients={patients} defaultType={defaultType} />
      )}
    </div>
  );
}

function SimpleOrderForm({
  patients,
  defaultType,
}: {
  patients: { id: string; label: string }[];
  defaultType?: string;
}) {
  const router = useRouter();
  const [type, setType] = React.useState<OrderType>(
    (defaultType as OrderType) && TYPES.includes(defaultType as OrderType)
      ? (defaultType as OrderType)
      : 'LAB',
  );
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  return (
    <Panel>
      <PanelHeader
        title="新規オーダ作成"
        icon={<Icon name="plus" size={15} />}
        desc="処方は安全チェック付きでカルテ画面から発行します"
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await createOrder(fd);
            if (r && 'error' in r && r.error) setMsg(r.error);
            else {
              setMsg('オーダを発行しました（状態: 依頼）');
              router.refresh();
            }
          });
        }}
        className="flex flex-col gap-3"
      >
        <Field label="患者" required>
          <Select name="patientId" required defaultValue="">
            <option value="" disabled>
              選択してください
            </option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="オーダ種別" required>
          <Select
            name="orderType"
            value={type}
            onChange={(e) => setType(e.target.value as OrderType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {ORDER_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={ITEM_LABEL[type] ?? '項目'} required>
          <Input name="itemName" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="数量/回数">
            <Input name="qty" type="number" defaultValue={1} min={1} />
          </Field>
          <label className="mt-6 flex items-center gap-1.5 text-xs">
            <input type="checkbox" name="urgent" /> 緊急オーダ
          </label>
        </div>
        <Field label="コメント">
          <textarea
            name="note"
            rows={2}
            className="rounded border border-line px-2.5 py-1.5 text-sm"
          />
        </Field>
        {msg && <p className="text-xs text-info">{msg}</p>}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? '発行中…' : 'オーダ発行'}
        </Button>
        <p className="text-2xs text-muted">
          発行は監査記録され、状態機械（DRAFT→依頼→受付→実施→結果→承認）で管理されます。
        </p>
      </form>
      <div className="mt-3 rounded border border-line bg-soft p-2 text-2xs text-muted">
        処方オーダ（禁忌・相互作用・重複・極量・アレルギーチェック付き）は
        <Badge tone="green" className="mx-1">
          カルテ画面
        </Badge>
        から発行してください。
      </div>
    </Panel>
  );
}
