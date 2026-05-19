'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Tabs,
  DataTable,
  ReceptionTable,
  Modal,
  Button,
  Badge,
  Panel,
  Field,
  Select,
  Input,
  Icon,
  EmptyState,
  type Column,
  type ReceptionRow,
} from '@medixus/ui';
import { RECEPTION_STATUS_LABEL, type ReceptionStatus } from '@medixus/domain';
import { openChart, openPatient } from './actions';
import { PageBody, PageHeader } from '@/components/page';

export interface KanaRow {
  id: string;
  patientNo: string;
  name: string;
  kana: string;
  gender: string;
  age: number;
  sameName: boolean;
  isVip: boolean;
  isTemporaryId: boolean;
  hasRelated: boolean;
  allergies: string[];
  infections: string[];
}
export interface WardRow {
  encounterId: string;
  patientNo: string;
  name: string;
  kana: string;
  age: number;
  ward: string;
  dept: string;
  status: ReceptionStatus;
}
export interface ApptRow {
  id: string;
  patientId: string;
  patientNo: string;
  name: string;
  kana: string;
  age: number;
  scheduledAt: string;
  dept: string;
  status: string;
}
export interface ErRow {
  encounterId: string;
  patientNo: string;
  name: string;
  age: number;
  triage: string | null;
  arrivalMethod: string | null;
  isTemporaryId: boolean;
  status: ReceptionStatus;
}

export function SelectClient(props: {
  tab: string;
  q: string;
  reception: ReceptionRow[];
  appointments: ApptRow[];
  kana: KanaRow[];
  ward: WardRow[];
  er: ErRow[];
  assignment: { deptId: string; deptName: string; rows: ReceptionRow[] }[];
  recent: KanaRow[];
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [modal, setModal] = React.useState<KanaRow | null>(null);

  const go = (t: string) => router.push(`/patients/select?tab=${t}`);
  const open = (encounterId: string) => start(() => openChart(encounterId));

  const tabs = [
    { key: 'reception', label: '受付患者一覧', icon: <Icon name="reception" size={14} />, badge: props.reception.length },
    { key: 'appointments', label: '予約一覧', icon: <Icon name="calendar" size={14} />, badge: props.appointments.length },
    { key: 'kana', label: 'カナ/ID検索', icon: <Icon name="search" size={14} /> },
    { key: 'ward', label: '病棟患者', icon: <Icon name="ward" size={14} />, badge: props.ward.length },
    { key: 'wardmap', label: '病床マップ', icon: <Icon name="bed" size={14} /> },
    { key: 'er', label: '救急', icon: <Icon name="warning" size={14} />, badge: props.er.length },
    { key: 'assignment', label: '診察振分', icon: <Icon name="switch" size={14} /> },
    { key: 'recent', label: 'カルテ選択履歴', icon: <Icon name="clock" size={14} />, badge: props.recent.length },
  ];

  const warnBadges = (r: KanaRow) => (
    <div className="flex flex-wrap gap-1">
      {r.isTemporaryId && <Badge tone="amber">仮ID</Badge>}
      {r.isVip && <Badge tone="amber">VIP</Badge>}
      {r.sameName && <Badge tone="amber">同姓同名</Badge>}
      {r.hasRelated && <Badge tone="blue">関連患者</Badge>}
      {r.allergies.length > 0 && <Badge tone="red">アレルギー</Badge>}
      {r.infections.length > 0 && <Badge tone="red">感染症</Badge>}
    </div>
  );

  const patientCols: Column<KanaRow>[] = [
    { key: 'no', header: '患者ID', width: 100, accessor: (r) => r.patientNo, render: (r) => <span className="font-mono text-xs">{r.patientNo}</span> },
    {
      key: 'name',
      header: '氏名',
      accessor: (r) => r.kana,
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-2xs text-muted">{r.kana}</div>
        </div>
      ),
    },
    { key: 'sex', header: '性別', width: 50, render: (r) => r.gender },
    { key: 'age', header: '年齢', width: 56, align: 'right', accessor: (r) => r.age, render: (r) => `${r.age}歳` },
    { key: 'warn', header: '警告', render: warnBadges },
    {
      key: 'act',
      header: '',
      width: 70,
      render: (r) => (
        <Button size="sm" variant="secondary" onClick={() => setModal(r)}>
          開く
        </Button>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="患者選択"
        desc="患者を開く前に患者IDと氏名を必ず確認してください（取り違え防止）。⌘K でいつでも患者検索。"
        crumbs={['Medixus カルテ', '外来', '患者選択']}
      />
      <Tabs items={tabs} value={props.tab} onChange={go} className="mb-4" />

      {props.tab === 'reception' && (
        <ReceptionTable rows={props.reception} onOpen={open} onRefresh={() => router.refresh()} />
      )}

      {props.tab === 'appointments' && (
        <DataTable
          columns={[
            { key: 't', header: '予約時刻', width: 140, accessor: (r: ApptRow) => r.scheduledAt, render: (r: ApptRow) => new Date(r.scheduledAt).toLocaleString('ja-JP') },
            { key: 'no', header: '患者ID', width: 100, render: (r: ApptRow) => <span className="font-mono text-xs">{r.patientNo}</span> },
            { key: 'nm', header: '氏名', render: (r: ApptRow) => <div><div className="font-medium">{r.name}</div><div className="text-2xs text-muted">{r.kana}</div></div> },
            { key: 'dp', header: '診療科', width: 110, render: (r: ApptRow) => r.dept },
            { key: 'st', header: '状態', width: 90, render: (r: ApptRow) => <Badge tone="blue">{r.status}</Badge> },
            { key: 'ac', header: '', width: 70, render: (r: ApptRow) => <Button size="sm" variant="secondary" onClick={() => { const fd = new FormData(); fd.set('patientId', r.patientId); fd.set('visitType', 'RETURN'); start(() => openPatient(fd)); }}>受付</Button> },
          ]}
          rows={props.appointments}
          getRowKey={(r) => r.id}
          emptyTitle="予約はありません"
        />
      )}

      {props.tab === 'kana' && (
        <div className="flex flex-col gap-3">
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="tab" value="kana" />
            <Input
              name="q"
              defaultValue={props.q}
              placeholder="カナ氏名 / 漢字氏名 / 患者ID（前方・部分一致）"
              className="w-96"
            />
            <Button type="submit" variant="primary">
              <Icon name="search" size={14} /> 検索
            </Button>
          </form>
          <DataTable
            columns={patientCols}
            rows={props.kana}
            getRowKey={(r) => r.id}
            emptyTitle={props.q ? '該当患者なし' : '検索条件を入力してください'}
          />
        </div>
      )}

      {props.tab === 'ward' && (
        <DataTable
          columns={[
            { key: 'no', header: '患者ID', width: 100, render: (r: WardRow) => <span className="font-mono text-xs">{r.patientNo}</span> },
            { key: 'nm', header: '氏名', render: (r: WardRow) => <div><div className="font-medium">{r.name}</div><div className="text-2xs text-muted">{r.kana}</div></div> },
            { key: 'ag', header: '年齢', width: 56, align: 'right', render: (r: WardRow) => `${r.age}歳` },
            { key: 'wd', header: '病棟', width: 110, render: (r: WardRow) => r.ward },
            { key: 'dp', header: '診療科', width: 110, render: (r: WardRow) => r.dept },
            { key: 'st', header: '状態', width: 110, render: (r: WardRow) => <Badge tone="amber">{RECEPTION_STATUS_LABEL[r.status]}</Badge> },
          ]}
          rows={props.ward}
          getRowKey={(r) => r.encounterId}
          onRowClick={(r) => open(r.encounterId)}
          emptyTitle="入院患者はいません"
        />
      )}

      {props.tab === 'wardmap' && (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Icon name="bed" size={40} className="text-line" />
            <p className="text-sm font-medium text-ink">病床マップ</p>
            <p className="text-xs text-muted">病棟イメージ図・ドラッグ移動・空床表示</p>
            <Button variant="primary" onClick={() => router.push('/ward/map')}>
              病床マップを開く
            </Button>
          </div>
        </Panel>
      )}

      {props.tab === 'er' && (
        <DataTable
          columns={[
            { key: 'no', header: '患者ID', width: 100, render: (r: ErRow) => <span className="font-mono text-xs">{r.patientNo}</span> },
            { key: 'nm', header: '氏名', render: (r: ErRow) => <span className="font-medium">{r.name}</span> },
            { key: 'ag', header: '年齢', width: 56, align: 'right', render: (r: ErRow) => `${r.age}歳` },
            { key: 'tr', header: 'トリアージ', width: 120, render: (r: ErRow) => (r.triage ? <Badge tone="red">{r.triage}</Badge> : '—') },
            { key: 'am', header: '来院方法', width: 110, render: (r: ErRow) => r.arrivalMethod ?? '—' },
            { key: 'st', header: '状態', width: 110, render: (r: ErRow) => <Badge tone="amber">{RECEPTION_STATUS_LABEL[r.status]}</Badge> },
          ]}
          rows={props.er}
          getRowKey={(r) => r.encounterId}
          onRowClick={(r) => open(r.encounterId)}
          emptyTitle="救急患者はいません"
        />
      )}

      {props.tab === 'assignment' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {props.assignment.map((g) => (
            <Panel key={g.deptId}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold">{g.deptName}</span>
                <Badge tone="gray">{g.rows.length}名</Badge>
              </div>
              {g.rows.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted">振分対象なし</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {g.rows.map((r) => (
                    <li
                      key={r.encounterId}
                      onClick={() => open(r.encounterId)}
                      className="flex cursor-pointer items-center justify-between py-1.5 hover:bg-accent-50"
                    >
                      <span>
                        <span className="font-mono text-2xs text-muted">{r.patientNo}</span>{' '}
                        {r.name}
                      </span>
                      <Badge tone="blue">{RECEPTION_STATUS_LABEL[r.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}

      {props.tab === 'recent' && (
        <DataTable
          columns={patientCols}
          rows={props.recent}
          getRowKey={(r) => r.id}
          emptyTitle="カルテ選択履歴がありません"
        />
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title="患者モード選択（取り違え防止）"
        width={460}
        tone={modal && (modal.allergies.length || modal.infections.length || modal.sameName) ? 'alert' : 'default'}
      >
        {modal && (
          <form action={openPatient} className="flex flex-col gap-3">
            <input type="hidden" name="patientId" value={modal.id} />
            <div className="rounded border border-line bg-soft p-3 text-sm">
              <span className="font-mono text-xs text-muted">ID {modal.patientNo}</span>
              <div className="text-base font-bold">
                {modal.name}（{modal.kana}） {modal.gender} {modal.age}歳
              </div>
            </div>
            {(modal.sameName ||
              modal.isVip ||
              modal.isTemporaryId ||
              modal.hasRelated ||
              modal.allergies.length > 0 ||
              modal.infections.length > 0) && (
              <div className="flex flex-col gap-1.5 rounded border border-red-200 bg-red-50 p-3 text-xs">
                <span className="font-bold text-alert">確認事項（警告ゲート）</span>
                {modal.sameName && <div>⚠ 同姓同名患者が存在します。患者IDを必ず確認。</div>}
                {modal.isTemporaryId && <div>⚠ 救急仮IDです。本人確認に注意。</div>}
                {modal.isVip && <div>⚠ VIP患者です。アクセスは監査記録されます。</div>}
                {modal.hasRelated && <div>ℹ 関連患者（家族）が登録されています。</div>}
                {modal.allergies.length > 0 && (
                  <div className="font-semibold text-alert">
                    ⚠ アレルギー: {modal.allergies.join('・')}
                  </div>
                )}
                {modal.infections.length > 0 && (
                  <div className="font-semibold text-alert">
                    ⚠ 感染症: {modal.infections.join('・')}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="初診 / 再診">
                <Select name="visitType" defaultValue="RETURN">
                  <option value="RETURN">再診</option>
                  <option value="FIRST">初診</option>
                </Select>
              </Field>
              <Field label="カルテ種別">
                <Select name="mode" defaultValue="WRITE">
                  <option value="WRITE">カルテ記述</option>
                  <option value="VIEW">カルテ参照</option>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setModal(null)}>
                キャンセル
              </Button>
              <Button type="submit" variant="primary">
                カルテを開く
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {pending && (
        <p className="fixed bottom-4 right-4 rounded bg-ink/80 px-3 py-1.5 text-xs text-white">
          カルテを開いています…
        </p>
      )}
    </PageBody>
  );
}
