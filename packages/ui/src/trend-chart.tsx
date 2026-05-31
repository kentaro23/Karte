'use client';
import * as React from 'react';
import { cn } from './cn.js';

export interface TrendPoint {
  /** X軸ラベル（日付など）。表示と等間隔プロットに使用 */
  label: string;
  value: number;
}

/**
 * 数値時系列の折れ線グラフ — 基準値帯(refLow〜refHigh)付き、SVGで軽量描画。
 * 基準値を逸脱した点は警告色で強調。検査結果トレンド等に利用。
 */
export function TrendChart({
  points,
  refLow,
  refHigh,
  unit,
  width = 320,
  height = 120,
  className,
}: {
  points: TrendPoint[];
  /** 基準値下限 */
  refLow?: number;
  /** 基準値上限 */
  refHigh?: number;
  unit?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 18;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = Math.max(1, height - padT - padB);

  const vals = points.map((p) => p.value);
  const candidates = [...vals, refLow, refHigh].filter((v): v is number => v != null);
  let min = candidates.length ? Math.min(...candidates) : 0;
  let max = candidates.length ? Math.max(...candidates) : 1;
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  // 上下に5%の余白
  min -= span * 0.05;
  max += span * 0.05;

  const x = (i: number) =>
    padL + (points.length <= 1 ? innerW / 2 : (innerW * i) / (points.length - 1));
  const y = (v: number) => padT + innerH * (1 - (v - min) / (max - min));

  const inRef = (v: number) =>
    (refLow == null || v >= refLow) && (refHigh == null || v <= refHigh);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  const bandTop = refHigh != null ? y(refHigh) : padT;
  const bandBottom = refLow != null ? y(refLow) : padT + innerH;
  const hasBand = refLow != null || refHigh != null;

  if (points.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center rounded border border-line bg-soft text-2xs text-muted', className)}
        style={{ width, height }}
      >
        データなし
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label="数値トレンドグラフ"
    >
      {/* 基準値帯 */}
      {hasBand && (
        <rect
          x={padL}
          y={Math.min(bandTop, bandBottom)}
          width={innerW}
          height={Math.abs(bandBottom - bandTop)}
          className="fill-accent-50"
        />
      )}
      {refHigh != null && (
        <line x1={padL} y1={y(refHigh)} x2={width - padR} y2={y(refHigh)} className="stroke-accent-200" strokeDasharray="3 3" />
      )}
      {refLow != null && (
        <line x1={padL} y1={y(refLow)} x2={width - padR} y2={y(refLow)} className="stroke-accent-200" strokeDasharray="3 3" />
      )}
      {/* Y軸目盛（min/max） */}
      <text x={padL - 4} y={padT + 4} textAnchor="end" className="fill-muted text-[9px]">
        {fmt(max)}
      </text>
      <text x={padL - 4} y={height - padB} textAnchor="end" className="fill-muted text-[9px]">
        {fmt(min)}
      </text>
      {/* 折れ線 */}
      <path d={line} fill="none" className="stroke-accent-500" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {/* データ点 */}
      {points.map((p, i) => {
        const ok = inRef(p.value);
        return (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r={2.8}
              className={ok ? 'fill-accent-600' : 'fill-alert'}
            >
              <title>
                {p.label}: {p.value}
                {unit ? ` ${unit}` : ''}
                {ok ? '' : '（基準値外）'}
              </title>
            </circle>
          </g>
        );
      })}
      {/* X軸ラベル（最初と最後のみ・過密回避） */}
      <text x={x(0)} y={height - 4} textAnchor="start" className="fill-muted text-[9px]">
        {points[0]?.label}
      </text>
      {points.length > 1 && (
        <text x={x(points.length - 1)} y={height - 4} textAnchor="end" className="fill-muted text-[9px]">
          {points[points.length - 1]?.label}
        </text>
      )}
    </svg>
  );
}

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}
