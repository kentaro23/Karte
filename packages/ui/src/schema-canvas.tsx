'use client';
import * as React from 'react';
import { cn } from './cn.js';
import { Button } from './primitives.js';
import { Icon } from './icon.js';

/** 1ストローク = 正規化座標(0〜1)の点列 + 色 */
export interface SchemaStroke {
  color: string;
  points: { x: number; y: number }[];
}

const PEN_COLORS: { value: string; label: string }[] = [
  { value: '#8a2b2b', label: '赤' },
  { value: '#174a7c', label: '青' },
  { value: '#0b5f37', label: '緑' },
  { value: '#1a1a1a', label: '黒' },
];

/**
 * シェーマ注釈キャンバス — 背景画像(人体図など)に手描き注釈を重ねる簡易キャンバス。
 * ストロークは正規化座標で保持し onChange(strokesJson) でJSON文字列を返す。
 */
export function SchemaCanvas({
  imageUrl,
  value,
  onChange,
  width = 360,
  height = 480,
  readOnly = false,
  className,
}: {
  /** 背景人体図などの画像URL */
  imageUrl?: string;
  /** ストローク配列のJSON文字列（SchemaStroke[]） */
  value?: string;
  onChange?: (strokesJson: string) => void;
  width?: number;
  height?: number;
  readOnly?: boolean;
  className?: string;
}) {
  const parse = React.useCallback((json?: string): SchemaStroke[] => {
    if (!json) return [];
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? (v as SchemaStroke[]) : [];
    } catch {
      return [];
    }
  }, []);

  const [strokes, setStrokes] = React.useState<SchemaStroke[]>(() => parse(value));
  const [color, setColor] = React.useState(PEN_COLORS[0]!.value);
  const drawing = React.useRef<SchemaStroke | null>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  // 外部 value 変更に追従（編集中でなければ）
  React.useEffect(() => {
    if (!drawing.current) setStrokes(parse(value));
  }, [value, parse]);

  const commit = (next: SchemaStroke[]) => {
    setStrokes(next);
    onChange?.(JSON.stringify(next));
  };

  const toLocal = (e: React.PointerEvent) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = { color, points: [toLocal(e)] };
    setStrokes((s) => [...s, drawing.current!]);
  };
  const onMove = (e: React.PointerEvent) => {
    if (readOnly || !drawing.current) return;
    drawing.current.points.push(toLocal(e));
    setStrokes((s) => [...s.slice(0, -1), { ...drawing.current! }]);
  };
  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = null;
    commit(strokes);
  };

  const undo = () => commit(strokes.slice(0, -1));
  const clear = () => commit([]);

  const toPath = (st: SchemaStroke) =>
    st.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * width).toFixed(1)},${(p.y * height).toFixed(1)}`)
      .join(' ');

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <span className="text-2xs font-bold uppercase tracking-wider text-muted">ペン</span>
          {PEN_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setColor(c.value)}
              aria-label={c.label}
              title={c.label}
              className={cn(
                'h-5 w-5 rounded-full border transition-transform',
                color === c.value ? 'border-ink scale-110 ring-2 ring-accent-100' : 'border-line',
              )}
              style={{ background: c.value }}
            />
          ))}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={undo} disabled={strokes.length === 0}>
            <Icon name="refresh" size={13} /> 戻す
          </Button>
          <Button size="sm" variant="danger" onClick={clear} disabled={strokes.length === 0}>
            <Icon name="x" size={13} /> 全消去
          </Button>
        </div>
      )}
      <div
        ref={surfaceRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        style={{ width, height }}
        className={cn(
          'relative select-none overflow-hidden rounded-card border border-line bg-white',
          !readOnly && 'cursor-crosshair touch-none',
        )}
      >
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="シェーマ背景"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-90"
          />
        )}
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="pointer-events-none absolute inset-0"
        >
          {strokes.map((st, i) =>
            st.points.length === 1 ? (
              <circle key={i} cx={st.points[0]!.x * width} cy={st.points[0]!.y * height} r={1.6} fill={st.color} />
            ) : (
              <path
                key={i}
                d={toPath(st)}
                fill="none"
                stroke={st.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ),
          )}
        </svg>
      </div>
    </div>
  );
}
