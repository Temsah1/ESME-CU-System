import React, { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, type LucideIcon } from 'lucide-react';
import { ModalShell, useIsDesktop, useStickyNonNull } from '../../motion';
import { EmptyState } from '../EmptyState';

export type DataTableColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /**
   * Presentational cells cannot be sorted, so a column declares the value behind it.
   * A column without `sortValue` renders no sort control rather than guessing.
   */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'center' | 'right';
  /** Below the desktop breakpoint this column becomes the card title instead of a label line. */
  cardTitle?: boolean;
  cellClass?: string;
};

export type DataTableAction<T> = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Per-row eligibility — the caller drops the action entirely when a capability is missing. */
  hidden?: (row: T) => boolean;
  disabled?: (row: T) => boolean;
  danger?: boolean;
  /** Renders the label beside the icon. Without it the control is icon-only, named by its tooltip. */
  showLabel?: boolean;
  /** When present the press opens a confirmation dialog instead of acting immediately. */
  confirm?: { title: string; body: (row: T) => string; confirmLabel?: string };
  onClick: (row: T) => void;
};

export type DataTableProps<T> = {
  /**
   * Rows the caller is allowed to see. The primitive authorizes nothing — it searches, sorts,
   * pages and confirms whatever it is handed.
   */
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  /** Text haystack for one row. Providing it adds the search box. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** The caller's own filter controls, rendered beside the search box. */
  toolbar?: React.ReactNode;
  /**
   * Either a fixed set of actions or a derivation per row — a workflow whose available moves
   * depend on the row's state uses the function form.
   */
  actions?: DataTableAction<T>[] | ((row: T) => DataTableAction<T>[]);
  /** Rows per page; `0` renders every row. */
  pageSize?: number;
  empty: {
    title: string;
    description: string;
    icon?: React.ComponentType<{ className?: string }>;
    action?: React.ReactNode;
  };
  noMatchesLabel: string;
};

const ALIGN: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

type Sort<T> = { key: string; dir: 'asc' | 'desc'; column: DataTableColumn<T> };

function sortRows<T>(rows: T[], sort: Sort<T>): T[] {
  const value = sort.column.sortValue;
  if (!value) return rows;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const compared =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' });
    return sort.dir === 'asc' ? compared : -compared;
  });
}

/**
 * The one table shape every operational list uses: a search box and the caller's filters on
 * top, sortable headers, a page footer, a named action per row with a confirmation for the
 * destructive ones, and the same rows as cards below the desktop breakpoint so a 320px screen
 * scrolls the list instead of the page.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Search…',
  toolbar,
  actions,
  pageSize = 10,
  empty,
  noMatchesLabel,
}: DataTableProps<T>) {
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<Sort<T> | null>(null);
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState<{ action: DataTableAction<T>; row: T } | null>(null);
  const pendingConfirm = useStickyNonNull(confirming);
  const isDesktop = useIsDesktop();

  const needle = term.trim().toLowerCase();
  const visible =
    !searchText || needle === ''
      ? rows
      : rows.filter((row) => searchText(row).toLowerCase().includes(needle));
  const ordered = sort ? sortRows(visible, sort) : visible;

  const pages = pageSize > 0 ? Math.max(1, Math.ceil(ordered.length / pageSize)) : 1;
  // Derived, so a filter that shrinks the list cannot leave the footer pointing at an empty page.
  const currentPage = Math.min(page, pages - 1);
  const shown = pageSize > 0 ? ordered.slice(currentPage * pageSize, currentPage * pageSize + pageSize) : ordered;

  const actionsFor = (row: T) =>
    (typeof actions === 'function' ? actions(row) : (actions ?? [])).filter((action) => !action.hidden?.(row));
  // The column only exists if some row on this list actually offers something to do.
  const showActions = ordered.length > 0 && ordered.some((row) => actionsFor(row).length > 0);

  const toggleSort = (column: DataTableColumn<T>) => {
    if (!column.sortValue) return;
    setSort((prev) =>
      prev?.key === column.key
        ? prev.dir === 'asc'
          ? { key: column.key, dir: 'desc', column }
          : null
        : { key: column.key, dir: 'asc', column }
    );
    setPage(0);
  };

  if (rows.length === 0) {
    return <EmptyState {...empty} />;
  }

  const cardTitle = columns.find((c) => c.cardTitle);
  const cardLines = columns.filter((c) => c !== cardTitle);

  return (
    <div className="space-y-4">
      {(searchText || toolbar) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3">
          {searchText && (
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" aria-hidden />
              <input
                type="search"
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
              />
            </div>
          )}
          {toolbar}
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="text-xs text-slate-500 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-6 text-center">
          {noMatchesLabel}
        </p>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          {isDesktop ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    {columns.map((column) => {
                      const dir = sort?.key === column.key ? sort.dir : null;
                      return (
                        <th
                          key={column.key}
                          scope="col"
                          className={`py-3 px-4 ${ALIGN[column.align ?? 'left']}`}
                          aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                        >
                          {column.sortValue ? (
                            <button
                              onClick={() => toggleSort(column)}
                              className="inline-flex items-center gap-1 uppercase tracking-wider text-[10px] font-semibold hover:text-slate-800 dark:hover:text-slate-200"
                            >
                              {column.label}
                              {dir &&
                                (dir === 'asc' ? (
                                  <ArrowUp className="w-3 h-3" aria-hidden />
                                ) : (
                                  <ArrowDown className="w-3 h-3" aria-hidden />
                                ))}
                            </button>
                          ) : (
                            column.label
                          )}
                        </th>
                      );
                    })}
                    {showActions && (
                      <th scope="col" className="py-3 px-4 text-right">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {shown.map((row) => (
                    <tr key={rowKey(row)} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={`py-3.5 px-4 ${ALIGN[column.align ?? 'left']} ${column.cellClass ?? ''}`}
                        >
                          {column.render(row)}
                        </td>
                      ))}
                      {showActions && (
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-end gap-1.5">
                            {actionsFor(row).map((action) => (
                              <RowActionButton key={action.key} action={action} row={row} onRequest={setConfirming} />
                            ))}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map((row) => (
                <li key={rowKey(row)} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">{cardTitle ? cardTitle.render(row) : null}</div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {actionsFor(row).map((action) => (
                        <RowActionButton key={action.key} action={action} row={row} onRequest={setConfirming} />
                      ))}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {cardLines.map((column) => (
                      <div key={column.key} className="min-w-0">
                        <dt className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                          {column.label}
                        </dt>
                        <dd className={`mt-0.5 text-xs ${column.cellClass ?? ''}`}>{column.render(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}

          {pageSize > 0 && ordered.length > pageSize && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
              <span>
                Showing {currentPage * pageSize + 1}–{currentPage * pageSize + shown.length} of {ordered.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  aria-label="Previous page"
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden />
                </button>
                <span className="px-1 font-semibold">Page {currentPage + 1} of {pages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                  disabled={currentPage >= pages - 1}
                  aria-label="Next page"
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ModalShell
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl"
      >
        {pendingConfirm && (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{pendingConfirm.action.confirm?.title}</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              {pendingConfirm.action.confirm?.body(pendingConfirm.row)}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirming(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { action, row } = pendingConfirm;
                  setConfirming(null);
                  action.onClick(row);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white ${
                  pendingConfirm.action.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#123B60] hover:bg-[#0d2c48]'
                }`}
              >
                {pendingConfirm.action.confirm?.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </ModalShell>
    </div>
  );
}

function RowActionButton<T>({
  action,
  row,
  onRequest,
}: {
  action: DataTableAction<T>;
  row: T;
  onRequest: (next: { action: DataTableAction<T>; row: T } | null) => void;
}) {
  const Icon = action.icon;
  const disabled = action.disabled?.(row) ?? false;
  const labelled = action.showLabel ?? false;
  return (
    <button
      onClick={() => {
        if (disabled) return;
        if (action.confirm) onRequest({ action, row });
        else action.onClick(row);
      }}
      disabled={disabled}
      title={action.label}
      aria-label={labelled ? undefined : action.label}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${
        labelled
          ? action.danger
            ? 'border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20'
            : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
      } ${!labelled && action.danger ? 'hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20' : ''}`}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {labelled && action.label}
    </button>
  );
}

export default DataTable;
