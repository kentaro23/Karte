'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Panel,
  PanelHeader,
  Button,
  Badge,
  Icon,
  Select,
  Input,
  ThreeButtonDx,
  EmptyState,
  type DxKind,
} from '@medixus/ui';
import {
  composeDiseaseName,
  DISEASE_OUTCOME_LABEL,
  DIAGNOSIS_STATUS_LABEL,
  type DiseaseOutcome,
  type DiagnosisStatus,
} from '@medixus/domain';
import {
  addDiagnosisRich,
  bulkSetOutcome,
  toggleForBilling,
  deleteDiagnosis,
  exportDiagnoses,
} from './actions';

export type MasterRow = {
  id: string;
  code: string;
  name: string;
  icd10: string[];
};

export type DiagnosisRow = {
  id: string;
  displayName: string;
  masterCode: string | null;
  icd10: string | null;
  isMain: boolean;
  isSuspected: boolean;
  acuteChronic: string | null;
  departmentId: string | null;
  startDate: string; // ISO
  outcome: DiseaseOutcome | null;
  outcomeDate: string | null;
  forBilling: boolean;
  status: DiagnosisStatus;
};

export type DeptRow = { id: string; name: string };

/** レセ病名 前置修飾語（別紙1 §病名・プリ合成）。 */
const MODIFIERS = ['急性', '慢性', '亜急性', '再発性', '続発性', '出血性', '両側', '左', '右', '疑い'] as const;

const OUTCOME_KEYS = Object.keys(DISEASE_OUTCOME_LABEL) as DiseaseOutcome[];

/** ThreeButtonDx の3属性（確定/主病/疑い）→ 登録フラグへの写像。 */
function flagsForPick(kind: DxKind): { isMain: boolean; isSuspected: boolean } {
  // confirmed=確定病名（主でも疑いでもない）, main=主病名, suspected=疑い病名。
  if (kind === 'main') return { isMain: true, isSuspected: false };
  if (kind === 'suspected') return { isMain: false, isSuspected: true };
  return { isMain: false, isSuspected: false };
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ja-JP');
}

function isThisMonth(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function DiagnosesSearchClient({
  patientId,
  patientLabel,
  master,
  diagnoses,
  departments,
  initialQuery,
  demo,
}: {
  patientId: string;
  patientLabel: string;
  master: MasterRow[];
  diagnoses: DiagnosisRow[];
  departments: DeptRow[];
  initialQuery: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();

  // ── 検索・登録パラメータ ──
  const [query, setQuery] = React.useState(initialQuery);
  const [modifiers, setModifiers] = React.useState<string[]>([]);
  const [acuteChronic, setAcuteChronic] = React.useState<string>('');
  const [departmentId, setDepartmentId] = React.useState<string>(departments[0]?.id ?? '');
  const [startDate, setStartDate] = React.useState<string>(() => new Date().toISOString().slice(0, 10));
  const [forBilling, setForBilling] = React.useState(true);
  const [msg, setMsg] = React.useState<string | null>(null);

  // ── 一覧・一括転帰 ──
  const [rows, setRows] = React.useState<DiagnosisRow[]>(diagnoses);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkOutcome, setBulkOutcome] = React.useState<DiseaseOutcome>('CURED');
  const [showHistory, setShowHistory] = React.useState(false);
  const [thisMonthOnly, setThisMonthOnly] = React.useState(false);
  const [exportFmt, setExportFmt] = React.useState<'FHIR' | 'SS_MIX2' | 'COMMON_MIGRATION_LAYOUT'>('FHIR');
  const [exportMsg, setExportMsg] = React.useState<string | null>(null);

  React.useEffect(() => setRows(diagnoses), [diagnoses]);

  const filteredMaster = React.useMemo(() => {
    const q = query.trim();
    const base = q
      ? master.filter((m) => m.name.includes(q) || m.code.includes(q) || m.icd10.some((c) => c.includes(q)))
      : master;
    return base.slice(0, 60);
  }, [master, query]);

  const visibleRows = React.useMemo(() => {
    return rows.filter((r) => {
      if (r.status === 'DELETED') return false;
      if (!showHistory && r.status === 'RESOLVED') return false; // 既定は有効病名のみ
      if (thisMonthOnly && !(r.forBilling && (r.status === 'ACTIVE' || isThisMonth(r.startDate)))) return false;
      return true;
    });
  }, [rows, showHistory, thisMonthOnly]);

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? null;

  /** 三連ボタン ワンクリック登録（確定/主病/疑い）。 */
  function register(m: MasterRow, kind: DxKind) {
    const flags = flagsForPick(kind);
    const baseName = m.name;
    const displayName = composeDiseaseName(baseName, modifiers);
    start(async () => {
      const r = await addDiagnosisRich({
        patientId,
        masterCode: m.code,
        baseName,
        icd10: m.icd10[0] ?? null,
        modifiers,
        isMain: flags.isMain,
        isSuspected: flags.isSuspected,
        acuteChronic: acuteChronic || null,
        departmentId: departmentId || null,
        startDate,
        forBilling,
      });
      if (!r.ok) {
        setMsg(r.error ?? '登録に失敗しました');
        return;
      }
      if (r.demo) {
        // フロントのみモード — 楽観的に一覧へ反映（DBが無くても操作確認可能）。
        setRows((c) => [
          {
            id: `demo-${Date.now()}`,
            displayName,
            masterCode: m.code,
            icd10: m.icd10[0] ?? null,
            isMain: flags.isMain,
            isSuspected: flags.isSuspected,
            acuteChronic: acuteChronic || null,
            departmentId: departmentId || null,
            startDate: new Date(startDate).toISOString(),
            outcome: null,
            outcomeDate: null,
            forBilling,
            status: 'ACTIVE',
          },
          ...c,
        ]);
        setMsg(`「${displayName}」を登録しました（デモ表示）。`);
      } else {
        setMsg(`「${displayName}」を登録しました。`);
        router.refresh();
      }
    });
  }

  function toggleModifier(m: string) {
    setModifiers((c) => (c.includes(m) ? c.filter((x) => x !== m) : [...c, m]));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === visibleRows.length ? new Set() : new Set(visibleRows.map((r) => r.id)),
    );
  }

  function applyBulkOutcome() {
    const ids = [...selected];
    if (ids.length === 0) {
      setMsg('一括転帰する病名を選択してください。');
      return;
    }
    start(async () => {
      const r = await bulkSetOutcome(ids, bulkOutcome);
      if (!r.ok) {
        setMsg(r.error ?? '一括転帰に失敗しました');
        return;
      }
      const resolved = bulkOutcome === 'CURED' || bulkOutcome === 'TRANSFERRED';
      // 楽観反映（デモ／本番どちらも一覧を即更新）。
      setRows((c) =>
        c.map((row) =>
          selected.has(row.id)
            ? {
                ...row,
                outcome: bulkOutcome,
                outcomeDate: new Date().toISOString(),
                status: resolved ? 'RESOLVED' : 'ACTIVE',
              }
            : row,
        ),
      );
      setSelected(new Set());
      setMsg(
        `${ids.length}件に「${DISEASE_OUTCOME_LABEL[bulkOutcome]}」を一括適用しました${r.demo ? '（デモ表示）' : ''}。`,
      );
      if (!r.demo) router.refresh();
    });
  }

  function onToggleBilling(row: DiagnosisRow) {
    const next = !row.forBilling;
    setRows((c) => c.map((x) => (x.id === row.id ? { ...x, forBilling: next } : x)));
    start(async () => {
      await toggleForBilling(row.id, next);
    });
  }

  function onDelete(row: DiagnosisRow) {
    setRows((c) => c.map((x) => (x.id === row.id ? { ...x, status: 'DELETED' } : x)));
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(row.id);
      return n;
    });
    start(async () => {
      await deleteDiagnosis(row.id);
    });
  }

  function runExport() {
    setExportMsg('エクスポート中…');
    start(async () => {
      const r = await exportDiagnoses(patientId, exportFmt);
      if (r.error) setExportMsg(r.error);
      else if (r.status === 'STUB')
        setExportMsg(`${exportFmt} エクスポートは連携アダプタ未接続（STUB）です。本番接続で生成されます。`);
      else setExportMsg(`${exportFmt} で ${r.recordCount ?? 0} 件をエクスポートしました。`);
    });
  }

  const allChecked = visibleRows.length > 0 && selected.size === visibleRows.length;

  return (
    <div className="flex flex-col gap-4">
      {/* ── 病名一覧 ＋ 一括転帰 ── */}
      <Panel pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Icon name="chart" size={15} />
            <span className="text-sm font-bold">{patientLabel} の病名</span>
            <Badge tone="gray">{visibleRows.length}件</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1 text-2xs text-muted">
              <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
              履歴（転帰済）も表示
            </label>
            <label className="flex items-center gap-1 text-2xs text-muted">
              <input type="checkbox" checked={thisMonthOnly} onChange={(e) => setThisMonthOnly(e.target.checked)} />
              当月有効のみ
            </label>
            <Select
              value={exportFmt}
              onChange={(e) => setExportFmt(e.target.value as typeof exportFmt)}
              className="!w-36 !py-1 text-2xs"
            >
              <option value="FHIR">FHIR</option>
              <option value="SS_MIX2">SS-MIX2</option>
              <option value="COMMON_MIGRATION_LAYOUT">共通移行レイアウト</option>
            </Select>
            <Button size="sm" variant="ghost" onClick={runExport} disabled={pending}>
              <Icon name="referral" size={13} /> エクスポート
            </Button>
          </div>
        </div>

        {exportMsg && <p className="border-b border-line bg-soft px-4 py-1.5 text-2xs text-info">{exportMsg}</p>}

        {visibleRows.length === 0 ? (
          <EmptyState
            title="登録病名はありません"
            hint="下の標準病名マスタから三連ボタン（確定/主病/疑い）でワンクリック登録できます"
          />
        ) : (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-soft text-2xs uppercase text-muted">
                  <th className="w-8 px-2 py-1.5 text-center">
                    <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} aria-label="全選択" />
                  </th>
                  <th className="px-2 py-1.5 text-left">病名</th>
                  <th className="px-2 py-1.5 text-left">ICD10</th>
                  <th className="px-2 py-1.5 text-left">主/疑</th>
                  <th className="px-2 py-1.5 text-left">急慢</th>
                  <th className="px-2 py-1.5 text-left">診療科</th>
                  <th className="px-2 py-1.5 text-left">開始</th>
                  <th className="px-2 py-1.5 text-center">当月</th>
                  <th className="px-2 py-1.5 text-left">転帰</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((d) => {
                  const checked = selected.has(d.id);
                  return (
                    <tr
                      key={d.id}
                      className={`border-t border-line ${checked ? 'bg-accent-50' : ''} ${
                        d.status === 'RESOLVED' ? 'text-muted' : ''
                      }`}
                    >
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={checked} onChange={() => toggleSelect(d.id)} aria-label="選択" />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-medium text-ink">{d.displayName}</span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{d.icd10 ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        {d.isMain && <Badge tone="green">主病名</Badge>}
                        {d.isSuspected && <Badge tone="amber" className="ml-0.5">疑い</Badge>}
                        {!d.isMain && !d.isSuspected && <span className="text-2xs text-muted">確定</span>}
                      </td>
                      <td className="px-2 py-1.5 text-2xs">
                        {d.acuteChronic === 'ACUTE' ? '急性' : d.acuteChronic === 'CHRONIC' ? '慢性' : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-2xs">{deptName(d.departmentId) ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs">{fmtDate(d.startDate)}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => onToggleBilling(d)}
                          title="当月有効（レセ請求対象）"
                          className={`rounded px-1.5 py-0.5 text-2xs ${
                            d.forBilling ? 'bg-info text-white' : 'bg-soft text-muted'
                          }`}
                        >
                          {d.forBilling ? '対象' : '対象外'}
                        </button>
                      </td>
                      <td className="px-2 py-1.5">
                        {d.outcome ? (
                          <Badge tone={d.status === 'RESOLVED' ? 'gray' : 'blue'}>
                            {DISEASE_OUTCOME_LABEL[d.outcome]}
                          </Badge>
                        ) : (
                          <Badge tone="green">{DIAGNOSIS_STATUS_LABEL[d.status]}</Badge>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={() => onDelete(d)} className="text-alert" title="削除（論理）">
                          <Icon name="x" size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 一括転帰バー */}
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-soft px-4 py-2">
              <span className="text-2xs font-semibold text-muted">
                選択 {selected.size} 件を一括転帰:
              </span>
              <Select
                value={bulkOutcome}
                onChange={(e) => setBulkOutcome(e.target.value as DiseaseOutcome)}
                className="!w-28 !py-1 text-2xs"
              >
                {OUTCOME_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {DISEASE_OUTCOME_LABEL[k]}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="primary" onClick={applyBulkOutcome} disabled={pending || selected.size === 0}>
                一括適用
              </Button>
              <span className="ml-auto text-2xs text-muted">
                治癒/転医は転帰確定（RESOLVED）、その他は有効継続
              </span>
            </div>
          </>
        )}
      </Panel>

      {/* ── 病名登録（標準病名マスタ検索 ＋ 三連ボタン ＋ 修飾語） ── */}
      <Panel>
        <PanelHeader
          title="病名登録（標準病名マスタ）"
          desc="キーワードで標準病名を検索し、確定/主病/疑い のワンクリックで登録（ICD-10自動付与・修飾語プリ合成）"
          icon={<Icon name="plus" size={15} />}
        />

        {/* 登録オプション（修飾語・急慢・診療科・開始日・当月） */}
        <div className="mb-3 flex flex-col gap-2 rounded border border-line bg-soft/40 p-3">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-2xs font-semibold text-muted">修飾語:</span>
            {MODIFIERS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => toggleModifier(m)}
                className={`rounded border px-1.5 py-0.5 text-2xs ${
                  modifiers.includes(m)
                    ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700'
                    : 'border-line text-muted hover:bg-soft'
                }`}
              >
                {m}
              </button>
            ))}
            {modifiers.length > 0 && (
              <button
                type="button"
                onClick={() => setModifiers([])}
                className="ml-1 text-2xs text-muted underline"
              >
                クリア
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-2xs">
            <label className="flex items-center gap-1">
              <span className="text-muted">急/慢</span>
              <Select
                value={acuteChronic}
                onChange={(e) => setAcuteChronic(e.target.value)}
                className="!w-20 !py-1 text-2xs"
              >
                <option value="">—</option>
                <option value="ACUTE">急性</option>
                <option value="CHRONIC">慢性</option>
              </Select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-muted">診療科</span>
              <Select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="!w-32 !py-1 text-2xs"
              >
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-muted">開始日</span>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="!w-36 !py-1 text-2xs"
              />
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={forBilling} onChange={(e) => setForBilling(e.target.checked)} />
              <span className="text-muted">当月有効（レセ対象）</span>
            </label>
          </div>
        </div>

        {/* 検索ボックス */}
        <div className="mb-2 flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="病名キーワード / ICD-10 で検索（例: 胃潰瘍・I10・高血圧）"
            className="w-96"
          />
          <Badge tone="gray">{filteredMaster.length} 件</Badge>
        </div>

        {msg && <p className="mb-2 text-2xs text-info">{msg}</p>}

        {/* 候補リスト：各候補に ThreeButtonDx（確定/主病/疑い） */}
        <div className="flex flex-col gap-1.5">
          {filteredMaster.map((m) => {
            const preview = composeDiseaseName(m.name, modifiers);
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded border border-line px-2.5 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  {modifiers.length > 0 ? (
                    <>
                      <span className="font-medium text-ink">{preview}</span>
                      <span className="ml-1 text-2xs text-muted">（{m.name}）</span>
                    </>
                  ) : (
                    <span className="font-medium text-ink">{m.name}</span>
                  )}{' '}
                  <span className="font-mono text-2xs text-muted">{m.icd10[0] ?? m.code}</span>
                </span>
                <ThreeButtonDx size="sm" onPick={(kind) => register(m, kind)} />
              </div>
            );
          })}
          {filteredMaster.length === 0 && (
            <p className="py-4 text-center text-xs text-muted">
              {query.trim() ? '該当する標準病名がありません' : '病名マスタが空です'}
            </p>
          )}
        </div>

        {demo && (
          <p className="mt-3 text-2xs leading-relaxed text-muted">
            バックエンド未接続のため、登録・転帰・エクスポートはデモ表示です（画面操作は可能）。
            三連ボタンで確定/主病/疑いを登録し、修飾語（急性/慢性…）は composeDiseaseName で病名に前置合成されます。
          </p>
        )}
      </Panel>
    </div>
  );
}
