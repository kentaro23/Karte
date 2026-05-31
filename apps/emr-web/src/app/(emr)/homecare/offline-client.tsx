'use client';
import * as React from 'react';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, Textarea, EmptyState } from '@medixus/ui';
import type { SyncedVisitRecord, SyncOutcome } from './actions';

/**
 * FR-HOM-01 訪問診療・タブレットオフライン入力 → 復帰後同期（client島）。
 *
 * AC1：オフラインで記録し、復帰後に同期できる。
 *   - 訪問先（電波圏外想定）でも記録できるよう、入力は即 localStorage キューに積む。
 *     サーバー往復に依存しない（オフラインでも確実に保存される）。
 *   - オンライン復帰を navigator.onLine + online/offline イベントで検知し、
 *     「未同期キュー」をサーバーアクション syncOfflineRecords へ一括 POST。
 *     成功した clientId をキューから除去（冪等・部分成功対応）。
 *
 * フロントのみモード（DB未接続）でも：
 *   - localStorage への蓄積／表示／編集は完全動作（端末内で完結）。
 *   - 同期はサーバー側が STUB を返すためキューは保持され、UI にその旨を表示。
 */

const LS_QUEUE = 'mx.homecare.offlineQueue.v1';

export type PatientOpt = { id: string; label: string };

const VISIT_KINDS: { value: string; label: string }[] = [
  { value: 'DOCTOR', label: '医師訪問診療' },
  { value: 'NURSE', label: '訪問看護' },
  { value: 'CARE_GUIDANCE', label: '居宅療養管理指導' },
  { value: 'REHAB', label: '訪問リハビリ' },
];

function visitKindLabel(v: string): string {
  return VISIT_KINDS.find((k) => k.value === v)?.label ?? v;
}

/** localStorage からキューを安全に読む（壊れ値は捨てる）。 */
function readQueue(): SyncedVisitRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_QUEUE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is SyncedVisitRecord =>
        !!r && typeof r.clientId === 'string' && typeof r.patientId === 'string',
    );
  } catch {
    return [];
  }
}

function writeQueue(q: SyncedVisitRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_QUEUE, JSON.stringify(q));
  } catch (err) {
    console.error('[homecare] queue persist failed:', err);
  }
}

function newClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* fallthrough */
  }
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP');
  } catch {
    return iso;
  }
}

export function OfflineVisitClient({
  patients,
  syncAction,
  dbDown,
}: {
  patients: PatientOpt[];
  /** サーバーアクション：キューを渡し、同期できた clientId を返す。 */
  syncAction: (records: SyncedVisitRecord[]) => Promise<SyncOutcome>;
  dbDown: boolean;
}) {
  const [queue, setQueue] = React.useState<SyncedVisitRecord[]>([]);
  const [online, setOnline] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);

  // 入力フォーム state。
  const firstPatient = patients[0]?.id ?? '';
  const [patientId, setPatientId] = React.useState(firstPatient);
  const [visitKind, setVisitKind] = React.useState('DOCTOR');
  const [vitals, setVitals] = React.useState('');
  const [note, setNote] = React.useState('');

  const flashToast = React.useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  // 初期化：キュー復元＋オンライン状態の購読。
  React.useEffect(() => {
    setMounted(true);
    setQueue(readQueue());
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // 同期実行（手動／自動共通）。成功 clientId をキューから除去。
  const runSync = React.useCallback(
    async (records: SyncedVisitRecord[]) => {
      if (records.length === 0) return;
      setSyncing(true);
      try {
        const res = await syncAction(records);
        if (res.syncedIds.length > 0) {
          setQueue((prev) => {
            const next = prev.filter((r) => !res.syncedIds.includes(r.clientId));
            writeQueue(next);
            return next;
          });
        }
        flashToast(res.message);
      } catch (err) {
        console.error('[homecare] sync failed:', err);
        flashToast('同期に失敗しました。通信状況を確認してください。キューは保持されます。');
      } finally {
        setSyncing(false);
      }
    },
    [syncAction, flashToast],
  );

  // オンライン復帰時の自動同期（AC1 の核心）。
  // mounted 後、online かつ未同期キューがあり、未同期中なら自動で流す。
  const prevOnline = React.useRef(true);
  React.useEffect(() => {
    if (!mounted) return;
    const justCameOnline = online && !prevOnline.current;
    prevOnline.current = online;
    if (justCameOnline && queue.length > 0 && !syncing) {
      void runSync(queue);
    }
  }, [online, mounted, queue, syncing, runSync]);

  // 訪問録をキューに積む（即 localStorage 保存：オフラインでも確実）。
  const addToQueue = React.useCallback(() => {
    if (!patientId || !note.trim()) {
      flashToast('患者と記録本文は必須です。');
      return;
    }
    const rec: SyncedVisitRecord = {
      clientId: newClientId(),
      patientId,
      visitKind,
      visitedAt: new Date().toISOString(),
      note: note.trim(),
      vitals: vitals.trim() || undefined,
    };
    setQueue((prev) => {
      const next = [rec, ...prev];
      writeQueue(next);
      return next;
    });
    setNote('');
    setVitals('');
    flashToast(
      online
        ? '記録を保存しました（オンライン：下の「今すぐ同期」または自動同期で送信）。'
        : 'オフライン保存しました。オンライン復帰時に自動同期されます。',
    );
  }, [patientId, visitKind, vitals, note, online, flashToast]);

  const removeFromQueue = React.useCallback((clientId: string) => {
    setQueue((prev) => {
      const next = prev.filter((r) => r.clientId !== clientId);
      writeQueue(next);
      return next;
    });
  }, []);

  const patientLabel = React.useCallback(
    (id: string) => patients.find((p) => p.id === id)?.label ?? id,
    [patients],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* オンライン状態バー */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-line bg-soft/40 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <span
            className={
              'inline-block h-2.5 w-2.5 rounded-full ' + (online ? 'bg-accent-500' : 'bg-amber-400')
            }
          />
          {/* SSR/CSR 不一致回避：マウント前は中立表示 */}
          {!mounted ? '接続状態を確認中…' : online ? 'オンライン' : 'オフライン（圏外）'}
        </span>
        <Badge tone={queue.length > 0 ? 'amber' : 'gray'}>未同期 {mounted ? queue.length : 0} 件</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => runSync(queue)}
            disabled={!mounted || !online || syncing || queue.length === 0}
          >
            <Icon name="refresh" size={13} /> {syncing ? '同期中…' : '今すぐ同期'}
          </Button>
        </div>
      </div>
      {toast && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-2xs text-info">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {/* 訪問録入力（タブレット） */}
        <Panel>
          <PanelHeader title="訪問録 入力" desc="圏外でも保存可" icon={<Icon name="edit" size={15} />} />
          <div className="flex flex-col gap-3">
            <Field label="患者" required>
              <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                {patients.length === 0 && <option value="">（患者なし）</option>}
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="訪問種別">
              <Select value={visitKind} onChange={(e) => setVisitKind(e.target.value)}>
                {VISIT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="バイタル" hint="例：BP 128/76 / HR 72 / SpO2 97% / BT 36.5">
              <Input
                value={vitals}
                onChange={(e) => setVitals(e.target.value)}
                placeholder="任意"
              />
            </Field>
            <Field label="訪問記録（S/O/A/P）" required>
              <Textarea
                rows={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="主訴・所見・評価・計画を記載"
              />
            </Field>
            <Button variant="primary" onClick={addToQueue} disabled={!mounted}>
              <Icon name="check" size={13} /> 記録を保存（キューへ）
            </Button>
            <p className="text-2xs text-muted/70">
              保存は端末内（localStorage）に即時反映され、通信状態に依存しません。オンライン時は自動で同期されます。
            </p>
          </div>
        </Panel>

        {/* 未同期キュー一覧 */}
        <Panel pad={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Icon name="clock" size={15} /> 未同期キュー
            </span>
            <Badge tone={mounted && queue.length > 0 ? 'amber' : 'gray'}>
              {mounted ? queue.length : 0} 件
            </Badge>
          </div>
          {!mounted ? (
            <div className="px-4 py-6 text-center text-xs text-muted">読込中…</div>
          ) : queue.length === 0 ? (
            <EmptyState
              title="未同期の訪問録はありません"
              hint="左のフォームで記録するとここに積まれ、オンライン時に同期されます"
              icon={<Icon name="check" size={28} />}
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {queue.map((r) => (
                <li key={r.clientId} className="px-4 py-2.5">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {patientLabel(r.patientId)}
                      <Badge tone="blue">{visitKindLabel(r.visitKind)}</Badge>
                      <Badge tone="amber">未同期</Badge>
                    </span>
                    <span className="text-2xs text-muted">{fmt(r.visitedAt)}</span>
                  </div>
                  {r.vitals && <div className="text-2xs text-muted">バイタル：{r.vitals}</div>}
                  <p className="mt-0.5 whitespace-pre-wrap text-2xs leading-relaxed text-ink/80">
                    {r.note}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => runSync([r])}
                      disabled={!online || syncing}
                    >
                      <Icon name="refresh" size={12} /> この記録を同期
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeFromQueue(r.clientId)}>
                      <Icon name="x" size={12} /> 破棄
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {dbDown && mounted && queue.length > 0 && (
            <div className="border-t border-line px-4 py-2 text-2xs text-warn">
              デモ表示（DB未接続）：同期はスタブ応答のためキューは端末に保持されます。
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
