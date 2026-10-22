import React, { useState } from 'react';
import { LIMITS, type DraftIssue } from '../../../domain/committees';
import { CATEGORIES, linesOf, type FormValues } from './committeeDraft';

type Props = {
  initial: FormValues;
  issues: DraftIssue[];
  submitLabel: string;
  /** States, in one line, where the seats live so nobody thinks a text edit dropped them. */
  seatsSummary: string;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
};

const fieldClass = 'w-full px-3 py-2 rounded-xl border bg-white dark:bg-slate-800 outline-none text-xs';

/**
 * Every stored field of a committee is editable here. The earlier form offered four of them,
 * so an acronym, a category, an objective list or a sub-team list could only be changed by
 * editing source code — the reason the CMS looked incomplete rather than merely awkward.
 *
 * Leadership is deliberately absent: a seat is written by the leadership panel, through the
 * eligibility rules, so a text edit can never overwrite an appointment as a side effect.
 */
export const CommitteeForm: React.FC<Props> = ({ initial, issues, submitLabel, seatsSummary, onSubmit, onCancel }) => {
  const [values, setValues] = useState<FormValues>(initial);
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((prev) => ({ ...prev, [key]: value }));
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const border = (field: string) => (issueFor(field) ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
      className="space-y-4 text-xs"
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="committee-name">
            Committee name
          </label>
          <input
            id="committee-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={LIMITS.name}
            placeholder="e.g. Human Resources Committee"
            className={`${fieldClass} ${border('name')}`}
          />
          <p className="mt-1 text-[10px] text-slate-400">
            {values.name.trim().length}/{LIMITS.name}
            {issueFor('name') && <span className="block text-rose-600">{issueFor('name')}</span>}
          </p>
        </div>
        <div>
          <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="committee-code">
            Acronym
          </label>
          <input
            id="committee-code"
            value={values.shortCode}
            onChange={(e) => set('shortCode', e.target.value.toUpperCase())}
            maxLength={LIMITS.shortCode}
            placeholder="HR"
            className={`${fieldClass} ${border('shortCode')} font-bold uppercase`}
          />
          <p className="mt-1 text-[10px] text-slate-400">
            2-{LIMITS.shortCode} characters
            {issueFor('shortCode') && <span className="block text-rose-600">{issueFor('shortCode')}</span>}
          </p>
        </div>
      </div>

      <div>
        <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="committee-description">
          Description and scope
        </label>
        <textarea
          id="committee-description"
          rows={3}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={LIMITS.description}
          placeholder="What this committee is accountable for…"
          className={`${fieldClass} ${border('description')}`}
        />
        <p className="mt-1 text-[10px] text-slate-400">
          {values.description.trim().length}/{LIMITS.description}
          {issueFor('description') && <span className="block text-rose-600">{issueFor('description')}</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="committee-category">
            Category
          </label>
          <select
            id="committee-category"
            value={values.category}
            onChange={(e) => set('category', e.target.value as FormValues['category'])}
            className={`${fieldClass} ${border('category')}`}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {issueFor('category') && <p className="mt-1 text-[10px] text-rose-600">{issueFor('category')}</p>}
        </div>
        <div>
          <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="committee-status">
            Status
          </label>
          <select
            id="committee-status"
            value={values.status}
            onChange={(e) => set('status', e.target.value as FormValues['status'])}
            className={`${fieldClass} ${border('status')}`}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <p className="mt-1 text-[10px] text-slate-400">
            Archiving keeps the committee, its records and its seats.
          </p>
          {issueFor('status') && <p className="mt-1 text-[10px] text-rose-600">{issueFor('status')}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="committee-objectives">
            Objectives — one per line
          </label>
          <textarea
            id="committee-objectives"
            rows={5}
            value={values.objectives}
            onChange={(e) => set('objectives', e.target.value)}
            placeholder={'Deliver the seasonal summit\nRun four workshops per term'}
            className={`${fieldClass} ${border('objectives')}`}
          />
          <p className="mt-1 text-[10px] text-slate-400">
            {linesOf(values.objectives).length}/{LIMITS.objectives} recorded
            {issueFor('objectives') && <span className="block text-rose-600">{issueFor('objectives')}</span>}
          </p>
        </div>
        <div>
          <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="committee-subteams">
            Sub-teams — one per line
          </label>
          <textarea
            id="committee-subteams"
            rows={5}
            value={values.subTeams}
            onChange={(e) => set('subTeams', e.target.value)}
            placeholder={'NDT & Inspection\nMaterials Testing'}
            className={`${fieldClass} ${border('subTeams')}`}
          />
          <p className="mt-1 text-[10px] text-slate-400">
            {linesOf(values.subTeams).length}/{LIMITS.subTeams} recorded
            {issueFor('subTeams') && <span className="block text-rose-600">{issueFor('subTeams')}</span>}
          </p>
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={values.isPublic}
          onChange={(e) => set('isPublic', e.target.checked)}
          className="mt-0.5 accent-[#123B60]"
        />
        <span>
          <span className="block font-bold text-slate-700 dark:text-slate-300">Show on the public website</span>
          <span className="block text-[10px] text-slate-400">
            Unchecked keeps the committee in the ERP but off the public committee list.
          </span>
        </span>
      </label>

      <p className="text-[10px] text-slate-400">{seatsSummary}</p>

      {issues.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 space-y-1">
          <p className="font-bold text-rose-700 dark:text-rose-300">This save was refused:</p>
          {issues.map((issue) => (
            <p key={`${issue.field}-${issue.message}`} className="text-[11px] text-rose-600 dark:text-rose-300">
              - {issue.message}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold"
        >
          Cancel
        </button>
        <button type="submit" className="px-5 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl">
          {submitLabel}
        </button>
      </div>
    </form>
  );
};
