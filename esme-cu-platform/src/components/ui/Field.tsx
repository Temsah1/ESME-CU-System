import React, { useId } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { fieldIds } from '../../lib/fieldIds';

/*
 * Every control in the product is labelled the same way, and the wiring is not left to whichever
 * screen uses it: an id is generated once, the label points at it, and the hint or the error is
 * reachable from the control through `aria-describedby`. A field can be rendered without a visible
 * label but never without a name — pass `srLabel` when the design truly wants no text above it.
 */

const control =
  'w-full rounded-xl border bg-surface px-3 text-caption text-ink placeholder:text-ink-faint ' +
  'border-border-strong transition-colors focus:outline-none focus:border-accent ' +
  'focus:ring-2 focus:ring-accent/25 disabled:opacity-60 disabled:cursor-not-allowed ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25';

const labelClass = 'block text-micro font-bold uppercase tracking-wider text-ink-muted';
const helpClass = 'text-micro text-ink-subtle leading-relaxed';
const errorClass = 'text-micro font-semibold text-danger';

type FieldBits = {
  /** The text above the control. Omit it only when `srLabel` names the field instead. */
  label?: React.ReactNode;
  srLabel?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  /** Another element that describes this one — a policy checklist, a live character count. */
  describedBy?: string;
  id?: string;
};

function useField(id?: string) {
  const generated = useId();
  return fieldIds(id ?? generated);
}

function describeIds(field: ReturnType<typeof useField>, error?: React.ReactNode, hint?: React.ReactNode) {
  return [error ? field.errorId : null, !error && hint ? field.hintId : null].filter(Boolean).join(' ');
}

function Legend({ label, srLabel, required }: Pick<FieldBits, 'label' | 'srLabel' | 'required'>) {
  if (label) {
    return (
      <>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </>
    );
  }
  return <span className="sr-only">{srLabel}</span>;
}

function Help({ field, error, hint }: { field: ReturnType<typeof useField>; error?: React.ReactNode; hint?: React.ReactNode }) {
  if (!error && !hint) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {error ? (
        <p id={field.errorId} className={errorClass} role="alert">
          {error}
        </p>
      ) : (
        <p id={field.hintId} className={helpClass}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Composes a labelled row around a control the kit does not already own. `htmlFor` is required,
 * because the whole point of this component is the association — a label that cannot reach its
 * control is decoration, so a screen that wants one must name the id it points at.
 */
export const FormField: React.FC<Omit<FieldBits, 'describedBy'> & { htmlFor: string; children: React.ReactNode }> = ({
  label,
  srLabel,
  hint,
  error,
  required,
  className,
  htmlFor,
  children,
}) => {
  const field = fieldIds(htmlFor);
  return (
    <div className={cn('w-full', className)}>
      {label || srLabel ? (
        <label htmlFor={htmlFor} className={label ? labelClass : 'sr-only'}>
          <Legend label={label} srLabel={srLabel} required={required} />
        </label>
      ) : null}
      <div className={label ? 'mt-1.5' : undefined}>{children}</div>
      <Help field={field} error={error} hint={hint} />
    </div>
  );
};

type InputProps = FieldBits & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> & { leadingIcon?: React.ReactNode };

export const Input: React.FC<InputProps> = ({
  label,
  srLabel,
  hint,
  error,
  required,
  className,
  describedBy,
  id,
  leadingIcon,
  ...rest
}) => {
  const field = useField(id);
  const described = `${describeIds(field, error, hint)} ${describedBy ?? ''}`.trim();

  return (
    <div className="w-full">
      {label || srLabel ? (
        <label htmlFor={field.inputId} className={label ? labelClass : 'sr-only'}>
          <Legend label={label} srLabel={srLabel} required={required} />
        </label>
      ) : null}
      <div className={cn('relative', label && 'mt-1.5')}>
        <input
          id={field.inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          aria-label={!label && !srLabel ? rest.name : undefined}
          className={cn(control, 'h-11', leadingIcon && 'pl-9', className)}
          {...rest}
        />
        {leadingIcon ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden>
            {leadingIcon}
          </span>
        ) : null}
      </div>
      <Help field={field} error={error} hint={hint} />
    </div>
  );
};

export const SearchInput: React.FC<InputProps> = ({ label = 'Search', ...rest }) => (
  <Input label={label} type="search" leadingIcon={<Search className="w-4 h-4" />} {...rest} />
);

type TextareaProps = FieldBits & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

export const Textarea: React.FC<TextareaProps> = ({
  label,
  srLabel,
  hint,
  error,
  required,
  className,
  describedBy,
  id,
  rows = 4,
  ...rest
}) => {
  const field = useField(id);
  const described = `${describeIds(field, error, hint)} ${describedBy ?? ''}`.trim();

  return (
    <div className="w-full">
      {label || srLabel ? (
        <label htmlFor={field.inputId} className={label ? labelClass : 'sr-only'}>
          <Legend label={label} srLabel={srLabel} required={required} />
        </label>
      ) : null}
      <textarea
        id={field.inputId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className={cn(control, 'py-2.5 leading-relaxed resize-y', label && 'mt-1.5', className)}
        {...rest}
      />
      <Help field={field} error={error} hint={hint} />
    </div>
  );
};

type SelectProps = FieldBits & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'>;

export const Select: React.FC<SelectProps> = ({
  label,
  srLabel,
  hint,
  error,
  required,
  className,
  describedBy,
  id,
  children,
  ...rest
}) => {
  const field = useField(id);
  const described = `${describeIds(field, error, hint)} ${describedBy ?? ''}`.trim();

  return (
    <div className="w-full">
      {label || srLabel ? (
        <label htmlFor={field.inputId} className={label ? labelClass : 'sr-only'}>
          <Legend label={label} srLabel={srLabel} required={required} />
        </label>
      ) : null}
      <div className={cn('relative', label && 'mt-1.5')}>
        <select
          id={field.inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          className={cn(control, 'h-11 appearance-none pr-9', className)}
          {...rest}
        >
          {children}
        </select>
        {/* Drawn as an element, not a background image: a chevron baked into a data URI is a colour
            literal the token file cannot see, and it cannot follow the theme flip either. */}
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint"
          aria-hidden
        />
      </div>
      <Help field={field} error={error} hint={hint} />
    </div>
  );
};

/*
 * The three pickers share one trick: the real input is visually hidden but still focusable, and the
 * painted box is its following sibling, so `peer-checked:` drives the look and the browser owns the
 * keyboard, the form value and the announcement. Hand-rolled divs with onClick would have to
 * reimplement all three.
 *
 * The focus ring is drawn on the box, not the input. Tailwind's `sr-only` clips the input to a
 * single pixel, so a ring painted on it would be invisible — the keyboard user would see nothing.
 */

const hiddenInput = 'peer sr-only';

const box =
  'shrink-0 border-2 border-border-strong bg-surface transition-colors ' +
  'peer-checked:border-accent peer-disabled:opacity-50 ' +
  'peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface';

type ChoiceProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  id?: string;
};

function ChoiceLabel({ label, hint }: { label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <span className="text-label font-semibold text-ink select-none">
      {label}
      {hint ? <span className="block mt-0.5 font-medium text-micro text-ink-subtle">{hint}</span> : null}
    </span>
  );
}

export const Checkbox: React.FC<ChoiceProps> = ({ label, hint, className, id, ...rest }) => {
  const field = useField(id);
  return (
    <label htmlFor={field.inputId} className={cn('flex items-start gap-2.5 cursor-pointer', className)}>
      <span className="relative mt-px inline-flex">
        <input id={field.inputId} type="checkbox" className={hiddenInput} {...rest} />
        <span
          aria-hidden
          className={cn(
            box,
            // `peer-checked:` only reaches siblings of the input, so the tick is switched from the box
            // with a descendant selector rather than from the svg itself.
            'flex w-[18px] h-[18px] items-center justify-center rounded-[5px] peer-checked:bg-accent',
            'peer-checked:[&_svg]:opacity-100'
          )}
        >
          <svg
            viewBox="0 0 16 16"
            className="w-3.5 h-3.5 text-slate-950 opacity-0 transition-opacity motion-reduce:transition-none"
          >
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </span>
      </span>
      <ChoiceLabel label={label} hint={hint} />
    </label>
  );
};

export const Radio: React.FC<ChoiceProps> = ({ label, hint, className, id, ...rest }) => {
  const field = useField(id);
  return (
    <label htmlFor={field.inputId} className={cn('flex items-start gap-2.5 cursor-pointer', className)}>
      <span className="relative mt-px inline-flex">
        <input id={field.inputId} type="radio" className={hiddenInput} {...rest} />
        <span
          aria-hidden
          className={cn(
            box,
            'flex w-[18px] h-[18px] items-center justify-center rounded-full',
            'peer-checked:[&>span]:scale-100'
          )}
        >
          <span className="block h-2 w-2 rounded-full bg-accent scale-0 transition-transform motion-reduce:transition-none" />
        </span>
      </span>
      <ChoiceLabel label={label} hint={hint} />
    </label>
  );
};

export const Switch: React.FC<ChoiceProps> = ({ label, hint, className, id, ...rest }) => {
  const field = useField(id);
  return (
    <label htmlFor={field.inputId} className={cn('inline-flex items-center gap-2.5 cursor-pointer', className)}>
      <input id={field.inputId} type="checkbox" role="switch" className={hiddenInput} {...rest} />
      <span
        aria-hidden
        className={cn(
          box,
          'relative h-6 w-10 rounded-full peer-checked:bg-accent',
          'after:absolute after:top-[2px] after:left-[2px] after:h-[16px] after:w-[16px] after:rounded-full',
          'after:bg-surface after:shadow-sm after:transition-transform motion-reduce:after:transition-none',
          'peer-checked:after:translate-x-4'
        )}
      />
      <ChoiceLabel label={label} hint={hint} />
    </label>
  );
};
