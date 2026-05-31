'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TrendChart } from '@medixus/ui';
import type { CategoryDatum, TrendDatum } from './actions';

/**
 * 経営ダッシュボード client 島（FR-ANL / G28）。
 * 時系列は共有 TrendChart（SVG軽量）を再利用、カテゴリ別は横棒バー、
 * 再診率はドーナツで可視化。集計値はサーバ（actions.loadAnalytics）から props で受領。
 * 期間トグルのみクライアント側で querystring を書き換え（サーバ再集計）。
 */

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const num = (n: number) => Math.round(n).toLocaleString('ja-JP');

// ── 期間トグル（直近 N ヶ月）────────────────────────────────────────────────
export function RangeToggle({ value }: { value: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const options = [3, 6, 12];
  const set = (m: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('months', String(m));
    router.push(`/analytics?${params.toString()}`);
  };
  return (
    <div className="inline-flex overflow-hidden rounded border border-line text-2xs">
      {options.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => set(m)}
          className={`px-2.5 py-1 font-semibold transition-colors ${
            m === value ? 'bg-accent-600 text-white' : 'bg-white text-muted hover:bg-soft'
          }`}
        >
          直近{m}ヶ月
        </button>
      ))}
    </div>
  );
}

// ── KPIカード ────────────────────────────────────────────────────────────────
export function KpiCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'accent' | 'warn';
}) {
  const ring =
    tone === 'accent' ? 'border-accent-200 bg-accent-50' : tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-line bg-white';
  return (
    <div className={`rounded-lg border p-3 ${ring}`}>
      <div className="text-2xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-2xs text-muted">{sub}</div>}
    </div>
  );
}

// ── 横棒バーチャート（疾患別・医師別）────────────────────────────────────────
export function BarList({ data, unit = '件' }: { data: CategoryDatum[]; unit?: string }) {
  const max = data.reduce((m, d) => Math.max(m, d.count), 0) || 1;
  if (data.length === 0) {
    return <div className="py-6 text-center text-2xs text-muted">データなし</div>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {data.map((d, i) => {
        const pct = (d.count / max) * 100;
        const isRest = d.label === 'その他';
        return (
          <li key={`${d.label}-${i}`} className="text-xs">
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className={`truncate ${isRest ? 'text-muted' : 'font-medium text-ink'}`} title={d.label}>
                {d.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                {num(d.count)}
                <span className="ml-0.5 text-2xs">{unit}</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-soft">
              <div
                className={`h-full rounded-full ${isRest ? 'bg-accent-200' : 'bg-accent-500'}`}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── 再診率ドーナツ ───────────────────────────────────────────────────────────
export function RevisitDonut({
  rate,
  first,
  ret,
}: {
  rate: number;
  first: number;
  ret: number;
}) {
  const pct = Math.round(rate * 100);
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = (rate * c).toFixed(1);
  return (
    <div className="flex items-center gap-4">
      <svg width={110} height={110} viewBox="0 0 110 110" role="img" aria-label={`再診率 ${pct}%`}>
        <circle cx={55} cy={55} r={r} fill="none" className="stroke-soft" strokeWidth={12} />
        <circle
          cx={55}
          cy={55}
          r={r}
          fill="none"
          className="stroke-accent-500"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c.toFixed(1)}`}
          transform="rotate(-90 55 55)"
        />
        <text x={55} y={52} textAnchor="middle" className="fill-ink text-[20px] font-bold">
          {pct}%
        </text>
        <text x={55} y={68} textAnchor="middle" className="fill-muted text-[9px]">
          再診率
        </text>
      </svg>
      <div className="text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent-500" />
          <span className="text-muted">再診</span>
          <span className="ml-auto tabular-nums font-medium text-ink">{num(ret)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-soft" />
          <span className="text-muted">初診</span>
          <span className="ml-auto tabular-nums font-medium text-ink">{num(first)}</span>
        </div>
        <p className="mt-2 max-w-[12rem] text-2xs text-muted/80">
          かかりつけ定着の指標。継続通院（再診）比率が高いほど慢性疾患フォローが機能。
        </p>
      </div>
    </div>
  );
}

// ── 時系列チャート（点数推移・収益推移）— 共有 TrendChart を再利用 ───────────
export function TrendBlock({
  points,
  unit,
  format = 'num',
}: {
  points: TrendDatum[];
  unit?: string;
  format?: 'num' | 'yen';
}) {
  const fmt = format === 'yen' ? yen : num;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const delta = last && prev ? last.value - prev.value : 0;
  const deltaPct = prev && prev.value !== 0 ? (delta / prev.value) * 100 : 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-lg font-bold tabular-nums text-ink">{last ? fmt(last.value) : '—'}</div>
        {last && prev && (
          <div className={`text-2xs font-semibold ${delta >= 0 ? 'text-accent-600' : 'text-alert'}`}>
            {delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(delta))}（{deltaPct >= 0 ? '+' : ''}
            {deltaPct.toFixed(1)}%）前月比
          </div>
        )}
      </div>
      <TrendChart points={points} unit={unit} width={420} height={140} className="w-full" />
    </div>
  );
}
