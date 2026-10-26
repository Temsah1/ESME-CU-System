import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckSquare,
  CornerDownLeft,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { scopeFor, type Capability } from '../../domain/roles';
import { ModalShell, durations, easings } from '../../motion';
import { NAV_ITEMS } from './nav';
import type { DashboardView } from './DashboardShell';

type Result = {
  key: string;
  section: string;
  label: string;
  /** Where selecting this actually takes the account — stated, never implied. */
  hint: string;
  icon: LucideIcon;
  run: () => void;
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: DashboardView) => void;
}

const MAX_ROWS_PER_SECTION = 6;

const iconOf = (view: DashboardView): LucideIcon => NAV_ITEMS.find((entry) => entry.id === view)?.icon ?? Search;

const ACTIONS: { label: string; view: DashboardView; capability: Capability }[] = [
  { label: 'Create a task', view: 'tasks', capability: 'tasks.write' },
  { label: 'Review submissions', view: 'submissions', capability: 'submissions.review' },
  { label: 'Record a bonus or warning', view: 'rewards', capability: 'rewards.write' },
  { label: 'Edit the website', view: 'website_cms', capability: 'cms.content.write' },
  { label: 'Change committee seats', view: 'committees', capability: 'committees.write' },
];

/** A needle of one word has to appear in one of these fields for the row to count as a match. */
function matches(needle: string, fields: (string | undefined)[]): boolean {
  if (!needle) return true;
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle));
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onNavigate }) => {
  const { users, tasks, committees, can } = useApp();
  const currentUser = useActor();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (view: DashboardView) => {
      onNavigate(view);
      onClose();
      // Cleared on the way out, not on open, so nothing is left of a previous search.
      setQuery('');
      setActive(0);
    },
    [onNavigate, onClose]
  );

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase();
    const out: Result[] = [];

    for (const entry of NAV_ITEMS) {
      if (entry.capability !== null && !can(entry.capability)) continue;
      if (!matches(needle, [entry.label, entry.group, entry.keywords])) continue;
      out.push({
        key: `page:${entry.id}`,
        section: 'Pages',
        label: entry.label,
        hint: entry.group,
        icon: entry.icon,
        run: () => go(entry.id),
      });
    }

    // Quick actions navigate to the screen that owns the form. A palette entry never performs a
    // write, so it can never claim one happened.
    for (const action of ACTIONS) {
      if (!can(action.capability)) continue;
      if (!matches(needle, [action.label])) continue;
      const destination = NAV_ITEMS.find((entry) => entry.id === action.view)?.label ?? action.view;
      out.push({
        key: `action:${action.view}:${action.label}`,
        section: 'Actions',
        label: action.label,
        hint: `opens ${destination}`,
        icon: iconOf(action.view),
        run: () => go(action.view),
      });
    }

    const peopleScope = scopeFor(currentUser.role, 'users.read');
    if (peopleScope) {
      const visible = users.filter((person) =>
        peopleScope === 'all'
          ? true
          : peopleScope === 'committee'
            ? person.committeeId === currentUser.committeeId
            : person.id === currentUser.id
      );
      for (const person of visible.filter((u) => matches(needle, [u.name, u.email, u.username, u.role])).slice(0, MAX_ROWS_PER_SECTION)) {
        out.push({
          key: `person:${person.id}`,
          section: 'People',
          label: person.name,
          hint: `${person.role.replace('_', ' ')} · ${committees.find((c) => c.id === person.committeeId)?.shortCode ?? 'no committee'} — opens Members Directory`,
          icon: Users,
          run: () => go('members'),
        });
      }
    }

    const taskScope = scopeFor(currentUser.role, 'tasks.read');
    if (taskScope) {
      const visible = tasks.filter((task) =>
        taskScope === 'all'
          ? true
          : taskScope === 'committee'
            ? task.committeeId === currentUser.committeeId || task.assigneeIds.includes(currentUser.id)
            : task.assigneeIds.includes(currentUser.id)
      );
      for (const task of visible.filter((t) => matches(needle, [t.title, t.committeeName, t.category])).slice(0, MAX_ROWS_PER_SECTION)) {
        out.push({
          key: `task:${task.id}`,
          section: 'Tasks',
          label: task.title,
          hint: `${task.committeeName} · ${task.status.replace('_', ' ')} — opens Tasks Command`,
          icon: CheckSquare,
          run: () => go('tasks'),
        });
      }
    }

    return out;
  }, [query, users, tasks, committees, can, currentUser.role, currentUser.id, currentUser.committeeId, go]);

  const sections = useMemo(() => {
    const order: string[] = [];
    const grouped = new Map<string, Result[]>();
    for (const result of results) {
      const bucket = grouped.get(result.section);
      if (bucket) bucket.push(result);
      else {
        grouped.set(result.section, [result]);
        order.push(result.section);
      }
    }
    return order.map((section) => ({ section, rows: grouped.get(section) ?? [] }));
  }, [results]);

  const flat = useMemo(() => sections.flatMap((group) => group.rows), [sections]);
  const safeActive = flat.length === 0 ? 0 : Math.min(active, flat.length - 1);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row-index="${safeActive}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [safeActive]);

  const move = (step: number) => {
    if (flat.length === 0) return;
    setActive((current) => (Math.min(current, flat.length - 1) + step + flat.length) % flat.length);
  };

  return (
    <ModalShell open={open} onClose={onClose} className="w-[min(92vw,38rem)]">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 border-b border-slate-100 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded={true}
            aria-controls="palette-results"
            aria-label="Search pages, people and tasks"
            placeholder="Jump to a page, person or task…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                flat[safeActive]?.run();
              }
            }}
            className="flex-1 min-w-0 py-3.5 bg-transparent text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:font-normal placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="hidden sm:block text-[10px] font-bold text-slate-400 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        <div id="palette-results" ref={listRef} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2 space-y-3">
          {flat.length === 0 && (
            <p className="text-xs text-slate-500 px-3 py-8 text-center">
              Nothing matches “{query.trim()}”. A page this account cannot open is not listed here,
              and would be refused by the server all the same.
            </p>
          )}
          {sections.map((group) => (
            <div key={group.section}>
              <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group.section}</div>
              <div className="space-y-0.5">
                {group.rows.map((result) => {
                  const index = flat.indexOf(result);
                  const Icon = result.icon;
                  const isCurrentRow = index === safeActive;
                  return (
                    <motion.button
                      key={result.key}
                      type="button"
                      data-row-index={index}
                      role="option"
                      aria-selected={isCurrentRow}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => result.run()}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: durations.micro, ease: easings.smooth }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left ${
                        isCurrentRow
                          ? 'bg-[#123B60] text-white'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isCurrentRow ? 'text-[#F59A16]' : 'text-slate-400'}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-bold truncate">{result.label}</span>
                        <span className={`block text-[10px] truncate ${isCurrentRow ? 'text-slate-200' : 'text-slate-400'}`}>
                          {result.hint}
                        </span>
                      </span>
                      {isCurrentRow && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 opacity-70" />}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 text-[10px] text-slate-400 font-semibold">
          <span>↑ ↓ to move · Enter to open</span>
          <span>
            {flat.length} result{flat.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </ModalShell>
  );
};
