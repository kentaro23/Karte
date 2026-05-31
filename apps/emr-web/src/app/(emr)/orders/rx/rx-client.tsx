'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Panel, PanelHeader, Button, Badge, Icon, Select } from '@medixus/ui';
import {
  issueRxOrder,
  confirmRxOrder,
  loadLastPrescription,
  type RxLineInput,
  type DispenseType,
} from './actions';

/* 用法マスタ（内服[1-4回]/頓服/外用）。値が処方箋に反映される（FR-RX-01 AC1）。 */
const USAGES: { value: string; label: string; group: '内服' | '頓服' | '外用' }[] = [
  { value: '毎食後', label: '内服・毎食後（1日3回）', group: '内服' },
  { value: '毎食前', label: '内服・毎食前（1日3回）', group: '内服' },
  { value: '朝食後', label: '内服・朝食後（1日1回）', group: '内服' },
  { value: '朝夕食後', label: '内服・朝夕食後（1日2回）', group: '内服' },
  { value: '就寝前', label: '内服・就寝前（1日1回）', group: '内服' },
  { value: '8時間毎', label: '内服・8時間毎（1日3回）', group: '内服' },
  { value: '頓用', label: '頓服・頓用', group: '頓服' },
  { value: '発熱時頓用', label: '頓服・発熱時', group: '頓服' },
  { value: '疼痛時頓用', label: '頓服・疼痛時', group: '頓服' },
  { value: '外用', label: '外用', group: '外用' },
];

const USAGE_TPD: Record<string, number> = {
  毎食後: 3,
  毎食前: 3,
  朝食後: 1,
  朝夕食後: 2,
  就寝前: 1,
  '8時間毎': 3,
};

type Drug = {
  id: string;
  brandName: string;
  genericName: string | null;
  strengthUnit: string | null;
  administrationRoute: string;
};

type Patient = { id: string; label: string };

/** UI 行（RxLineInput に key/フラグを保持）。 */
type Line = RxLineInput;

type Finding = { checkType: string; result: string; message: string };

let _seq = 0;
const newKey = () => `rx-${Date.now()}-${_seq++}`;

function isOralRoute(route: string): boolean {
  const r = (route ?? '').toUpperCase();
  return r === 'PO' || r === 'ORAL' || route === '内服' || route === '経口' || route.includes('内服');
}
function isAsNeeded(usage: string): boolean {
  return usage.includes('頓');
}
/** 院外内服で日数必須なのに未入力 → 保存ブロック対象（FR-RXSAFE-03）。 */
function lineNeedsDays(l: Line): boolean {
  return l.dispenseType === 'OUT_OF_HOUSE' && isOralRoute(l.route) && !isAsNeeded(l.usage);
}
function lineHasError(l: Line): boolean {
  if (!l.usage || !l.usage.trim()) return true;
  return lineNeedsDays(l) && (!Number.isFinite(l.days) || l.days <= 0);
}

export function RxClient({ patients, drugs }: { patients: Patient[]; drugs: Drug[] }) {
  const router = useRouter();

  const [patientId, setPatientId] = React.useState(patients[0]?.id ?? '');
  const [lines, setLines] = React.useState<Line[]>([]);

  // ── 行追加フォーム状態 ──
  const [query, setQuery] = React.useState('');
  const [drugId, setDrugId] = React.useState(drugs[0]?.id ?? '');
  const [dose, setDose] = React.useState(1);
  const [tpd, setTpd] = React.useState(3);
  const [days, setDays] = React.useState(7);
  const [usage, setUsage] = React.useState('毎食後');
  const [dispense, setDispense] = React.useState<DispenseType>('IN_HOUSE');
  const [isTemporary, setIsTemporary] = React.useState(false);
  const [isOnePackage, setIsOnePackage] = React.useState(false);
  const [isOffLabel, setIsOffLabel] = React.useState(false);

  const [pending, start] = React.useTransition();
  // 呼び出したセットの識別子。発行時に Order.setId として記録（FR-RX-02）。
  const [setIdInput, setSetIdInput] = React.useState<string | null>(null);
  const [savedSets, setSavedSets] = React.useState<{ id: string; name: string; lines: Line[] }[]>([]);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [blockedKeys, setBlockedKeys] = React.useState<Set<string>>(new Set());

  const [result, setResult] = React.useState<null | {
    prescriptionId: string | null;
    overall: string;
    findings: Finding[];
    persistedIds: string[];
    note?: string;
  }>(null);
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const [confirmMsg, setConfirmMsg] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim();
    const base = q
      ? drugs.filter((d) => d.brandName.includes(q) || (d.genericName ?? '').includes(q))
      : drugs;
    return base.slice(0, 200);
  }, [drugs, query]);
  const selected = drugs.find((d) => d.id === drugId);

  // 用法を選ぶと内服回数を自動補完。頓服/外用は日数任意。
  function pickUsage(v: string) {
    setUsage(v);
    if (USAGE_TPD[v]) setTpd(USAGE_TPD[v]!);
  }

  function addLine() {
    const d = drugs.find((x) => x.id === drugId);
    if (!d) {
      setMsg('薬剤を選択してください');
      return;
    }
    const line: Line = {
      key: newKey(),
      drugProductId: d.id,
      drugName: d.brandName,
      dosePerTime: dose,
      doseUnit: d.strengthUnit ?? '錠',
      timesPerDay: tpd,
      days,
      route: d.administrationRoute,
      usage,
      dispenseType: dispense,
      isTemporary,
      isOnePackage,
      isOffLabel,
    };
    setLines((c) => [...c, line]);
    setSetIdInput(null); // 手動追加でセット由来でなくなる
    setMsg(null);
    setResult(null);
  }

  function patchLine(key: string, patch: Partial<Line>) {
    setLines((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setBlockedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setResult(null);
  }
  function removeLine(key: string) {
    setLines((c) => c.filter((l) => l.key !== key));
    setResult(null);
  }

  // クライアント側の保存ブロック判定（即時赤表示）。
  const clientBlocked = React.useMemo(
    () => new Set(lines.filter(lineHasError).map((l) => l.key)),
    [lines],
  );
  const effectiveBlocked = React.useMemo(() => {
    const s = new Set(blockedKeys);
    clientBlocked.forEach((k) => s.add(k));
    return s;
  }, [blockedKeys, clientBlocked]);

  const hasOutOfHouse = lines.some((l) => l.dispenseType === 'OUT_OF_HOUSE');

  function issue() {
    if (!patientId) {
      setMsg('患者を選択してください');
      return;
    }
    if (lines.length === 0) {
      setMsg('処方薬を追加してください');
      return;
    }
    if (clientBlocked.size > 0) {
      setBlockedKeys(new Set(clientBlocked));
      setMsg('院外内服の投与日数または用法が未入力です。赤い行を補完してください。');
      return;
    }
    start(async () => {
      const r = await issueRxOrder({ patientId, setId: setIdInput }, lines);
      if (!r.ok) {
        setBlockedKeys(new Set(r.blockedKeys));
        setMsg(r.error);
        setResult(null);
        return;
      }
      setBlockedKeys(new Set());
      setConfirmMsg(null);
      if (r.summary) {
        setResult({
          prescriptionId: r.prescriptionId,
          overall: r.summary.overall,
          findings: r.summary.findings as Finding[],
          persistedIds: r.summary.persistedIds,
          note: r.note,
        });
        setMsg(null);
      } else {
        setResult({
          prescriptionId: r.prescriptionId,
          overall: 'PASS',
          findings: [],
          persistedIds: [],
          note: r.note ?? '安全チェックはバックエンド接続時に実行されます（デモ表示）。',
        });
        setMsg('処方を発行しました（デモ表示）。');
        router.refresh();
      }
    });
  }

  function doConfirm() {
    const current = result;
    if (!current?.prescriptionId) {
      setConfirmMsg('処方を確定しました');
      return;
    }
    const pid = current.prescriptionId;
    start(async () => {
      const overrides = current.findings
        .map((f, i) => ({ f, id: current.persistedIds[i] ?? '' }))
        .filter((x) => x.f.result === 'BLOCKED' && x.id)
        .map((x) => ({ ruleCheckResultId: x.id, reason: reasons[x.id] ?? '' }));
      const r = await confirmRxOrder(pid, overrides);
      setConfirmMsg(r.ok ? '処方を確定しました' : (r.error ?? '確定に失敗しました'));
      if (r.ok) router.refresh();
    });
  }

  function doLast() {
    if (!patientId) {
      setMsg('患者を選択してください');
      return;
    }
    start(async () => {
      const prev = await loadLastPrescription(patientId);
      if (prev.length === 0) {
        setMsg('複製できる前回処方が見つかりませんでした。');
        return;
      }
      setLines(prev.map((p) => ({ ...p, key: newKey() })));
      setSetIdInput(null);
      setMsg(`前回処方 ${prev.length} 件を複製しました（Do）。`);
      setResult(null);
    });
  }

  // セット登録/呼出（クライアント保持 — Order.setId 連携の UI 側）。
  function saveSet() {
    if (lines.length === 0) {
      setMsg('セットに保存する明細がありません。');
      return;
    }
    const name = `セット${savedSets.length + 1}（${lines.map((l) => l.drugName).slice(0, 2).join('・')}…）`;
    setSavedSets((s) => [...s, { id: `set-${Date.now()}`, name, lines: lines.map((l) => ({ ...l })) }]);
    setMsg('現在の処方をセット保存しました。');
  }
  function loadSet(id: string) {
    const set = savedSets.find((s) => s.id === id);
    if (!set) return;
    setLines(set.lines.map((l) => ({ ...l, key: newKey() })));
    setSetIdInput(set.id); // 発行時に Order.setId へ記録
    setMsg(`${set.name} を呼び出しました。`);
    setResult(null);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* ── 左: 薬剤選択＋行パラメータ ── */}
      <Panel>
        <PanelHeader title="薬剤を追加" icon={<Icon name="rx" size={15} />} desc="用法・院内外・日数・一包化・適応外を指定" />
        <div className="text-xs">
          <label className="mb-2 block">
            <span className="mb-0.5 block text-2xs font-semibold text-muted">患者</span>
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="" disabled>
                選択してください
              </option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="薬剤名で検索"
            className="mb-1 w-full rounded border border-line px-2 py-1 text-xs"
          />
          <div className="mb-1.5 max-h-40 overflow-auto rounded border border-line">
            {filtered.map((d) => (
              <button
                key={d.id}
                onClick={() => setDrugId(d.id)}
                className={`block w-full truncate px-2 py-1 text-left text-xs hover:bg-soft ${
                  d.id === drugId ? 'bg-accent-50 font-semibold' : ''
                }`}
              >
                {d.brandName}
                <span className="ml-1 text-2xs text-muted">{d.administrationRoute}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-2xs text-muted">該当なし</div>
            )}
          </div>
          <div className="mb-1.5 text-2xs text-muted">
            選択中: <span className="font-semibold text-ink">{selected?.brandName ?? '—'}</span>
          </div>

          {/* 用法（内服[1-4回]/頓服/外用） */}
          <label className="mb-1 block">
            <span className="mb-0.5 block text-2xs font-semibold text-muted">用法</span>
            <Select value={usage} onChange={(e) => pickUsage(e.target.value)}>
              {USAGES.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="mb-1 flex items-center gap-1">
            <label className="flex items-center gap-0.5">
              <span className="text-2xs text-muted">1回</span>
              <input
                type="number"
                value={dose}
                step={0.5}
                min={0}
                onChange={(e) => setDose(+e.target.value)}
                className="w-11 rounded border border-line px-1 py-1"
              />
            </label>
            <label className="flex items-center gap-0.5">
              <span className="text-2xs text-muted">×</span>
              <input
                type="number"
                value={tpd}
                min={1}
                onChange={(e) => setTpd(+e.target.value)}
                className="w-10 rounded border border-line px-1 py-1"
              />
              <span className="text-2xs text-muted">回</span>
            </label>
            <label className="flex items-center gap-0.5">
              <input
                type="number"
                value={days}
                min={0}
                onChange={(e) => setDays(+e.target.value)}
                className="w-12 rounded border border-line px-1 py-1"
              />
              <span className="text-2xs text-muted">日</span>
            </label>
            <span className="ml-auto text-2xs text-muted">
              1日量 <b>{(dose * tpd).toFixed(dose % 1 ? 1 : 0)}</b>
            </span>
          </div>
          <div className="mb-1.5 flex flex-wrap gap-1">
            {[7, 14, 28, 30, 90].map((dd) => (
              <button
                key={dd}
                onClick={() => setDays(dd)}
                className={`rounded border px-1.5 py-0.5 text-2xs ${
                  days === dd ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-line'
                }`}
              >
                {dd}日
              </button>
            ))}
          </div>

          {/* 院内外切替 ＋ 臨時/一包化/適応外 */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
            <span className="inline-flex overflow-hidden rounded border border-line">
              {(['IN_HOUSE', 'OUT_OF_HOUSE'] as const).map((dt) => (
                <button
                  key={dt}
                  onClick={() => setDispense(dt)}
                  className={`px-2 py-0.5 ${dispense === dt ? 'bg-accent-500 text-white' : 'bg-white'}`}
                >
                  {dt === 'IN_HOUSE' ? '院内' : '院外'}
                </button>
              ))}
            </span>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={isTemporary} onChange={(e) => setIsTemporary(e.target.checked)} />
              臨時
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={isOnePackage} onChange={(e) => setIsOnePackage(e.target.checked)} />
              一包化
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={isOffLabel} onChange={(e) => setIsOffLabel(e.target.checked)} />
              適応外
            </label>
          </div>

          <Button size="sm" variant="secondary" className="w-full justify-center" onClick={addLine}>
            <Icon name="plus" size={13} /> 明細に追加
          </Button>
        </div>
      </Panel>

      {/* ── 右: 処方明細＋発行＋安全チェック ── */}
      <Panel pad={false}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="text-sm font-bold">処方明細</div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={doLast} disabled={pending}>
              <Icon name="refresh" size={13} /> 前回Do
            </Button>
            <Button size="sm" variant="ghost" onClick={saveSet} disabled={pending || lines.length === 0}>
              <Icon name="pin" size={13} /> セット保存
            </Button>
            {savedSets.length > 0 && (
              <Select
                value=""
                onChange={(e) => e.target.value && loadSet(e.target.value)}
                className="!w-32 !py-1 text-2xs"
              >
                <option value="">セット呼出…</option>
                {savedSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Icon name="rx" size={32} className="text-line" />
            <p className="text-sm text-muted">左のフォームから薬剤を明細に追加してください</p>
            <p className="text-2xs text-muted">前回Do・セット呼出からも追加できます</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-soft text-2xs uppercase text-muted">
                <th className="px-2 py-1.5 text-left">薬剤</th>
                <th className="px-2 py-1.5 text-left">用法</th>
                <th className="px-2 py-1.5 text-right">1回×回</th>
                <th className="px-2 py-1.5 text-right">日数</th>
                <th className="px-2 py-1.5 text-center">院内外</th>
                <th className="px-2 py-1.5 text-center">区分</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const err = effectiveBlocked.has(l.key);
                const needDays = lineNeedsDays(l);
                return (
                  <tr
                    key={l.key}
                    className={err ? 'bg-alert/10 ring-1 ring-inset ring-alert' : 'border-b border-line'}
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-medium text-ink">{l.drugName}</div>
                      <div className="text-2xs text-muted">{l.route}</div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={l.usage}
                        onChange={(e) =>
                          patchLine(l.key, {
                            usage: e.target.value,
                            timesPerDay: USAGE_TPD[e.target.value] ?? l.timesPerDay,
                          })
                        }
                        className="!w-28 !py-0.5 text-2xs"
                      >
                        {USAGES.map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.value}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        value={l.dosePerTime}
                        step={0.5}
                        min={0}
                        onChange={(e) => patchLine(l.key, { dosePerTime: +e.target.value })}
                        className="w-10 rounded border border-line px-1 py-0.5 text-right"
                      />
                      <span className="mx-0.5 text-muted">×</span>
                      <input
                        type="number"
                        value={l.timesPerDay}
                        min={1}
                        onChange={(e) => patchLine(l.key, { timesPerDay: +e.target.value })}
                        className="w-9 rounded border border-line px-1 py-0.5 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        value={l.days}
                        min={0}
                        onChange={(e) => patchLine(l.key, { days: +e.target.value })}
                        className={`w-12 rounded border px-1 py-0.5 text-right ${
                          err && needDays ? 'border-alert bg-alert/10 text-alert' : 'border-line'
                        }`}
                        placeholder={needDays ? '必須' : '—'}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className="inline-flex overflow-hidden rounded border border-line text-2xs">
                        {(['IN_HOUSE', 'OUT_OF_HOUSE'] as const).map((dt) => (
                          <button
                            key={dt}
                            onClick={() => patchLine(l.key, { dispenseType: dt })}
                            className={`px-1.5 py-0.5 ${
                              l.dispenseType === dt ? 'bg-accent-500 text-white' : 'bg-white'
                            }`}
                          >
                            {dt === 'IN_HOUSE' ? '院内' : '院外'}
                          </button>
                        ))}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <div className="flex flex-wrap justify-center gap-0.5">
                        {l.isTemporary && <Badge tone="blue">臨時</Badge>}
                        {l.isOnePackage && <Badge tone="green">一包化</Badge>}
                        {l.isOffLabel && <Badge tone="amber">適応外</Badge>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => removeLine(l.key)} className="text-alert" title="削除">
                        <Icon name="x" size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="border-t border-line p-3">
          {effectiveBlocked.size > 0 && (
            <p className="mb-2 rounded border border-alert bg-alert/10 px-2 py-1.5 text-2xs text-alert">
              院外内服の投与日数または用法が未入力の行（赤）があります。補完するまで保存できません（FR-RXSAFE-03）。
            </p>
          )}
          {msg && <p className="mb-2 text-2xs text-info">{msg}</p>}
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              className="flex-1 justify-center"
              disabled={pending || lines.length === 0 || effectiveBlocked.size > 0}
              onClick={issue}
            >
              {pending ? '処理中…' : '発行＋安全チェック'}
            </Button>
            {hasOutOfHouse && (
              <Badge tone="amber">院外処方を含む（処方箋発行）</Badge>
            )}
          </div>

          {result && (
            <div className="mt-3 border-t border-line pt-2">
              <div className="mb-1 text-xs font-bold">
                安全チェック結果:{' '}
                {result.overall === 'BLOCKED' ? (
                  <Badge tone="red">ブロック</Badge>
                ) : result.overall === 'WARNING' ? (
                  <Badge tone="amber">警告</Badge>
                ) : (
                  <Badge tone="green">問題なし</Badge>
                )}
              </div>
              {result.note && <p className="mb-1 text-2xs text-muted">{result.note}</p>}
              {result.findings.map((f, i) => {
                const rid = result.persistedIds[i] ?? `f-${i}`;
                const tone = f.result === 'BLOCKED' ? 'red' : f.result === 'WARNING' ? 'amber' : 'green';
                return (
                  <div key={rid} className="mb-1 rounded border border-line p-1.5 text-xs">
                    <Badge tone={tone as 'red' | 'amber' | 'green'}>{f.checkType}</Badge>
                    <div className="mt-0.5">{f.message}</div>
                    {f.result === 'BLOCKED' && (
                      <input
                        placeholder="解除理由（必須・監査記録）"
                        value={reasons[rid] ?? ''}
                        onChange={(e) => setReasons((s) => ({ ...s, [rid]: e.target.value }))}
                        className="mt-1 w-full rounded border border-alert px-1.5 py-1"
                      />
                    )}
                  </div>
                );
              })}
              <Button
                size="sm"
                variant="primary"
                className="mt-1 w-full justify-center"
                disabled={pending}
                onClick={doConfirm}
              >
                処方を確定
              </Button>
              {confirmMsg && (
                <p className="mt-1 text-xs">
                  {confirmMsg}{' '}
                  {confirmMsg.startsWith('処方を確定') && result.prescriptionId && (
                    <a
                      className="text-info underline"
                      href={`/print/prescription/${result.prescriptionId}`}
                      target="_blank"
                    >
                      処方箋印刷 →
                    </a>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
