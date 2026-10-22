import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

/**
 * The form pieces the CMS panels are built from. Everything is a real `<label>` around a real
 * control so a keyboard and a screen reader reach the same field the operator sees, and so a
 * test can ask for a field by the words printed on it.
 */

const inputClass =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#F59A16]/40 disabled:opacity-60';

export const TextField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  rows?: number;
  type?: string;
  placeholder?: string;
}> = ({ label, value, onChange, hint, rows, type = 'text', placeholder }) => (
  <div className="block">
    <label className="block">
      <span className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">{label}</span>
      {rows ? (
        <textarea
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      )}
    </label>
    {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>}
  </div>
);

export const Switch: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  note?: string;
  /** The row is named by what is being switched, not by the word "Visible" repeated down a list. */
  ariaLabel?: string;
}> = ({ label, checked, onChange, note, ariaLabel }) => (
  <label className="flex items-start gap-2.5 cursor-pointer select-none">
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel ?? label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="mt-0.5 w-4 h-4 accent-[#F59A16]"
    />
    <span className="min-w-0">
      <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">{label}</span>
      {note && <span className="block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{note}</span>}
    </span>
  </label>
);

export const TinyButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'neutral' | 'brand' | 'danger' }
> = ({ tone = 'neutral', className = '', ...rest }) => {
  const tones = {
    neutral: 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
    brand: 'border-[#F59A16] text-[#D47F0A] dark:text-[#F59A16] hover:bg-amber-50 dark:hover:bg-amber-500/10',
    danger: 'border-rose-200 dark:border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10',
  };
  return (
    <button
      type="button"
      className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition disabled:opacity-40 ${tones[tone]} ${className}`}
      {...rest}
    />
  );
};

/** A list of sentences the operator can rewrite, add to, or throw away — objectives, values, pillar points. */
export const StringListField: React.FC<{
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}> = ({ label, items, onChange, placeholder = 'Write one line' }) => (
  <fieldset className="space-y-2">
    <legend className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">{label}</legend>
    {items.map((entry, index) => (
      <div key={index} className="flex items-start gap-2">
        <input
          aria-label={`${label} ${index + 1}`}
          value={entry}
          placeholder={placeholder}
          onChange={(event) => onChange(items.map((row, position) => (position === index ? event.target.value : row)))}
          className={inputClass}
        />
        <button
          type="button"
          aria-label={`Remove ${label} ${index + 1}`}
          onClick={() => onChange(items.filter((_, position) => position !== index))}
          className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 transition"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    ))}
    <TinyButton onClick={() => onChange([...items, ''])} className="inline-flex items-center gap-1.5">
      <Plus className="w-3.5 h-3.5" /> Add line
    </TinyButton>
    {items.length === 0 && (
      <p className="text-[11px] text-slate-500">Nothing is listed, so the block renders this list empty.</p>
    )}
  </fieldset>
);

export const PanelTitle: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-1">
    <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
    {children && <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{children}</p>}
  </div>
);
