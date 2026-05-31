'use client';
/**
 * FR-RCP-01/02/03 受付患者一覧（行内編集・表示カラム自由化・保存検索条件）。
 *
 *  - 行内インライン編集（FR-RCP-02）: 保険 / 診療科 / 医師 / 患者メモ / 受付メモ を
 *    一覧を離れずに編集。CLERK 以上のみ編集 UI を表示（権限外は読取専用）。
 *    変更は楽観反映しつつサーバで AuditEvent に記録（saveReceptionEdit）。
 *  - 表示カラム自由化（FR-RCP-03）: ColumnToggle で列 ON/OFF。生年月日は既定 OFF。
 *    設定は localStorage に即時保持＋保存検索条件に同梱して次回ログインでも復元。
 *  - 保存検索条件（FR-RCP-03）: テキスト/ステータス/診療科/医師＋表示カラムを
 *    名前付きで保存・1クリック再適用（SavedSearchCondition）。
 *
 * クライアント主導＋サーバアクション取得。DB 未接続でも loadReception が
 * fail-soft でデモ行を返すため画面が描画される。
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Panel,
  Toolbar,
  Button,
  Badge,
  Icon,
  Input,
  Select,
  Field,
  Modal,
  ColumnToggle,
  InlineEditCell,
  DataTable,
  EmptyState,
  type Column,
  type ColumnToggleItem,
} from '@medixus/ui';
import {
  RECEPTION_STATUS_LABEL,
  waitSeverity,
  type ReceptionStatus,
} from '@medixus/domain';
import { PageBody, PageHeader } from '@/components/page';
import {
  loadReception,
  saveReceptionEdit,
  saveSearchCondition,
  deleteSearchCondition,
  openChart,
  type ReceptionListData,
  type ReceptionListRow,
  type ReceptionOption,
  type ReceptionEditField,
  type ReceptionSearchCondition,
  type SavedSearch,
} from './actions';

const STATUS_TONE: Partial<Record<ReceptionStatus, 'gray' | 'blue' | 'amber' | 'green' | 'teal' | 'red'>> = {
  UNRECEIVED: 'gray',
  ARRIVED: 'blue',
  QUESTIONNAIRE_IN_PROGRESS: 'blue',
  QUESTIONNAIRE_DONE: 'blue',
  READY: 'teal',
  IN_CONSULTATION: 'amber',
  SUSPENDED: 'amber',
  CONSULTATION_DONE: 'green',
  BILLING_DONE: 'green',
  CANCELLED: 'red',
  NO_SHOW: 'red',
};

// 表示カラム定義（順序はテーブル列順。locked は常時表示・OFF 不可）。
const COLUMN_DEFS: ColumnToggleItem[] = [
  { key: 'recNo', label: '受付No' },
  { key: 'visit', label: '初再' },
  { key: 'pno', label: '患者ID', locked: true },
  { key: 'name', label: '氏名', locked: true },
  { key: 'sex', label: '性別' },
  { key: 'age', label: '年齢' },
  { key: 'dob', label: '生年月日' },
  { key: 'insurance', label: '保険' },
  { key: 'dept', label: '診療科' },
  { key: 'doctor', label: '医師' },
  { key: 'status', label: '診察状況' },
  { key: 'wait', label: '経過' },
  { key: 'patientMemo', label: '患者メモ' },
  { key: 'receptionMemo', label: '受付メモ' },
  { key: 'open', label: '操作', locked: true },
];
const ALL_KEYS = COLUMN_DEFS.map((c) => c.key);
// 既定表示（生年月日は既定 OFF）。
const DEFAULT_VISIBLE = ALL_KEYS.filter((k) => k !== 'dob');
const LS_COLUMNS = 'mx.reception.columns';

const STATUS_KEYS = Object.keys(RECEPTION_STATUS_LABEL) as ReceptionStatus[];

export default function ReceptionPage() {
  const router = useRouter();
  const [data, setData] = React.useState<ReceptionListData>({
    rows: [],
    deptOptions: [],
    doctorOptions: [],
    statusOptions: [],
    savedSearches: [],
    canEdit: false,
    jobType: '',
    dbDown: false,
  });
  const [loading, setLoading] = React.useState(true);
  const [pending, start] = React.useTransition();

  // フィルタ状態
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [dept, setDept] = React.useState('');
  const [doctor, setDoctor] = React.useState('');
  // 表示カラム
  const [visible, setVisible] = React.useState<string[]>(DEFAULT_VISIBLE);
  // 保存ダイアログ
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState('');
  const [toast, setToast] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    start(async () => {
      const d = await loadReception();
      setData(d);
      setLoading(false);
    });
  }, []);

  // 初回ロード＋localStorage からカラム復元（DB 取得前に即反映）。
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_COLUMNS);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr) && arr.length > 0) {
          // locked は必ず含める。
          const next = COLUMN_DEFS.filter(
            (c) => c.locked || arr.includes(c.key),
          ).map((c) => c.key);
          setVisible(next);
        }
      }
    } catch {
      /* ignore */
    }
    reload();
  }, [reload]);

  const setColumns = (keys: string[]) => {
    // locked を常に含める。
    const next = COLUMN_DEFS.filter((c) => c.locked || keys.includes(c.key)).map((c) => c.key);
    setVisible(next);
    try {
      window.localStorage.setItem(LS_COLUMNS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  // 行内編集 — 楽観更新してからサーバへ記録。
  const editCell = (encounterId: string, field: ReceptionEditField, value: string) => {
    setData((prev) => ({
      ...prev,
      rows: prev.rows.map((r) =>
        r.encounterId === encounterId ? { ...r, [field]: value } : r,
      ),
    }));
    start(async () => {
      const res = await saveReceptionEdit({ encounterId, field, value });
      if ('error' in res) flash(res.error);
    });
  };

  const open = (encounterId: string) => {
    if (encounterId.startsWith('demo-')) {
      flash('デモ行です（DB 未接続）。実データではカルテが開きます。');
      return;
    }
    start(async () => {
      await openChart(encounterId);
    });
  };

  // フィルタ適用
  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (dept && r.dept !== dept) return false;
      if (doctor && r.doctor !== doctor) return false;
      if (qq) {
        const hay = `${r.patientNo} ${r.name} ${r.kana} ${r.insurance} ${r.patientMemo} ${r.receptionMemo}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [data.rows, q, status, dept, doctor]);

  // 現在の検索条件オブジェクト
  const currentCondition = (): ReceptionSearchCondition => ({
    q: q || undefined,
    status: status || undefined,
    dept: dept || undefined,
    doctor: doctor || undefined,
    columns: visible,
  });

  const applySaved = (sc: SavedSearch) => {
    const c = sc.condition ?? {};
    setQ(c.q ?? '');
    setStatus(c.status ?? '');
    setDept(c.dept ?? '');
    setDoctor(c.doctor ?? '');
    if (Array.isArray(c.columns) && c.columns.length > 0) setColumns(c.columns);
    flash(`検索条件「${sc.name}」を適用しました`);
  };

  const doSave = () => {
    const name = saveName.trim();
    if (!name) return;
    start(async () => {
      const res = await saveSearchCondition({ name, condition: currentCondition() });
      setSaveOpen(false);
      setSaveName('');
      if ('error' in res) {
        flash(res.error);
      } else {
        flash(`検索条件「${name}」を保存しました`);
        reload();
      }
    });
  };

  const doDelete = (id: string, name: string) => {
    start(async () => {
      const res = await deleteSearchCondition(id);
      if ('error' in res) flash(res.error);
      else {
        flash(`「${name}」を削除しました`);
        reload();
      }
    });
  };

  const clearFilters = () => {
    setQ('');
    setStatus('');
    setDept('');
    setDoctor('');
  };

  // ── 列定義（visible で出し分け） ───────────────────────────────────────
  const deptOpts: ReceptionOption[] = data.deptOptions;
  const doctorOpts: ReceptionOption[] = data.doctorOptions;
  const canEdit = data.canEdit;
  const now = Date.now();

  const allCols: Column<ReceptionListRow>[] = [
    { key: 'recNo', header: '受付No', width: 64, accessor: (r) => r.receptionNo ?? 9999, render: (r) => r.receptionNo ?? '—' },
    { key: 'visit', header: '初再', width: 48, render: (r) => r.visitType ?? '—' },
    { key: 'pno', header: '患者ID', width: 92, accessor: (r) => r.patientNo, render: (r) => <span className="font-mono text-xs">{r.patientNo}</span> },
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
    { key: 'sex', header: '性別', width: 48, render: (r) => r.gender },
    { key: 'age', header: '年齢', width: 56, align: 'right', accessor: (r) => r.age, render: (r) => `${r.age}歳` },
    { key: 'dob', header: '生年月日', width: 110, accessor: (r) => r.dob, render: (r) => <span className="text-xs text-muted">{r.dob || '—'}</span> },
    {
      key: 'insurance',
      header: '保険',
      width: 150,
      accessor: (r) => r.insurance,
      render: (r) => (
        <InlineEditCell
          value={r.insurance}
          disabled={!canEdit}
          emptyLabel="保険未設定"
          onSave={(v) => editCell(r.encounterId, 'insurance', v)}
        />
      ),
    },
    {
      key: 'dept',
      header: '診療科',
      width: 120,
      accessor: (r) => r.dept,
      render: (r) => (
        <InlineEditCell
          value={r.dept}
          type="select"
          disabled={!canEdit}
          emptyLabel="—"
          options={[{ value: '', label: '—' }, ...deptOpts]}
          onSave={(v) => editCell(r.encounterId, 'dept', v)}
        />
      ),
    },
    {
      key: 'doctor',
      header: '医師',
      width: 120,
      accessor: (r) => r.doctor,
      render: (r) => (
        <InlineEditCell
          value={r.doctor}
          type="select"
          disabled={!canEdit}
          emptyLabel="未割当"
          options={[{ value: '', label: '未割当' }, ...doctorOpts]}
          onSave={(v) => editCell(r.encounterId, 'doctor', v)}
        />
      ),
    },
    {
      key: 'status',
      header: '診察状況',
      width: 104,
      accessor: (r) => r.status,
      render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{RECEPTION_STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: 'wait',
      header: '経過',
      width: 72,
      align: 'right',
      accessor: (r) => (r.arrivedAt ? now - new Date(r.arrivedAt).getTime() : -1),
      render: (r) => {
        if (!r.arrivedAt) return <span className="text-muted">—</span>;
        const m = Math.floor((now - new Date(r.arrivedAt).getTime()) / 60000);
        const sev = waitSeverity(m);
        return (
          <span
            className={
              'rounded px-1.5 py-0.5 text-xs font-bold ' +
              (sev === 'overdue'
                ? 'bg-red-50 text-alert'
                : sev === 'attention'
                  ? 'bg-amber-50 text-warn'
                  : 'text-muted')
            }
          >
            {m}分
          </span>
        );
      },
    },
    {
      key: 'patientMemo',
      header: '患者メモ',
      width: 160,
      accessor: (r) => r.patientMemo,
      render: (r) => (
        <InlineEditCell
          value={r.patientMemo}
          disabled={!canEdit}
          placeholder="患者メモ"
          emptyLabel="—"
          onSave={(v) => editCell(r.encounterId, 'patientMemo', v)}
        />
      ),
    },
    {
      key: 'receptionMemo',
      header: '受付メモ',
      width: 160,
      accessor: (r) => r.receptionMemo,
      render: (r) => (
        <InlineEditCell
          value={r.receptionMemo}
          disabled={!canEdit}
          placeholder="受付メモ"
          emptyLabel="—"
          onSave={(v) => editCell(r.encounterId, 'receptionMemo', v)}
        />
      ),
    },
    {
      key: 'open',
      header: '',
      width: 64,
      render: (r) => (
        <Button size="sm" variant="secondary" onClick={() => open(r.encounterId)}>
          開く
        </Button>
      ),
    },
  ];

  const visibleSet = new Set(visible);
  const cols = allCols.filter((c) => visibleSet.has(c.key));

  const filtersActive = Boolean(q || status || dept || doctor);

  return (
    <PageBody>
      <PageHeader
        title="受付患者一覧"
        desc="行ホバーで保険・診療科・医師・患者メモ・受付メモをその場編集（CLERK 以上）。表示カラムの ON/OFF・検索条件の保存に対応。FR-RCP-01/02/03"
        crumbs={['Medixus カルテ', '外来', '受付']}
        actions={
          <>
            <Badge tone="gray">{filtered.length}名</Badge>
            {!canEdit && <Badge tone="amber">閲覧のみ（編集権限なし）</Badge>}
            <Button size="sm" variant="ghost" onClick={reload} disabled={pending}>
              <Icon name="refresh" size={14} /> 更新
            </Button>
          </>
        }
      />

      {data.dbDown && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB 未接続）：行内編集・保存検索は UI 動作のみ（保存・監査は無効）。
        </div>
      )}

      {/* ── ツールバー: 検索 / フィルタ / 列表示 / 保存検索 ── */}
      <Toolbar className="mb-3">
        <div className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="氏名 / カナ / 患者ID / メモ"
            className="w-56 pl-8"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="ステータス">
          <option value="">状況: 全て</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {RECEPTION_STATUS_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-32" aria-label="診療科">
          <option value="">診療科: 全て</option>
          {deptOpts.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        <Select value={doctor} onChange={(e) => setDoctor(e.target.value)} className="w-32" aria-label="医師">
          <option value="">医師: 全て</option>
          {doctorOpts.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        {filtersActive && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            <Icon name="x" size={13} /> 条件クリア
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ColumnToggle columns={COLUMN_DEFS} visible={visible} onChange={setColumns} />
          <Button size="sm" variant="secondary" onClick={() => setSaveOpen(true)}>
            <Icon name="pin" size={13} /> 条件を保存
          </Button>
        </div>
      </Toolbar>

      {/* ── 保存済み検索条件（1クリック再適用） ── */}
      {data.savedSearches.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-bold uppercase tracking-wider text-muted">保存条件</span>
          {data.savedSearches.map((sc) => (
            <span
              key={sc.id}
              className="inline-flex items-center gap-1 rounded border border-line bg-white py-0.5 pl-2 pr-1 text-xs shadow-panel"
            >
              <button
                type="button"
                onClick={() => applySaved(sc)}
                className="font-medium text-accent-700 hover:underline"
                title="この条件を適用"
              >
                {sc.name}
              </button>
              <button
                type="button"
                onClick={() => doDelete(sc.id, sc.name)}
                className="text-muted hover:text-alert"
                aria-label={`${sc.name} を削除`}
                title="削除"
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <Panel pad={false}>
        {loading ? (
          <div className="px-4 py-12 text-center text-2xs text-muted">読み込み中…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={filtersActive ? '条件に一致する受付患者がいません' : '受付患者はいません'}
            hint={filtersActive ? '検索条件を変更してください' : undefined}
            icon={<Icon name="reception" size={32} />}
          />
        ) : (
          <DataTable
            columns={cols}
            rows={filtered}
            getRowKey={(r) => r.encounterId}
            emptyTitle="受付患者はいません"
            maxHeight="calc(100vh - 280px)"
          />
        )}
      </Panel>

      <p className="mt-2 text-2xs text-muted/70">
        行内編集は {canEdit ? 'CLERK 以上の権限で有効' : '権限がないため無効（閲覧のみ）'}。
        変更は AuditEvent に記録され、次回読込時に最新値が復元されます。表示カラム設定は端末に保持され、保存検索条件にも同梱されます。
      </p>

      {/* ── 検索条件の保存ダイアログ ── */}
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="検索条件を保存"
        width={420}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={doSave} disabled={!saveName.trim() || pending}>
              <Icon name="check" size={14} /> 保存
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="保存名" required>
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="例: 内科・診察中のみ"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName.trim()) doSave();
              }}
            />
          </Field>
          <div className="rounded border border-line bg-soft p-2.5 text-2xs text-muted">
            <p className="mb-1 font-semibold text-ink">保存される条件</p>
            <ul className="space-y-0.5">
              <li>テキスト: {q || '（なし）'}</li>
              <li>状況: {status ? RECEPTION_STATUS_LABEL[status as ReceptionStatus] : '全て'}</li>
              <li>診療科: {dept || '全て'}</li>
              <li>医師: {doctor || '全て'}</li>
              <li>表示カラム: {visible.length}列</li>
            </ul>
          </div>
        </div>
      </Modal>

      {toast && (
        <p className="fixed bottom-4 right-4 z-[120] rounded bg-ink/85 px-3 py-1.5 text-xs text-white shadow-pop">
          {toast}
        </p>
      )}
    </PageBody>
  );
}
