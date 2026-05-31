'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Panel, PanelHeader, Button, Badge, Icon, Select } from '@medixus/ui';
import {
  issueRxOrder,
  confirmRxOrder,
  loadLastPrescription,
  saveOrderSet,
  type RxLineInput,
  type DispenseType,
  type RxOrderSet,
} from './actions';
import {
  FALLBACK_USAGES,
  usageIsAsNeeded,
  usageDefaultTpd,
  type UsageOption,
} from './constants';
import { IndicationDialog, type IndicationTarget } from './indication-dialog';

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
/** 院外内服で日数必須なのに未入力 → 保存ブロック対象（FR-RXSAFE-03）。
 *  頓服判定は UsageMaster.isAsNeeded（usages）を第一の真実とする。 */
function lineNeedsDays(l: Line, usages: UsageOption[]): boolean {
  return (
    l.dispenseType === 'OUT_OF_HOUSE' &&
    isOralRoute(l.route) &&
    !usageIsAsNeeded(l.usage, usages)
  );
}
function lineHasError(l: Line, usages: UsageOption[]): boolean {
  if (!l.usage || !l.usage.trim()) return true;
  return lineNeedsDays(l, usages) && (!Number.isFinite(l.days) || l.days <= 0);
}

export function RxClient({
  patients,
  drugs,
  usages: usagesProp,
  initialSets,
}: {
  patients: Patient[];
  drugs: Drug[];
  /** 用法マスタ（UsageMaster 由来。未指定/空ならフォールバック）。 */
  usages?: UsageOption[];
  /** 永続化済みの処方セット（OrderSet kind:RX 由来）。 */
  initialSets?: RxOrderSet[];
}) {
  const router = useRouter();

  // 用法は UsageMaster（サーバ読込）を第一の真実に、空時のみフォールバック。
  const usages = React.useMemo<UsageOption[]>(
    () => (usagesProp && usagesProp.length > 0 ? usagesProp : FALLBACK_USAGES),
    [usagesProp],
  );

  const [patientId, setPatientId] = React.useState(patients[0]?.id ?? '');
  const [lines, setLines] = React.useState<Line[]>([]);

  // ── 行追加フォーム状態 ──
  const [query, setQuery] = React.useState('');
  const [drugId, setDrugId] = React.useState(drugs[0]?.id ?? '');
  const [dose, setDose] = React.useState(1);
  const [tpd, setTpd] = React.useState(usages[0]?.defaultTimesPerDay ?? 3);
  const [days, setDays] = React.useState(7);
  const [usage, setUsage] = React.useState(usages[0]?.value ?? '');
  const [dispense, setDispense] = React.useState<DispenseType>('IN_HOUSE');
  const [isTemporary, setIsTemporary] = React.useState(false);
  const [isOnePackage, setIsOnePackage] = React.useState(false);
  const [isOffLabel, setIsOffLabel] = React.useState(false);

  const [pending, start] = React.useTransition();
  // 呼び出したセットの識別子。発行時に Order.setId として記録（FR-RX-02）。
  // 値は永続化された OrderSet.id（既存 Order.setId 配線がそのまま生きる）。
  const [setIdInput, setSetIdInput] = React.useState<string | null>(null);
  // 処方セット一覧（OrderSet kind:RX）。初期値はサーバ読込。保存時に追記。
  const [savedSets, setSavedSets] = React.useState<RxOrderSet[]>(initialSets ?? []);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [blockedKeys, setBlockedKeys] = React.useState<Set<string>>(new Set());

  // ── 適応症ダイアログ（DISEASE_CONTRA 解消）状態 ──
  const [indicationTarget, setIndicationTarget] = React.useState<IndicationTarget | null>(null);
  // ダイアログで解消/強行した DISEASE_CONTRA finding を画面から畳むためのキー集合。
  const [resolvedFindingKeys, setResolvedFindingKeys] = React.useState<Set<string>>(new Set());

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

  // 用法を選ぶと内服回数を自動補完（UsageMaster.defaultTimesPerDay）。頓服/外用は日数任意。
  function pickUsage(v: string) {
    setUsage(v);
    const tpdDefault = usageDefaultTpd(v, usages);
    if (tpdDefault) setTpd(tpdDefault);
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

  // クライアント側の保存ブロック判定（即時赤表示）。頓服判定は UsageMaster 由来。
  const clientBlocked = React.useMemo(
    () => new Set(lines.filter((l) => lineHasError(l, usages)).map((l) => l.key)),
    [lines, usages],
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
      setResolvedFindingKeys(new Set()); // 新チェック結果なので解消マークをリセット
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

  // セット登録/呼出（OrderSet kind:RX へ本永続化 — Order.setId 連携）。
  function saveSet() {
    if (lines.length === 0) {
      setMsg('セットに保存する明細がありません。');
      return;
    }
    const name = `セット${savedSets.length + 1}（${lines.map((l) => l.drugName).slice(0, 2).join('・')}…）`;
    const snapshot = lines.map((l) => ({ ...l }));
    start(async () => {
      const r = await saveOrderSet({ name, lines: snapshot });
      if (!r.ok) {
        setMsg(r.error ?? 'セットの保存に失敗しました。');
        return;
      }
      // 永続化された OrderSet を一覧へ反映（呼出で Order.setId に使う id を保持）。
      const persistedLines = snapshot.map((l) => ({
        drugProductId: l.drugProductId,
        dosePerTime: l.dosePerTime,
        doseUnit: l.doseUnit,
        timesPerDay: l.timesPerDay,
        days: l.days,
        route: l.route,
        usage: l.usage,
        dispenseType: l.dispenseType,
        isTemporary: l.isTemporary,
        isOnePackage: l.isOnePackage,
        isOffLabel: l.isOffLabel,
      }));
      // デモ時は setId が null。一覧表示できるよう一時 id を採番（呼出時は Order.setId へ）。
      const newId = r.setId ?? `set-local-${Date.now()}`;
      setSavedSets((s) => [...s, { id: newId, name, lines: persistedLines }]);
      // 直近で保存したセットを「呼出中」にしておくと、続けて発行すれば setId が載る。
      setSetIdInput(r.setId);
      setMsg(r.note ?? '現在の処方を処方セットとして保存しました。');
    });
  }
  function loadSet(id: string) {
    const set = savedSets.find((s) => s.id === id);
    if (!set) return;
    // OrderSetItem には drugName が無い（usageCode/用量のみ）。表示名は薬剤マスタから解決。
    setLines(
      set.lines.map((l) => {
        const d = drugs.find((x) => x.id === l.drugProductId);
        return {
          key: newKey(),
          drugProductId: l.drugProductId,
          drugName: d?.brandName ?? '（薬剤）',
          dosePerTime: l.dosePerTime,
          doseUnit: l.doseUnit || d?.strengthUnit || '錠',
          timesPerDay: l.timesPerDay,
          days: l.days,
          route: l.route || d?.administrationRoute || 'PO',
          usage: l.usage,
          dispenseType: l.dispenseType,
          isTemporary: l.isTemporary,
          isOnePackage: l.isOnePackage,
          isOffLabel: l.isOffLabel,
        };
      }),
    );
    // 永続化 OrderSet.id のみ Order.setId に載せる（ローカル一時 id は載せない）。
    setSetIdInput(id.startsWith('set-local-') ? null : id);
    setMsg(`${set.name} を呼び出しました。`);
    setResult(null);
  }

  // 適応症ダイアログを開く（DISEASE_CONTRA finding から対象薬剤を解決）。
  function openIndicationDialog(finding: Finding, ruleCheckResultId: string | null) {
    if (!patientId) {
      setMsg('患者を選択してください');
      return;
    }
    // finding.message は engine 側で `${drugName}: …` 形式。薬剤名を取り出す。
    const idx = finding.message.indexOf(':');
    const drugName = (idx > 0 ? finding.message.slice(0, idx) : finding.message).trim();
    // 明細から該当薬剤の drugProductId を解決（名前一致 — 同名は先頭採用）。
    const line = lines.find((l) => l.drugName === drugName) ?? lines.find((l) => drugName.includes(l.drugName));
    setIndicationTarget({
      patientId,
      drugName,
      drugProductId: line?.drugProductId ?? '',
      ruleCheckResultId,
      prescriptionId: result?.prescriptionId ?? null,
    });
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
              {usages.map((u) => (
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
                const needDays = lineNeedsDays(l, usages);
                // 用法マスタに無い既存コード（セット/Do 由来）も選択肢に残す。
                const usageInMaster = usages.some((u) => u.value === l.usage);
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
                            timesPerDay: usageDefaultTpd(e.target.value, usages) ?? l.timesPerDay,
                          })
                        }
                        className="!w-28 !py-0.5 text-2xs"
                      >
                        {!usageInMaster && l.usage && <option value={l.usage}>{l.usage}</option>}
                        {usages.map((u) => (
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
                const rcrId = result.persistedIds[i] ?? null;
                const rid = rcrId ?? `f-${i}`;
                const tone = f.result === 'BLOCKED' ? 'red' : f.result === 'WARNING' ? 'amber' : 'green';
                // 適応症未付与（DISEASE_CONTRA WARNING）はワンクリック病名登録の導線を出す。
                const isUnindicated = f.checkType === 'DISEASE_CONTRA' && f.result === 'WARNING';
                const resolved = resolvedFindingKeys.has(rid);
                return (
                  <div
                    key={rid}
                    className={`mb-1 rounded border p-1.5 text-xs ${
                      resolved ? 'border-line bg-accent-50/60 opacity-70' : 'border-line'
                    }`}
                  >
                    <Badge tone={resolved ? 'green' : (tone as 'red' | 'amber' | 'green')}>
                      {f.checkType}
                    </Badge>
                    {resolved && <Badge tone="green">解消済</Badge>}
                    <div className="mt-0.5">{f.message}</div>
                    {isUnindicated && !resolved && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-1"
                        disabled={pending}
                        onClick={() => openIndicationDialog(f, rcrId)}
                      >
                        <Icon name="check" size={12} /> 適応症（病名）を登録
                      </Button>
                    )}
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

      {/* 適応症ワンクリック病名登録ダイアログ（DISEASE_CONTRA 解消）。
          確定で病名登録＆警告解消、強行で理由付きオーバーライド（いずれも当該行を畳む）。 */}
      <IndicationDialog
        open={indicationTarget !== null}
        target={indicationTarget}
        onClose={() => setIndicationTarget(null)}
        onResolved={({ resolved, overridden }) => {
          // 対象 RuleCheckResult.id を解消マーク（画面の当該 finding を畳む）。
          const rid = indicationTarget?.ruleCheckResultId;
          if ((resolved || overridden) && rid) {
            setResolvedFindingKeys((s) => new Set(s).add(rid));
          }
          if (resolved || overridden) {
            setMsg(
              resolved
                ? '適応症の病名を登録し、警告を解消しました。'
                : '病名を付けずに続行しました（理由を記録）。',
            );
            router.refresh();
          }
          // 解消時はダイアログを閉じる（強行時はダイアログ側で onClose 済み）。
          if (resolved) setIndicationTarget(null);
        }}
      />
    </div>
  );
}
