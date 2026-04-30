'use client';

/**
 * DenseTable — FAZA FE-3 (2026-04-26)
 *
 * Generic dense data-table primitive for institutional UI. Mass-screening
 * surface: 24-32px rows, monospace numerics, sticky header, basic sort.
 *
 * Inherits .table-wrap + th/td styles from globals.css. Adds:
 *  - density wrapper class (--row-h-* tokens consumed by inner td height)
 *  - per-column right-align for numeric cells
 *  - click-to-sort for columns marked sortable
 *
 * Pure additive — no breaking changes to existing tables.
 *
 * Asumptie: T extends Record<string, unknown>. Caller supplies stable row keys
 * via `rowKey` prop OR ensures `id` field exists.
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Column<T> = {
  key: keyof T & string;
  label: string;
  /** Optional custom renderer. Falls back to String(row[key]). */
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string | number;
  sortable?: boolean;
  /** Override for numeric sort comparator. Default Number(value). */
  sortValue?: (row: T) => number | string;
};

type Density = 'compact' | 'normal' | 'spacious';
type SortDir = 'asc' | 'desc';

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  density?: Density;
  /** Stable row identity. Default: row.id || JSON index. */
  rowKey?: (row: T, i: number) => string | number;
  /** Empty-state copy. */
  emptyLabel?: string;
  /** Max table height (px). Default 480 (scrollable). */
  maxHeight?: number;
  className?: string;
  /** Callback on row click (drill-down). */
  onRowClick?: (row: T) => void;
};

export default function DenseTable<T extends Record<string, unknown>>({
  columns,
  rows,
  density = 'normal',
  rowKey,
  emptyLabel = 'No data',
  maxHeight = 480,
  className = '',
  onRowClick,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find(c => c.key === sortKey);
    if (!col) return rows;
    const get = col.sortValue ?? ((r: T) => {
      const v = r[col.key];
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : String(v ?? '');
    });
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, columns, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  return (
    <div
      className={`table-wrap density-${density} ${className}`}
      style={{ maxHeight, overflowY: 'auto', overflowX: 'auto' }}
    >
      <table>
        <thead>
          <tr>
            {columns.map(col => {
              const isSorted = sortKey === col.key;
              const align = col.align ?? 'left';
              return (
                <th
                  key={col.key}
                  style={{
                    textAlign: align,
                    width: col.width,
                    cursor: col.sortable ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {col.label}
                  {isSorted && (
                    <span style={{ marginLeft: 4, color: 'var(--accent-blue)' }}>
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                {emptyLabel}
              </td>
            </tr>
          ) : (
            sortedRows.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row, i) : (typeof row.id === 'string' || typeof row.id === 'number' ? row.id : i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{ cursor: onRowClick ? 'pointer' : 'default' }}
              >
                {columns.map(col => {
                  const align = col.align ?? 'left';
                  const content = col.render ? col.render(row) : String(row[col.key] ?? '');
                  return (
                    <td key={col.key} style={{ textAlign: align, height: 'var(--row-h, 32px)' }}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
