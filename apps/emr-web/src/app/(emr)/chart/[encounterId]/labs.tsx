'use client';
import * as React from 'react';

/**
 * 検査結果ビューア（時系列＋基準値色分け＋簡易トレンド）。
 * ※実検査は検査部門システム連携（CTOバックエンド領域）。ここは患者ID由来の
 *   決定論サンプルでUIを提示（実装は連携で実データに置換）。
 */
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

export function LabResultsPanel({ patientId }: { patientId: string }) {
  const seed = hash(patientId);
  const N = 4;
  const dates = Array.from({ length: N }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (N - 1 - i) * 14);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const rows = PANEL.map((def, idx) => {
    const series = Array.from({ length: N }, (_, i) => {
      const r = ((seed >> ((idx + i) % 16)) % 1000) / 1000; // 0..1 deterministic
      const v = def.base + (r - 0.5) * 2 * def.amp;
      const d = def.digits ?? (def.high < 10 ? 1 : 0);
      return Number(v.toFixed(d));
    });
    return { def, series };
  });

  return (
    <div className="text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-2xs text-muted">最新4回（2週間隔・サンプル）</span>
        <span className="text-2xs text-muted/70">基準外= 赤H / 青L</span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-soft text-2xs text-muted">
            <th className="px-1.5 py-1 text-left">項目</th>
            {dates.map((d) => (
              <th key={d} className="px-1 py-1 text-right">
                {d}
              </th>
            ))}
            <th className="px-1 py-1 text-center">推移</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ def, series }) => {
            const min = Math.min(...series);
            const max = Math.max(...series);
            const sx = (i: number) => (series.length <= 1 ? 18 : (36 * i) / (series.length - 1));
            const sy = (v: number) => (max === min ? 8 : 14 - ((v - min) / (max - min)) * 12);
            return (
              <tr key={def.name} className="border-t border-line/60">
                <td className="px-1.5 py-1">
                  <span className="font-medium">{def.name}</span>
                  <span className="ml-1 text-2xs text-muted">{def.unit}</span>
                </td>
                {series.map((v, i) => {
                  const hi = v > def.high;
                  const lo = v < def.low;
                  return (
                    <td
                      key={i}
                      className={`px-1 py-1 text-right tabular-nums ${
                        hi ? 'font-bold text-alert' : lo ? 'font-bold text-info' : ''
                      }`}
                    >
                      {v}
                      {hi ? 'H' : lo ? 'L' : ''}
                    </td>
                  );
                })}
                <td className="px-1 py-1">
                  <svg viewBox="0 0 36 16" width="40" height="16">
                    <polyline
                      points={series.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}
                      fill="none"
                      stroke="#0b5f37"
                      strokeWidth="1.2"
                    />
                  </svg>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-2xs text-muted/70">
        ※ サンプル表示。検査部門システム連携で実検査値に置換（CTO実装範囲）。
      </p>
    </div>
  );
}
