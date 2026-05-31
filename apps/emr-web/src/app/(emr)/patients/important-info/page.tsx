'use client';
import * as React from 'react';
import {
  Panel,
  PanelHeader,
  Button,
  Badge,
  Field,
  Input,
  Select,
  DataTable,
  EmptyState,
  Modal,
  Icon,
  type Column,
} from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  loadImportantInfo,
  searchDrugForAllergy,
  addDrugAllergy,
  addNonDrugAllergy,
  addInfection,
  addHistory,
  addFamily,
  removeImportantItem,
  type ImportantInfo,
  type AllergyRow,
  type InfectionRow,
  type HistoryRow,
  type FamilyRow,
  type DrugAllergyCandidate,
} from './actions';

const ALLERGY_TYPE_LABEL: Record<AllergyRow['type'], string> = {
  DRUG: '薬剤',
  FOOD: '食物',
  OTHER: 'その他',
};
const SEVERITY_LABEL: Record<string, string> = {
  MILD: '軽度',
  MODERATE: '中等度',
  SEVERE: '重度',
};
const HISTORY_KIND_LABEL: Record<string, string> = {
  PAST_ILLNESS: '既往',
  SURGERY: '手術',
  MEDICATION: '常用薬',
  TRANSFUSION: '輸血',
};

export default function ImportantInfoPage() {
  const [info, setInfo] = React.useState<ImportantInfo | null>(null);
  const [pending, start] = React.useTransition();
  const [drugOpen, setDrugOpen] = React.useState(false);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const refresh = React.useCallback((patientId?: string) => {
    start(async () => {
      const next = await loadImportantInfo(patientId);
      setInfo(next);
    });
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedId = info?.selectedId ?? null;
  const patient = info?.patients.find((p) => p.id === selectedId) ?? null;

  // すべての登録/削除アクションの共通ラッパ（fail-soft の {error} を表示）。
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, okMsg: string) => {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res.error) {
        setErr(res.error);
        return;
      }
      setFlash(okMsg);
      const next = await loadImportantInfo(selectedId ?? undefined);
      setInfo(next);
      setTimeout(() => setFlash(null), 2500);
    });
  };

  return (
    <PageBody>
      <PageHeader
        title="重要情報（アレルギー・感染症・既往・家族歴）"
        desc="薬剤アレルギー／副作用薬は医薬品マスタ実検索で登録し、成分コードを紐付けます。成分コード付きアレルギーは処方安全チェック（ALLERGY）で当該成分処方を BLOCKED にします。174項 14 / FR-PAT-02"
        crumbs={['Medixus カルテ', '患者', '重要情報']}
        actions={
          <div className="flex items-center gap-2">
            {info && (
              <Select
                value={selectedId ?? ''}
                disabled={pending || info.patients.length === 0}
                onChange={(e) => refresh(e.target.value)}
                className="min-w-56"
                aria-label="患者選択"
              >
                {info.patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.name}（{p.kana}）
                  </option>
                ))}
              </Select>
            )}
            {info?.demo && <Badge tone="amber">デモ表示</Badge>}
          </div>
        }
      />

      {info?.demo && (
        <Panel className="mb-4">
          <p className="text-xs text-muted">
            バックエンド未接続のため、患者・重要情報はデモデータを表示しています。画面操作・医薬品マスタ検索は可能で、
            登録は接続後に永続化されます。
          </p>
        </Panel>
      )}

      {flash && (
        <div className="mb-3 rounded border border-accent-200 bg-accent-50 px-3 py-2 text-xs font-semibold text-accent-700">
          {flash}
        </div>
      )}
      {err && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-alert">
          {err}
        </div>
      )}

      {!info ? (
        <Panel>
          <EmptyState title="読み込み中…" icon={<Icon name="refresh" size={28} />} />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* ── アレルギー ─────────────────────────────────────────── */}
          <Panel className="xl:col-span-2">
            <PanelHeader
              title="アレルギー・副作用"
              icon={<Icon name="warning" size={16} />}
              desc="薬剤は医薬品マスタから選択し成分コードを紐付け（安全エンジン連動）。食物・その他は名称登録。"
              actions={
                <div className="flex items-center gap-2">
                  <Button variant="primary" disabled={!patient} onClick={() => setDrugOpen(true)}>
                    <Icon name="rx" size={14} /> 薬剤を検索して追加
                  </Button>
                </div>
              }
            />
            <DataTable
              columns={allergyCols((kind, id) =>
                run(() => removeImportantItem(kind, id), '削除しました'),
              )}
              rows={info.allergies}
              getRowKey={(r) => r.id}
              emptyTitle="アレルギー登録なし"
            />
            <NonDrugAllergyForm
              disabled={!patient || pending}
              onAdd={(input) =>
                run(
                  () => addNonDrugAllergy({ patientId: selectedId ?? '', ...input }),
                  'アレルギーを登録しました',
                )
              }
            />
          </Panel>

          {/* ── 感染症 ─────────────────────────────────────────────── */}
          <Panel>
            <PanelHeader title="感染症" icon={<Icon name="warning" size={16} />} />
            <DataTable
              columns={[
                { key: 'pathogen', header: '病原体', render: (r: InfectionRow) => <span className="font-medium">{r.pathogen}</span> },
                { key: 'status', header: '状態', width: 100, render: (r: InfectionRow) => <Badge tone={r.status.includes('陽性') ? 'red' : 'gray'}>{r.status}</Badge> },
                {
                  key: 'act',
                  header: '',
                  width: 48,
                  render: (r: InfectionRow) => (
                    <RemoveButton onClick={() => run(() => removeImportantItem('infection', r.id), '削除しました')} />
                  ),
                },
              ]}
              rows={info.infections}
              getRowKey={(r) => r.id}
              emptyTitle="感染症登録なし"
            />
            <InfectionForm
              disabled={!patient || pending}
              onAdd={(input) =>
                run(() => addInfection({ patientId: selectedId ?? '', ...input }), '感染症を登録しました')
              }
            />
          </Panel>

          {/* ── 既往歴 ─────────────────────────────────────────────── */}
          <Panel>
            <PanelHeader title="既往・手術・常用薬・輸血" icon={<Icon name="chart" size={16} />} />
            <DataTable
              columns={[
                { key: 'kind', header: '区分', width: 80, render: (r: HistoryRow) => <Badge tone="blue">{HISTORY_KIND_LABEL[r.kind] ?? r.kind}</Badge> },
                { key: 'name', header: '内容', render: (r: HistoryRow) => <span className="font-medium">{r.name}</span> },
                {
                  key: 'act',
                  header: '',
                  width: 48,
                  render: (r: HistoryRow) => (
                    <RemoveButton onClick={() => run(() => removeImportantItem('history', r.id), '削除しました')} />
                  ),
                },
              ]}
              rows={info.histories}
              getRowKey={(r) => r.id}
              emptyTitle="既往歴登録なし"
            />
            <HistoryForm
              disabled={!patient || pending}
              onAdd={(input) =>
                run(() => addHistory({ patientId: selectedId ?? '', ...input }), '既往歴を登録しました')
              }
            />
          </Panel>

          {/* ── 家族歴 ─────────────────────────────────────────────── */}
          <Panel className="xl:col-span-2">
            <PanelHeader title="家族歴" icon={<Icon name="patients" size={16} />} />
            <DataTable
              columns={[
                { key: 'relation', header: '続柄', width: 100, render: (r: FamilyRow) => <span className="font-medium">{r.relation}</span> },
                { key: 'status', header: '状態・疾患', render: (r: FamilyRow) => r.status ?? '—' },
                {
                  key: 'act',
                  header: '',
                  width: 48,
                  render: (r: FamilyRow) => (
                    <RemoveButton onClick={() => run(() => removeImportantItem('family', r.id), '削除しました')} />
                  ),
                },
              ]}
              rows={info.family}
              getRowKey={(r) => r.id}
              emptyTitle="家族歴登録なし"
            />
            <FamilyForm
              disabled={!patient || pending}
              onAdd={(input) =>
                run(() => addFamily({ patientId: selectedId ?? '', ...input }), '家族歴を登録しました')
              }
            />
          </Panel>
        </div>
      )}

      <DrugAllergyModal
        open={drugOpen}
        onClose={() => setDrugOpen(false)}
        onAdd={(input) => {
          run(
            () => addDrugAllergy({ patientId: selectedId ?? '', ...input }),
            `薬剤アレルギーを登録しました（成分コード ${input.ingredientCode} — 安全エンジン連動）`,
          );
          setDrugOpen(false);
        }}
      />

      {pending && (
        <p className="fixed bottom-4 right-4 rounded bg-ink/80 px-3 py-1.5 text-xs text-white">
          処理中…
        </p>
      )}
    </PageBody>
  );
}

function allergyCols(onRemove: (kind: 'allergy', id: string) => void): Column<AllergyRow>[] {
  return [
    { key: 'type', header: '種別', width: 70, render: (r) => <Badge tone={r.type === 'DRUG' ? 'amber' : 'gray'}>{ALLERGY_TYPE_LABEL[r.type]}</Badge> },
    { key: 'substance', header: '物質', render: (r) => <span className="font-medium">{r.substance}</span> },
    {
      key: 'code',
      header: '成分コード',
      width: 150,
      render: (r) =>
        r.ingredientCode ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            <Badge tone="green" title="処方安全チェック（ALLERGY）で連動します">
              <Icon name="check" size={11} /> 連動
            </Badge>
            {r.ingredientCode}
          </span>
        ) : (
          <span className="text-2xs text-muted">—（連動なし）</span>
        ),
    },
    { key: 'reaction', header: '症状', width: 140, render: (r) => r.reaction ?? '—' },
    { key: 'severity', header: '重症度', width: 80, render: (r) => (r.severity ? (SEVERITY_LABEL[r.severity] ?? r.severity) : '—') },
    {
      key: 'act',
      header: '',
      width: 48,
      render: (r) => <RemoveButton onClick={() => onRemove('allergy', r.id)} />,
    },
  ];
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} aria-label="削除" title="削除">
      <Icon name="x" size={14} />
    </Button>
  );
}

/* ── 医薬品マスタ実検索 → 成分選択 → 薬剤アレルギー登録 ─────────────────── */
function DrugAllergyModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (input: { substance: string; ingredientCode: string; reaction?: string; severity?: string }) => void;
}) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<DrugAllergyCandidate[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [picked, setPicked] = React.useState<{ substance: string; ingredientCode: string } | null>(null);
  const [reaction, setReaction] = React.useState('');
  const [severity, setSeverity] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setQ('');
      setResults([]);
      setPicked(null);
      setReaction('');
      setSeverity('');
    }
  }, [open]);

  // キーワード→候補（デバウンス）。fail-soft なので必ず配列が返る。
  React.useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      const r = await searchDrugForAllergy(term);
      setResults(r);
      setSearching(false);
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="薬剤アレルギー登録（医薬品マスタ実検索 → 成分コード紐付け）"
      width={620}
      tone="alert"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            disabled={!picked}
            onClick={() =>
              picked &&
              onAdd({
                substance: picked.substance,
                ingredientCode: picked.ingredientCode,
                reaction: reaction || undefined,
                severity: severity || undefined,
              })
            }
          >
            <Icon name="plus" size={14} /> このアレルギーを登録
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="医薬品名・一般名で検索" hint="製剤を選ぶと有効成分（成分コード）が表示されます。成分を選んで登録します。">
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="例: サワシリン / アモキシシリン / カロナール"
          />
        </Field>

        {q.trim() && (
          <div className="rounded border border-line">
            {searching ? (
              <p className="px-3 py-4 text-center text-xs text-muted">検索中…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted">該当する医薬品がありません</p>
            ) : (
              <ul className="max-h-64 divide-y divide-line overflow-auto">
                {results.map((d) => (
                  <li key={d.productId} className="px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{d.brandName}</span>
                      <span className="font-mono text-2xs text-muted">{d.receiptCode}</span>
                    </div>
                    {d.genericName && <div className="text-2xs text-muted">{d.genericName}</div>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {d.ingredients.length === 0 ? (
                        <span className="text-2xs text-muted">成分情報なし（紐付け不可）</span>
                      ) : (
                        d.ingredients.map((g) => {
                          const active = picked?.ingredientCode === g.code;
                          return (
                            <button
                              key={g.code}
                              type="button"
                              onClick={() => setPicked({ substance: g.name, ingredientCode: g.code })}
                              className={
                                'inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ' +
                                (active
                                  ? 'border-accent-500 bg-accent-50 text-accent-700'
                                  : 'border-line bg-white text-ink hover:bg-soft')
                              }
                            >
                              {active && <Icon name="check" size={12} />}
                              {g.name}
                              <span className="font-mono text-2xs text-muted">{g.code}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {picked && (
          <div className="rounded border border-accent-200 bg-accent-50 p-3">
            <div className="text-xs font-semibold text-accent-700">
              選択中の成分: {picked.substance}{' '}
              <span className="font-mono">（成分コード {picked.ingredientCode}）</span>
            </div>
            <p className="mt-1 text-2xs text-muted">
              この成分を含む薬剤を処方すると、保存時の安全チェックで BLOCKED 判定されます。
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="症状・反応">
                <Input value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder="例: 蕁麻疹・アナフィラキシー" />
              </Field>
              <Field label="重症度">
                <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="">未設定</option>
                  <option value="MILD">軽度</option>
                  <option value="MODERATE">中等度</option>
                  <option value="SEVERE">重度</option>
                </Select>
              </Field>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── 食物/その他アレルギー（成分コードなし）の追加フォーム ─────────────── */
function NonDrugAllergyForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (input: { type: 'FOOD' | 'OTHER'; substance: string; reaction?: string; severity?: string }) => void;
}) {
  const [type, setType] = React.useState<'FOOD' | 'OTHER'>('FOOD');
  const [substance, setSubstance] = React.useState('');
  const [reaction, setReaction] = React.useState('');
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 rounded border border-line bg-soft px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!substance.trim()) return;
        onAdd({ type, substance, reaction: reaction || undefined });
        setSubstance('');
        setReaction('');
      }}
    >
      <Field label="種別" className="w-28">
        <Select value={type} onChange={(e) => setType(e.target.value as 'FOOD' | 'OTHER')}>
          <option value="FOOD">食物</option>
          <option value="OTHER">その他</option>
        </Select>
      </Field>
      <Field label="物質名" className="flex-1">
        <Input value={substance} onChange={(e) => setSubstance(e.target.value)} placeholder="例: 甲殻類・ラテックス" />
      </Field>
      <Field label="症状" className="w-44">
        <Input value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder="例: 発疹" />
      </Field>
      <Button type="submit" variant="secondary" disabled={disabled || !substance.trim()}>
        <Icon name="plus" size={14} /> 追加
      </Button>
    </form>
  );
}

function InfectionForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (input: { pathogen: string; status: string }) => void;
}) {
  const [pathogen, setPathogen] = React.useState('');
  const [status, setStatus] = React.useState('陽性');
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 rounded border border-line bg-soft px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pathogen.trim()) return;
        onAdd({ pathogen, status });
        setPathogen('');
      }}
    >
      <Field label="病原体" className="flex-1">
        <Input value={pathogen} onChange={(e) => setPathogen(e.target.value)} placeholder="例: HBs抗原・HCV抗体・梅毒" />
      </Field>
      <Field label="状態" className="w-28">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="陽性">陽性</option>
          <option value="陰性">陰性</option>
          <option value="既往">既往</option>
          <option value="不明">不明</option>
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={disabled || !pathogen.trim()}>
        <Icon name="plus" size={14} /> 追加
      </Button>
    </form>
  );
}

function HistoryForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (input: { kind: string; name: string }) => void;
}) {
  const [kind, setKind] = React.useState('PAST_ILLNESS');
  const [name, setName] = React.useState('');
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 rounded border border-line bg-soft px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd({ kind, name });
        setName('');
      }}
    >
      <Field label="区分" className="w-32">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="PAST_ILLNESS">既往</option>
          <option value="SURGERY">手術</option>
          <option value="MEDICATION">常用薬</option>
          <option value="TRANSFUSION">輸血</option>
        </Select>
      </Field>
      <Field label="内容" className="flex-1">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 高血圧症・虫垂切除術" />
      </Field>
      <Button type="submit" variant="secondary" disabled={disabled || !name.trim()}>
        <Icon name="plus" size={14} /> 追加
      </Button>
    </form>
  );
}

function FamilyForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (input: { relation: string; status: string }) => void;
}) {
  const [relation, setRelation] = React.useState('');
  const [status, setStatus] = React.useState('');
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 rounded border border-line bg-soft px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!relation.trim()) return;
        onAdd({ relation, status });
        setRelation('');
        setStatus('');
      }}
    >
      <Field label="続柄" className="w-32">
        <Input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="例: 父・母・兄" />
      </Field>
      <Field label="状態・疾患" className="flex-1">
        <Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="例: 糖尿病・大腸癌" />
      </Field>
      <Button type="submit" variant="secondary" disabled={disabled || !relation.trim()}>
        <Icon name="plus" size={14} /> 追加
      </Button>
    </form>
  );
}
