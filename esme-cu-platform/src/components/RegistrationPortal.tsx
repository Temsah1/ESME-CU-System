import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, ArrowLeft, Send, Loader2, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../motion';
import { useAuth } from '../auth/AuthProvider';
import { PasswordChecklist } from './LoginScreen';
import { ThemeToggle } from './ThemeToggle';
import { COMMITTEE_MEMBERSHIP_CHOICES } from '../data/referenceContent';
import { registrationCommitteeOptions } from '../domain/committees';
import {
  passwordChecks,
  resolveCommitteeAnswer,
  validateRegistration,
  type RegistrationFieldSpec,
  type RegistrationInput,
} from '../domain/registration';

interface RegistrationPortalProps {
  onBackToHome: () => void;
  onNavigateToLogin: () => void;
}

type FieldErrorKey = keyof RegistrationInput;

/** One validation message, under the control it belongs to. */
const FieldErrorNote: React.FC<{ id: string; message?: string }> = ({ id, message }) =>
  message ? (
    <p id={`${id}-error`} className="text-[11px] font-bold text-rose-700">
      {message}
    </p>
  ) : null;

export const RegistrationPortal: React.FC<RegistrationPortalProps> = ({
  onBackToHome,
  onNavigateToLogin
}) => {
  const { committees, formFields, submitApplication } = useApp();
  const { toast } = useToast();
  const { register } = useAuth();

  const [submitted, setSubmitted] = useState(false);
  const [receipt, setReceipt] = useState<{ reference: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [account, setAccount] = useState({ username: '', password: '', confirmPassword: '' });
  const [formData, setFormData] = useState<Record<string, any>>({
    fullName: '',
    universityEmail: '',
    studentId: '',
    academicYear: '',
    department: '',
    phone: '',
    committeeMembership: '',
    preferredCommitteeId: '',
    secondCommitteePreferenceId: '',
    technicalSkills: '',
    previousExperience: '',
    motivation: '',
    availabilityHours: '',
    agreedToPolicies: false
  });

  const passwordChecksView = useMemo(() => passwordChecks(account.password), [account.password]);

  /**
   * `validateRegistration()` answers per *input*, the form renders per *control*, and three of the
   * names differ. One refusal used to be printed in a banner and the rest were thrown away, so an
   * applicant who fixed the first problem learned about the second only on the next click.
   */
  const ERROR_KEY_FOR_CONTROL: Record<string, FieldErrorKey> = {
    universityEmail: 'email',
    agreedToPolicies: 'acceptedPolicies',
  };
  const errorKeyFor = (control: string): FieldErrorKey =>
    ERROR_KEY_FOR_CONTROL[control] ?? (control as FieldErrorKey);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});

  const errorFor = (control: string) => fieldErrors[errorKeyFor(control)];

  /** Typing into a field is the signal that its complaint was read; the message goes with it. */
  const clearError = (control: string) => {
    const key = errorKeyFor(control);
    setFieldErrors((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: undefined }));
  };

  const handleChange = (name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    clearError(name);
  };

  /**
   * A field the schema switched off was never asked, so it contributes nothing to the record.
   * The questionnaire used to arrive prefilled — "Sophomore", "Metallurgical & Materials
   * Engineering", a second committee the applicant never chose — and every screen downstream read
   * that as an answer. Absence is the honest value.
   */
  const answer = (name: string): string | undefined =>
    formFields.some((f) => f.enabled && f.name === name) ? formData[name] || undefined : undefined;

  /**
   * The committees an applicant may name are the rows the homepage publishes, narrowed by the rules
   * in `registrationCommitteeOptions` — an archived committee is history and a committee kept off
   * the public site is not a place a stranger is sent. This keeps no copy of a committee name, so
   * adding or renaming one on the homepage adds or renames it here on the next load.
   */
  const openCommittees = useMemo(() => registrationCommitteeOptions(committees), [committees]);
  const committeeIds = useMemo(() => openCommittees.map((c) => c.id), [openCommittees]);

  const committeeRowOn = formFields.some((f) => f.enabled && f.name === 'preferredCommitteeId');
  /** Someone who says they belong to no committee has no committee to name, so the selector closes. */
  const membershipSaysNo = formData.committeeMembership === 'no';

  const visibleFields = useMemo(
    () =>
      formFields
        .filter((f) => f.enabled)
        .sort((a, b) => a.order - b.order)
        .filter((f) => {
          // A membership question with no selector behind it cannot be answered, so the two travel
          // together: switching the committee row off hides the question that opens it.
          if (f.name === 'committeeMembership') return committeeRowOn;
          if (f.name === 'preferredCommitteeId' || f.name === 'secondCommitteePreferenceId') return !membershipSaysNo;
          return true;
        }),
    [formFields, committeeRowOn, membershipSaysNo]
  );

  /** Validation is held to the options the applicant was really offered, committees included. */
  const fieldsForValidation: RegistrationFieldSpec[] = visibleFields.map((f) =>
    f.name === 'preferredCommitteeId' || f.name === 'secondCommitteePreferenceId'
      ? { ...f, options: committeeIds }
      : f
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const membership = answer('committeeMembership');
    const identity: RegistrationInput = {
      fullName: formData.fullName,
      email: formData.universityEmail,
      username: account.username,
      password: account.password,
      confirmPassword: account.confirmPassword,
      committeeId: resolveCommitteeAnswer(membership, answer('preferredCommitteeId')),
      acceptedPolicies: !!formData.agreedToPolicies,
      studentId: answer('studentId'),
      academicYear: answer('academicYear'),
      department: answer('department'),
      phone: answer('phone'),
      committeeMembership: membership,
      secondCommitteePreferenceId: resolveCommitteeAnswer(membership, answer('secondCommitteePreferenceId')),
      technicalSkills: answer('technicalSkills'),
      previousExperience: answer('previousExperience'),
      motivation: answer('motivation'),
      availabilityHours: answer('availabilityHours'),
    };

    const errors = validateRegistration(identity, fieldsForValidation);
    const rejected = Object.keys(errors).length;
    setFieldErrors(errors);
    if (rejected > 0) {
      setFormError(
        rejected === 1 ? 'One detail below needs your attention.' : `${rejected} details below need your attention.`
      );
      return;
    }

    setBusy(true);
    const outcome = await register(identity);
    setBusy(false);

    if (!outcome.ok) {
      setFormError(outcome.failure.message);
      // The adapter answers per field too; a generic message alone left the applicant guessing.
      setFieldErrors((outcome.failure.fields ?? {}) as Partial<Record<FieldErrorKey, string>>);
      setAccount((prev) => ({ ...prev, password: '', confirmPassword: '' }));
      return;
    }

    // The provider holds the identity; this row is the chapter's copy of the questionnaire.
    submitApplication({
      fullName: formData.fullName,
      universityEmail: formData.universityEmail,
      studentId: identity.studentId,
      academicYear: identity.academicYear,
      department: identity.department,
      phone: identity.phone,
      committeeMembership: identity.committeeMembership,
      preferredCommitteeId: identity.committeeId ?? '',
      secondCommitteePreferenceId: identity.secondCommitteePreferenceId,
      technicalSkills: identity.technicalSkills,
      previousExperience: identity.previousExperience,
      motivation: identity.motivation,
      availabilityHours: identity.availabilityHours,
      agreedToPolicies: formData.agreedToPolicies,
      authUserId: outcome.receipt.reference,
    });

    setReceipt({ reference: outcome.receipt.reference });
    setSubmitted(true);
    toast('Application submitted for review');
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col justify-center items-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center"
        >
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-bold text-[#123B60]">Application received</h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            You will get an email at <strong>{formData.universityEmail}</strong> once an administrator reviews your
            request. Until then it grants no access.
          </p>
          <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 text-left space-y-2">
            <div><strong>Reference:</strong> <span className="font-mono">{receipt?.reference || formData.universityEmail}</span></div>
            <div><strong>Preferred Committee:</strong> {formData.committeeMembership === 'no' ? 'None — you told us you do not belong to one yet' : (committees.find(c => c.id === formData.preferredCommitteeId)?.name ?? 'Not recorded')}</div>
            <div><strong>Department:</strong> {formData.department || 'Not recorded'} · <strong>Year:</strong> {formData.academicYear || 'Not recorded'}</div>
            <div><strong>Email:</strong> {formData.universityEmail}</div>
            <div><strong>Status:</strong> <span className="text-amber-600 font-bold">Pending review</span></div>
            <ol className="pt-1 pl-4 list-decimal space-y-1 text-slate-500">
              <li>An administrator reviews the application and either approves or rejects it.</li>
              <li>Approval is what activates the account and opens the member workspace; you will be emailed the result either way.</li>
            </ol>
          </div>
          <p className="mt-4 text-[11px] text-slate-400 inline-flex items-start gap-1.5 text-left">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
            No role is chosen on this form — every new account is a member until an administrator decides otherwise,
            and the notification is sent to the address you entered above.
          </p>
          <div className="mt-8 space-y-3">
            <button
              onClick={onBackToHome}
              className="w-full py-3 bg-[#123B60] text-white font-bold rounded-xl text-xs hover:bg-[#0A2239] transition"
            >
              Return to Official Website
            </button>
            <button
              onClick={onNavigateToLogin}
              className="w-full py-2.5 text-xs text-[#123B60] font-semibold hover:underline"
            >
              Sign into Member Portal
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] py-12 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-3xl mx-auto"
      >
        
        {/* Navigation Bar */}
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={onBackToHome}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#123B60] hover:text-[#F59A16] transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Website
          </button>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <img src="/branding/esme_logo.png" alt="ESME" className="h-7 w-auto object-contain" />
            <span className="text-xs font-bold text-[#123B60]">Recruitment 2026-2027</span>
          </div>
        </div>

        {/* Header */}
        <div className="bg-gradient-to-r from-[#123B60] to-[#0A2239] text-white rounded-3xl p-8 sm:p-10 shadow-xl mb-8 relative overflow-hidden">
          <div className="relative z-10">
            <span className="px-3 py-1 bg-[#F59A16] text-[10px] font-black uppercase rounded tracking-wider">
              Student Registration Portal
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold mt-3">
              Join ESME CU Student Chapter
            </h1>
            <p className="text-xs sm:text-sm text-slate-200 mt-2 max-w-xl leading-relaxed">
              Empowering a Comprehensive Engineering Generation: Bridging the Gap Between Academia and the Industry of the Future.
            </p>
          </div>
        </div>

        {/* Dynamic Form Builder Renderer.
            `noValidate` keeps one voice: the chapter's rules report every refusal at once, instead of
            the browser stopping the click at the first empty control and hiding the rest. The
            `required`/`type` attributes stay for autofill and screen readers, and the store runs the
            same `validateRegistration()` on the way in, so nothing is let through. */}
        <form onSubmit={handleSubmit} noValidate className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-6">
          {/* The summary sits above the fields it points at, so a refusal is read before the form. */}
          {formError && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
              {formError}
            </p>
          )}

          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-bold text-[#123B60]">Applicant Information</h2>
            <p className="text-xs text-slate-500">All fields marked with an asterisk are required.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {visibleFields.map((field) => {
              // Every control is labelled by the schema, so the label has to be attached to it —
              // a screen reader announces "edit text" for an unassociated field.
              const inputId = `reg-field-${field.name}`;
              const fieldMessage = errorFor(field.name);
              const describedBy =
                [
                  field.description ? `${inputId}-help` : null,
                  fieldMessage ? `${inputId}-error` : null,
                ].filter(Boolean).join(' ') || undefined;
              // Whatever `describedBy` points at has to exist, so the help line renders in every
              // branch that claims it.
              const helpNote = field.description ? (
                <p id={`${inputId}-help`} className="text-[11px] text-slate-400">{field.description}</p>
              ) : null;

              if (field.type === 'textarea') {
                return (
                  <div key={field.id} className="sm:col-span-2 space-y-1.5">
                    <label htmlFor={inputId} className="block text-xs font-bold text-slate-700">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {helpNote}
                    <textarea
                      id={inputId}
                      aria-describedby={describedBy}
                      aria-invalid={fieldMessage ? true : undefined}
                      required={field.required}
                      rows={3}
                      value={formData[field.name] || ''}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      placeholder={`Enter your ${field.label.toLowerCase()}...`}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                    />
                    <FieldErrorNote id={inputId} message={fieldMessage} />
                  </div>
                );
              }

              if (field.type === 'select') {
                // If this is committee preference, populate from live committees
                if (field.name === 'committeeMembership') {
                  return (
                    <div key={field.id} className="sm:col-span-2 space-y-1.5">
                      <span id={`${inputId}-label`} className="block text-xs font-bold text-slate-700">
                        {field.label} {field.required && <span className="text-red-500">*</span>}
                      </span>
                      {helpNote}
                      <div
                        role="radiogroup"
                        aria-labelledby={`${inputId}-label`}
                        aria-describedby={describedBy}
                        aria-invalid={fieldMessage ? true : undefined}
                        className="flex flex-wrap gap-3"
                      >
                        {COMMITTEE_MEMBERSHIP_CHOICES.map((choice) => (
                          <label key={choice.value} className="flex items-center gap-2 cursor-pointer">
                            <input
                              id={`${inputId}-${choice.value}`}
                              type="radio"
                              name={field.name}
                              value={choice.value}
                              checked={formData[field.name] === choice.value}
                              onChange={() => handleChange(field.name, choice.value)}
                              className="w-4 h-4 text-[#123B60] border-slate-300 focus:ring-[#123B60]"
                            />
                            <span className="text-xs font-semibold text-slate-700">{choice.label}</span>
                          </label>
                        ))}
                      </div>
                      <FieldErrorNote id={inputId} message={fieldMessage} />
                    </div>
                  );
                }

                if (field.name === 'preferredCommitteeId' || field.name === 'secondCommitteePreferenceId') {
                  // An applicant who has said they belong to a committee has to say which one, whether
                  // or not the schema row itself is marked required; a second preference stays optional.
                  const mustChoose =
                    field.required || (field.name === 'preferredCommitteeId' && formData.committeeMembership === 'yes');
                  // A selector with nothing selected shows the browser's first committee, which would
                  // file a membership nobody chose — so the unanswered state is a row of its own.
                  const blankText =
                    field.name === 'secondCommitteePreferenceId'
                      ? 'None / No second preference'
                      : openCommittees.length === 0
                        ? 'No committee is open for selection right now'
                        : mustChoose
                          ? 'Choose the committee you belong to'
                          : 'No preference — an administrator will discuss where I fit';
                  return (
                    <div key={field.id} className="space-y-1.5">
                      <label htmlFor={inputId} className="block text-xs font-bold text-slate-700">
                        {field.label} {mustChoose && <span className="text-red-500">*</span>}
                      </label>
                      {helpNote}
                      <select
                        id={inputId}
                        aria-describedby={describedBy}
                        aria-invalid={fieldMessage ? true : undefined}
                        required={mustChoose && openCommittees.length > 0}
                        value={formData[field.name] || ''}
                        onChange={(e) => handleChange(field.name, e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition bg-white"
                      >
                        <option value="">{blankText}</option>
                        {openCommittees.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.shortCode})
                          </option>
                        ))}
                      </select>
                      {mustChoose && openCommittees.length === 0 && (
                        <p className="text-[11px] text-slate-400">
                          No committee is open for selection right now. Leave this unanswered and an
                          administrator will place you once one is.
                        </p>
                      )}
                      <FieldErrorNote id={inputId} message={fieldMessage} />
                    </div>
                  );
                }

                return (
                  <div key={field.id} className="space-y-1.5">
                    <label htmlFor={inputId} className="block text-xs font-bold text-slate-700">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {helpNote}
                    <select
                      id={inputId}
                      aria-describedby={describedBy}
                      aria-invalid={fieldMessage ? true : undefined}
                      required={field.required}
                      value={formData[field.name] || ''}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition bg-white"
                    >
                      <option value="">
                        {field.required ? 'Select an option' : 'Choose one (optional)'}
                      </option>
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <FieldErrorNote id={inputId} message={fieldMessage} />
                  </div>
                );
              }

              if (field.type === 'checkbox') {
                return (
                  <div key={field.id} className="sm:col-span-2 space-y-1.5 pt-2">
                    {helpNote}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        id={inputId}
                        type="checkbox"
                        aria-describedby={describedBy}
                        aria-invalid={fieldMessage ? true : undefined}
                        required={field.required}
                        checked={!!formData[field.name]}
                        onChange={(e) => handleChange(field.name, e.target.checked)}
                        className="mt-1 w-4 h-4 rounded text-[#123B60] border-slate-300 focus:ring-[#123B60]"
                      />
                      <span className="text-xs text-slate-700 leading-relaxed font-medium">
                        {field.label} {field.required && <span className="text-red-500">*</span>}
                      </span>
                    </label>
                    <FieldErrorNote id={inputId} message={fieldMessage} />
                  </div>
                );
              }

              return (
                <div key={field.id} className="space-y-1.5">
                  <label htmlFor={inputId} className="block text-xs font-bold text-slate-700">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {helpNote}
                  <input
                    id={inputId}
                    type={field.type}
                    aria-describedby={describedBy}
                    aria-invalid={fieldMessage ? true : undefined}
                    required={field.required}
                    value={formData[field.name] || ''}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    placeholder={`Your ${field.label.toLowerCase()}`}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                  />
                  <FieldErrorNote id={inputId} message={fieldMessage} />
                </div>
              );
            })}
          </div>

          {/* Account credentials — created on the provider, never stored here */}
          <div className="pt-6 border-t border-slate-100 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#123B60]">Chapter account</h2>
              <p className="text-xs text-slate-500">
                These credentials sign you in. They are sent to the authentication provider and are never written into
                this browser or this repository.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label htmlFor="reg-username" className="block text-xs font-bold text-slate-700">
                  Username <span className="text-red-500">*</span>
                </label>
                <input
                  id="reg-username"
                  value={account.username}
                  aria-invalid={fieldErrors.username ? true : undefined}
                  aria-describedby={fieldErrors.username ? 'reg-username-error' : undefined}
                  onChange={(e) => {
                    setAccount({ ...account, username: e.target.value.toLowerCase() });
                    clearError('username');
                  }}
                  autoComplete="username"
                  required
                  placeholder="lowercase, 3-30 characters"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                />
                <FieldErrorNote id="reg-username" message={fieldErrors.username} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="reg-password" className="block text-xs font-bold text-slate-700">
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  id="reg-password"
                  type="password"
                  value={account.password}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={fieldErrors.password ? 'reg-password-error' : undefined}
                  onChange={(e) => {
                    setAccount({ ...account, password: e.target.value });
                    clearError('password');
                  }}
                  autoComplete="new-password"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                />
                <FieldErrorNote id="reg-password" message={fieldErrors.password} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="reg-confirm" className="block text-xs font-bold text-slate-700">
                  Confirm password <span className="text-red-500">*</span>
                </label>
                <input
                  id="reg-confirm"
                  type="password"
                  value={account.confirmPassword}
                  aria-invalid={fieldErrors.confirmPassword ? true : undefined}
                  aria-describedby={fieldErrors.confirmPassword ? 'reg-confirm-error' : undefined}
                  onChange={(e) => {
                    setAccount({ ...account, confirmPassword: e.target.value });
                    clearError('confirmPassword');
                  }}
                  autoComplete="new-password"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                />
                <FieldErrorNote id="reg-confirm" message={fieldErrors.confirmPassword} />
                <PasswordChecklist checks={passwordChecksView} />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
            <span className="text-[11px] text-slate-400">
              Applications are reviewed by administrators holding the approval capability.
            </span>
            <button
              type="submit"
              disabled={busy}
              className="px-8 py-3.5 bg-[#F59A16] hover:bg-[#D47F0A] disabled:opacity-60 text-white font-bold rounded-xl text-xs shadow-md transition flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {busy ? 'Submitting…' : 'Submit Application'}
            </button>
          </div>

        </form>

      </motion.div>
    </div>
  );
};
