import React, { useState } from 'react';
import { FileSpreadsheet, FileText, Printer, ShieldAlert, Download, Loader2 } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { scopeFor, type Capability } from '../../domain/roles';
import {
  REPORT_SECTIONS,
  buildSheet,
  reportFileName,
  rowVisible,
  sectionsFor,
  toCsv,
  toPrintableHtml,
  type ReportInput,
  type ReportSectionId,
  type ReportSheet,
} from '../../domain/reports';
import {
  approvalRate,
  auditCoverage,
  METRIC_DEFINITIONS,
  netPoints,
  onTimeDelivery,
  overdueWork,
  queueBacklog,
  skillCoverage,
  workloadSpread,
  type MetricValue,
} from '../../domain/metrics';
import { EmptyState } from '../EmptyState';
import { useToast } from '../../motion';
import { downloadBlob, xlsxBlob } from '../../storage/xlsx';

/**
 * Spec I: the export surface. Everything here is a view over rows the capability model already
 * grants this account — the row filtering happens in the domain module, not in this component, so
 * ticking a box cannot widen what a file contains.
 */

const DEFAULT_PRESET = 30;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A press of a button reads the clock; taken here so nothing impure happens during render. */
const nowIso = () => new Date().toISOString();

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

const PRESETS: { label: string; from: string | null; to: string | null }[] = [
  { label: 'Last 30 days', from: daysAgo(DEFAULT_PRESET), to: iso(new Date()) },
  { label: 'Last 90 days', from: daysAgo(90), to: iso(new Date()) },
  { label: 'This calendar year', from: `${new Date().getFullYear()}-01-01`, to: iso(new Date()) },
  { label: 'Everything on record', from: null, to: null },
];

/** Presets are computed once at module load; a page left open overnight keeps its window. */
const presetLabel = (from: string, to: string) => {
  const match = PRESETS.find((p) => (p.from ?? '') === from && (p.to ?? '') === to);
  return match ? match.label : `${from || 'no start'} → ${to || 'no end'}`;
};

export const ReportBuilder: React.FC = () => {
  const {
    users,
    committees,
    tasks,
    submissions,
    scoreLedger,
    skillMatrix,
    applications,
    auditLogs,
    seasons,
    objectiveRollups,
    logAction,
  } = useApp();
  const actor = useActor();
  const { toast } = useToast();

  const [from, setFrom] = useState(PRESETS[0].from ?? '');
  const [to, setTo] = useState(PRESETS[0].to ?? '');
  const [selected, setSelected] = useState<ReportSectionId[]>(() =>
    sectionsFor(actor).map((s) => s.id)
  );
  const [busy, setBusy] = useState<'xlsx' | 'csv' | 'print' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openedAt] = useState(() => nowIso());

  const readable = sectionsFor(actor);
  const readableIds = readable.map((s) => s.id);
  const blocked = REPORT_SECTIONS.filter((s) => !readableIds.includes(s.id));

  const period = { label: presetLabel(from, to), from: from || null, to: to || null };

  const rowsFor = <T,>(
    capability: Capability,
    rows: T[],
    shape: (row: T) => { committeeId?: string; owners: string[]; chapterWide?: boolean }
  ): T[] | null => {
    const scope = scopeFor(actor.role, capability);
    if (scope === null) return null;
    return rows.filter((row) => rowVisible(scope, actor, shape(row)));
  };

  /**
   * The key-figures sheet reuses the same deterministic functions the dashboards use, over the
   * same rows the file is allowed to carry. A metric whose collection this account cannot read is
   * left out of the sheet entirely rather than printed as a guess.
   */
  const readings: MetricValue[] = (() => {
    const subs = rowsFor('submissions.read', submissions, (s) => ({ committeeId: s.committeeId, owners: [s.memberId] }));
    const tk = rowsFor('tasks.read', tasks, (t) => ({ committeeId: t.committeeId, owners: t.assigneeIds }));
    const led = rowsFor('scores.read', scoreLedger, (l) => ({ committeeId: l.committeeId, owners: [l.memberId] }));
    const apps = rowsFor('registrations.read', applications, (a) => ({
      committeeId: a.assignedCommitteeId ?? a.preferredCommitteeId,
      owners: a.authUserId === undefined ? [] : [a.authUserId],
    }));
    const aud = rowsFor('audit.read', auditLogs, (a) => ({ owners: [a.actorId] }));
    const sk = rowsFor('skills.read', skillMatrix, (a) => ({ committeeId: a.committeeId, owners: [a.memberId] }));
    const usr = rowsFor('users.read', users, (u) => ({ committeeId: u.committeeId, owners: [u.id] }));

    const out: MetricValue[] = [];
    if (subs) out.push(approvalRate(subs, period));
    if (subs && tk) out.push(onTimeDelivery(subs, tk, period));
    if (led) out.push(netPoints(led, period));
    if (tk) out.push(overdueWork(tk, period, to || openedAt.slice(0, 10)));
    if (apps) out.push(queueBacklog(apps));
    if (aud) out.push(auditCoverage(aud, period));
    if (sk) out.push(skillCoverage(sk));
    if (tk && usr && actor.committeeId) out.push(workloadSpread(tk, usr, actor.committeeId));
    return out;
  })();

  const inputFor = (generatedAt: string): ReportInput => ({
    actor,
    period,
    generatedAt,
    users,
    committees,
    tasks,
    submissions,
    ledger: scoreLedger,
    assessments: skillMatrix,
    applications,
    audit: auditLogs,
    seasons,
    rollups: objectiveRollups,
    metricReadings: selected.includes('kpi') ? readings : undefined,
  });

  // Built on every render rather than memoised: the row counts shown must be the same rows the file
  // is written from, and a stale cache here would be a preview that lies.
  const preview = selected
    .map((id) => buildSheet(id, inputFor(openedAt)))
    .filter((s): s is ReportSheet => s !== null);

  const totalRows = preview.reduce((n, s) => n + s.rows.length, 0);

  const toggle = (id: ReportSectionId) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const record = (kind: string, sheets: ReportSheet[]) => {
    logAction(
      `Exported ${kind} report`,
      'system',
      `report_${kind}`,
      `${sheets.length} sheet(s), ${sheets.reduce((n, s) => n + s.rows.length, 0)} row(s), period ${period.label}. Contents not copied into the audit line.`
    );
  };

  const guard = () => {
    if (preview.length === 0) {
      setError('Nothing to export: no section is ticked, or this account can read none of them.');
      return false;
    }
    setError(null);
    return true;
  };

  const downloadCsv = () => {
    if (!guard()) return;
    setBusy('csv');
    try {
      const stamp = nowIso();
      // A byte-order mark is what makes Excel read the file as UTF-8 rather than mangle Arabic names.
      const blob = new Blob(['\uFEFF' + toCsv(preview)], { type: 'text/csv;charset=utf-8' });
      downloadBlob(blob, reportFileName('csv', stamp));
      record('csv', preview);
      toast(`CSV written with ${preview.length} sheet(s).`, 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The CSV could not be written.');
    } finally {
      setBusy(null);
    }
  };

  const downloadXlsx = async () => {
    if (!guard()) return;
    setBusy('xlsx');
    setError(null);
    try {
      const stamp = nowIso();
      const sheets = preview.map((s) => ({ ...s, notes: [...s.notes, `Workbook written ${stamp.slice(0, 16).replace('T', ' ')}.`] }));
      const blob = await xlsxBlob(sheets, 'ESME CU chapter report');
      downloadBlob(blob, reportFileName('xlsx', stamp));
      record('xlsx', sheets);
      toast(`${sheets.length} sheet(s) written. Cells were exported as text and numbers, never as formulas.`, 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The spreadsheet engine could not be loaded.';
      setError(`${message} Nothing was downloaded, so nothing was claimed.`);
      toast('Spreadsheet export failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const printReport = () => {
    if (!guard()) return;
    setBusy('print');
    try {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('title', 'Report print preview');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
      frame.srcdoc = toPrintableHtml(preview, 'ESME CU chapter report');
      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } finally {
          window.setTimeout(() => frame.remove(), 2000);
        }
      };
      document.body.appendChild(frame);
      record('pdf', preview);
      toast('The print dialog writes the PDF. If it did not open, allow pop-ups for this site.', 'info');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The document could not be prepared.');
    } finally {
      setBusy(null);
    }
  };

  const scopeOf = (capability: Capability) => scopeFor(actor.role, capability);

  return (
    <div className="space-y-6">
      <header className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
        <div className="flex items-start gap-4">
          <span className="p-3 rounded-2xl bg-[#123B60] text-white shrink-0">
            <FileText className="w-6 h-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-extrabold text-[#123B60] dark:text-white">Executive report builder</h2>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
              Assembles a spreadsheet, a CSV or a printable document out of the records this account can read.
              A section you cannot read is never written into the file — not hidden, not blanked, not present.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 max-w-3xl">
              Until a backend is configured, the rows in these files come from this browser&apos;s own storage. They are real
              records of this installation, and they are not a chapter-wide database extract.
            </p>
          </div>
        </div>
      </header>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Period</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = (p.from ?? '') === from && (p.to ?? '') === to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setFrom(p.from ?? '');
                  setTo(p.to ?? '');
                }}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-[#123B60] text-white border-[#123B60]'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[#F59A16]'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 max-w-lg">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-normal"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Reading as <strong>{period.label}</strong>. Date columns inside a sheet keep the value exactly as the record stored
          it; only the row filter uses this window.
        </p>
      </section>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Sheets</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Row counts are what this account is permitted to see, counted now — the file is built from the same rows.
        </p>
        <ul className="mt-4 grid gap-2">
          {REPORT_SECTIONS.map((section) => {
            const scope = scopeOf(section.capability);
            const sheet = preview.find((s) => s.id === section.id);
            const checked = selected.includes(section.id);
            return (
              <li key={section.id}>
                <label
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                    scope === null
                      ? 'border-dashed border-slate-200 dark:border-slate-800 opacity-60'
                      : checked
                        ? 'border-[#F59A16] bg-amber-50/50 dark:bg-amber-500/5'
                        : 'border-slate-200 dark:border-slate-700 hover:border-[#F59A16]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked && scope !== null}
                    disabled={scope === null}
                    onChange={() => toggle(section.id)}
                    className="mt-0.5 w-4 h-4 accent-[#F59A16]"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{section.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{section.detail}</span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">
                      {scope === null
                        ? `Not available: this role has no ${section.capability} permission, so the sheet is not built at all.`
                        : `Gated by ${section.capability} · scope ${scope} · ${sheet ? `${sheet.rows.length} row(s)` : 'not selected'}`}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {blocked.length > 0 && (
          <p className="mt-4 flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-2xl px-4 py-3">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" aria-hidden />
            <span>
              {blocked.length} section(s) above are greyed out because this role cannot read them. They will not appear in the
              workbook, the CSV or the printed pages — an absent sheet is the intended behaviour, not a missing export.
            </span>
          </p>
        )}
      </section>

      {preview.length === 0 ? (
        <EmptyState
          title="Nothing selected"
          description="Tick at least one sheet you are permitted to read. A report with no sections is an empty file, and an empty file is not a finding."
          icon={FileSpreadsheet}
        />
      ) : (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              {preview.length} sheet(s), {totalRows} row(s)
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadXlsx}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#F59A16] hover:bg-[#D47F0A] text-white text-sm font-bold disabled:opacity-60"
              >
                {busy === 'xlsx' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}
                Download XLSX
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold hover:border-[#F59A16] disabled:opacity-60"
              >
                {busy === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="w-4 h-4" aria-hidden />}
                Download CSV
              </button>
              <button
                type="button"
                onClick={printReport}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold hover:border-[#F59A16] disabled:opacity-60"
              >
                {busy === 'print' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Printer className="w-4 h-4" aria-hidden />}
                Print or save as PDF
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-2xl px-4 py-3">
              {error}
            </p>
          )}

          <div className="mt-5 space-y-4">
            {preview.map((sheet) => (
              <div key={sheet.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{sheet.name}</h4>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {sheet.columns.length} column(s) · {sheet.rows.length} row(s)
                  </span>
                </div>
                <ul className="px-4 py-3 space-y-1">
                  {sheet.notes.map((note) => (
                    <li key={note} className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {note}
                    </li>
                  ))}
                </ul>
                {sheet.rows.length === 0 ? (
                  <p className="px-4 pb-4 text-xs text-slate-500 dark:text-slate-400">
                    Zero rows in this window. The sheet is still exported with its header, because an empty sheet is a
                    finding; a missing sheet would be a gap in the record.
                  </p>
                ) : (
                  <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800">
                    <table className="w-full text-left text-[11px]">
                      <caption className="sr-only">First three rows of the {sheet.name} sheet</caption>
                      <thead>
                        <tr className="text-slate-500 dark:text-slate-400">
                          {sheet.columns.map((c) => (
                            <th key={c} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.rows.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                            {row.map((cell, j) => (
                              <td key={j} className="px-3 py-2 whitespace-nowrap max-w-[16rem] truncate">
                                {cell === null ? <span className="text-slate-400">—</span> : String(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {sheet.rows.length > 3 && (
                      <p className="px-3 py-2 text-[11px] text-slate-400">
                        Preview stops at 3 rows; the file carries all {sheet.rows.length}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">What protects the file</h3>
        <ul className="mt-3 space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed list-disc pl-5">
          <li>
            Text beginning with <code>=</code>, <code>+</code>, <code>-</code>, <code>@</code> or a tab is written prefixed with
            an apostrophe, so a task titled <code>=HYPERLINK(...)</code> stays a title. Numbers stay numbers — a report you
            cannot sum is not a report.
          </li>
          <li>
            The printed document escapes every cell before it becomes markup, so a record containing{' '}
            <code>&lt;img onerror=…&gt;</code> renders as that text.
          </li>
          <li>
            Official figures come from the same deterministic functions the dashboards use. A metric this role cannot read its
            records for is left out of the key-figures sheet rather than estimated.
          </li>
          <li>
            Each sheet carries its own provenance — who generated it, when, under what capability and what method produced any
            number inside it — so a printed copy still explains itself once it leaves this app.
          </li>
          <li>
            Pressing export writes an audit line for the export itself. The line records the sections and the period, never the
            contents, so the trail does not become a second copy of personal data.
          </li>
        </ul>
        <p className="mt-4 text-[11px] text-slate-400">
          Metrics available to this role: {readings.map((r) => METRIC_DEFINITIONS[r.id].label).join(', ') || 'none — this role can read no metric source collection'}.
        </p>
      </section>
    </div>
  );
};

export default ReportBuilder;
