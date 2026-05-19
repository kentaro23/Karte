'use client';
import * as React from 'react';
import { cn } from './cn.js';
import { EmptyState } from './primitives.js';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  accessor?: (row: T) => string | number | null | undefined;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  rowClassName,
  emptyTitle,
  dense = true,
  maxHeight,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyTitle?: string;
  dense?: boolean;
  maxHeight?: number | string;
}) {
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.accessor) return rows;
    return [...rows].sort((a, b) => {
      const av = col.accessor!(a);
      const bv = col.accessor!(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);

  const pad = dense ? 'px-2.5 py-1.5' : 'px-3 py-2.5';
  return (
    <div
      className="overflow-auto rounded border border-line"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-soft">
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                onClick={
                  c.sortable && c.accessor
                    ? () =>
                        setSort((s) =>
                          s?.key === c.key
                            ? { key: c.key, dir: s.dir === 1 ? -1 : 1 }
                            : { key: c.key, dir: 1 },
                        )
                    : undefined
                }
                className={cn(
                  'border-b border-line text-2xs font-bold uppercase tracking-wide text-muted whitespace-nowrap',
                  pad,
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  c.sortable && c.accessor && 'cursor-pointer select-none hover:text-ink',
                )}
              >
                {c.header}
                {sort?.key === c.key && <span className="ml-1">{sort.dir === 1 ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={getRowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-line/70 last:border-0',
                i % 2 ? 'bg-soft/40' : 'bg-white',
                onRowClick && 'cursor-pointer hover:bg-accent-50',
                rowClassName?.(row),
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    pad,
                    'align-middle text-ink',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                    c.className,
                  )}
                >
                  {c.render ? c.render(row) : String(c.accessor?.(row) ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState title={emptyTitle ?? 'データがありません'} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
