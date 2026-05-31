'use client';
import * as React from 'react';
import { judgeLabFlag, LAB_FLAG_LABEL, type LabFlag } from '@medixus/domain';

/**
 * 検査結果ビューア（時系列＋基準値色分け＋簡易トレンド＋O欄転記） — FR-LAB-01。
 * 基準値逸脱判定は domain の純関数 `judgeLabFlag`（ExamMaster.refLow/refHigh）に委譲。
 *
 * データ源は2系統:
 *  1. `series` prop（実 LabResult 由来・/labs や将来のチャートローダから注入）。
 *  2. prop 未指定時は患者ID由来の決定論サンプル（DB未接続でも画面が必ず出る）。
 *     実検査は検査部門システム連携（IF-EXT-04／CTOバックエンド領域）で実データに置換。
 *
 * O欄転記（AC(3)）: SOAP エディタ本体は親（workspace）が保持し本コンポーネントから
 * 直接書き込めないため、整形済みの「O欄文」をクリップボードへコピーする方式で実現。
 * 医師はO欄にペーストするだけで時系列の検査所見を客観的所見へ取り込める。
 */

/** 1項目の時系列（呼び元が実データを渡す場合の形）。 */
export interface LabSeries {
  name: string;
  unit: string;
  refLow?: number | null;
  refHigh?: number | null;
  /** 採取日時の昇順を推奨（H/L判定は値ごと、表示は与えられた順）。 */
  points: { label: string; value: number | null }[];
}

interface LabDef {
  name: string;
  unit: string;
  low: number;
  high: number;
  base: number;
  amp: number;
  digits?: number;
}
const PANEL: LabDef[] = [
  { name: 'WBC', unit: '10³/µL', low: 3.3, high: 8.6, base: 6.2, amp: 3.5 },
  { name: 'Hb', unit: 'g/dL', low: 13.7, high: 16.8, base: 13.9, amp: 2.6, digits: 1 },
  { name: 'Plt', unit: '10⁴/µL', low: 15.8, high: 34.8, base: 23, amp: 12 },
  { name: 'AST', unit: 'U/L', low: 13, high: 30, base: 26, amp: 22 },
  { name: 'ALT', unit: 'U/L', low: 10, high: 42, base: 30, amp: 30 },
  { name: 'Cr', unit: 'mg/dL', low: 0.65, high: 1.07, base: 0.95, amp: 0.5, digits: 2 },
  { name: 'eGFR', unit: 'mL/min', low: 60, high: 120, base: 68, amp: 25 },
  { name: 'Na', unit: 'mEq/L', low: 138, high: 145, base: 140, amp: 5 },
  { name: 'K', unit: 'mEq/L', low: 3.6, high: 4.8, base: 4.1, amp: 0.9, digits: 1 },
  { name: 'CRP', unit: 'mg/dL', low: 0, high: 0.14, base: 0.3, amp: 1.6, digits: 2 },
  { name: 'HbA1c', unit: '%', low: 4.9, high: 6.0, base: 6.4, amp: 1.4, digits: 1 },
  { name: 'Glu', unit: 'mg/dL', low: 73, high: 109, base: 118, amp: 45 },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 患者ID由来の決定論サンプル系列を生成（DB未接続フォールバック）。 */
function sampleSeries(patientId: string): LabSeries[] {
  const seed = hash(patientId);
  const N = 4;
  const labels = Array.from({ length: N }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (N - 1 - i) * 14);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  return PANEL.map((def, idx) => {
    const points = Array.from({ length: N }, (_, i) => {
      const r = ((seed >> ((idx + i) % 16)) % 1000) / 1000; // 0..1 deterministic
      const v = def.base + (r - 0.5) * 2 * def.amp;
      const d = def.digits ?? (def.high < 10 ? 1 : 0);
      return { label: labels[i]!, value: Number(v.toFixed(d)) };
    });
    return { name: def.name, unit: def.unit, refLow: def.low, refHigh: def.high, points };
  });
}

const flagClass: Record<LabFlag, string> = {
  H: 'font-bold text-alert',
  L: 'font-bold text-info',
  N: '',
};

export function LabResultsPanel({
  patientId,
  series,
}: {
  patientId: string;
  /** 実データ系列（未指定なら患者ID由来の決定論サンプル）。 */
  series?: LabSeries[];
}) {
  const rows = series && series.length > 0 ? series : sampleSeries(patientId);
  const isSample = !(series && series.length > 0);
  const [copied, setCopied] = React.useState(false);

  // 各列ラベル（最初の行のラベル列を見出しに採用）。
  const labels = rows[0]?.points.map((p) => p.label) ?? [];

  /** 最新時点で基準値を逸脱した項目をO欄文に整形（時系列の文脈付き）。 */
  const buildOText = (): string => {
    const today = new Date();
    const head = `【検査結果】${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} 時点`;
    const lines = rows
      .map((r) => {
        const valid = r.points.filter(
          (p): p is { label: string; value: number } => p.value !== null && p.value !== undefined,
        );
        if (valid.length === 0) return null;
        const last = valid[valid.length - 1]!;
        const flag = judgeLabFlag(last.value, r.refLow, r.refHigh);
        const mark = flag === 'H' ? ' H↑' : flag === 'L' ? ' L↓' : '';
        // 推移（最大4点まで）を併記して時系列の客観所見にする。
        const trail = valid.slice(-4).map((p) => p.value).join('→');
        const trend = valid.length > 1 ? `（推移 ${trail}）` : '';
        return { line: `${r.name} ${last.value}${r.unit ? ` ${r.unit}` : ''}${mark}${trend}`, abnormal: !!mark };
      })
      .filter((x): x is { line: string; abnormal: boolean } => x !== null);
    const abnormal = lines.filter((l) => l.abnormal);
    const body = (abnormal.length > 0 ? abnormal : lines).map((l) => `・${l.line}`).join('\n');
    const note = abnormal.length > 0 ? '' : '\n（基準値逸脱なし）';
    return `${head}\n${body}${note}`;
  };

  const transcribe = async () => {
    const text = buildOText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // クリップボード不可環境（非HTTPS等）: フォールバックで選択用テキストを提示。
      window.prompt('O欄へ貼り付けてください（Ctrl/Cmd+C でコピー）', text);
    }
  };

  return (
    <div className="text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-2xs text-muted">
          {isSample ? `最新${labels.length}回（2週間隔・サンプル）` : `最新${labels.length}回`}
        </span>
        <span className="text-2xs text-muted/70">基準外= 赤H / 青L</span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-soft text-2xs text-muted">
            <th className="px-1.5 py-1 text-left">項目</th>
            {labels.map((d, i) => (
              <th key={`${d}-${i}`} className="px-1 py-1 text-right">
                {d}
              </th>
            ))}
            <th className="px-1 py-1 text-center">推移</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const vals = r.points
              .map((p) => p.value)
              .filter((v): v is number => v !== null && v !== undefined);
            const min = vals.length ? Math.min(...vals) : 0;
            const max = vals.length ? Math.max(...vals) : 1;
            const n = r.points.length;
            const sx = (i: number) => (n <= 1 ? 18 : (36 * i) / (n - 1));
            const sy = (v: number) => (max === min ? 8 : 14 - ((v - min) / (max - min)) * 12);
            const linePts = r.points
              .map((p, i) => (p.value === null || p.value === undefined ? null : `${sx(i)},${sy(p.value)}`))
              .filter((x): x is string => x !== null)
              .join(' ');
            return (
              <tr key={r.name} className="border-t border-line/60">
                <td className="px-1.5 py-1">
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-1 text-2xs text-muted">{r.unit}</span>
                </td>
                {r.points.map((p, i) => {
                  const flag = judgeLabFlag(p.value, r.refLow, r.refHigh);
                  const cls = flag ? flagClass[flag] : '';
                  const suffix = flag === 'H' ? 'H' : flag === 'L' ? 'L' : '';
                  return (
                    <td
                      key={i}
                      className={`px-1 py-1 text-right tabular-nums ${cls}`}
                      title={flag ? LAB_FLAG_LABEL[flag] : undefined}
                    >
                      {p.value === null || p.value === undefined ? '—' : p.value}
                      {suffix}
                    </td>
                  );
                })}
                <td className="px-1 py-1">
                  <svg viewBox="0 0 36 16" width="40" height="16">
                    {linePts && (
                      <polyline points={linePts} fill="none" stroke="#0b5f37" strokeWidth="1.2" />
                    )}
                  </svg>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={transcribe}
          className="rounded border border-accent-300 bg-accent-50 px-2 py-1 text-2xs font-semibold text-accent-700 hover:bg-accent-100"
          title="基準値逸脱を中心に検査所見をO欄文へ整形し、クリップボードへコピーします"
        >
          {copied ? '✓ コピーしました（O欄へ貼付）' : 'O欄へ転記（コピー）'}
        </button>
        {isSample && (
          <span className="text-2xs text-muted/70">※ サンプル。検査連携で実値に置換</span>
        )}
      </div>
    </div>
  );
}
