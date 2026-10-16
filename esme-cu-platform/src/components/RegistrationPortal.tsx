import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, ArrowLeft, Send, Loader2, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../motion';
import { PasswordChecklist } from './LoginScreen';
import { ThemeToggle } from './ThemeToggle';
import { passwordChecks, validateRegistration, type RegistrationInput } from '../domain/registration';

interface RegistrationPortalProps {
  onBackToHome: () => void;
  onNavigateToLogin: () => void;
}

export const RegistrationPortal: React.FC<RegistrationPortalProps> = ({
  onBackToHome,
  onNavigateToLogin
}) => {
  const { committees, formFields, submitApplication } = useApp();
  const { register } = useAuth();
  const { toast } = useToast();

  const [submitted, setSubmitted] = useState(false);
  const [receipt, setReceipt] = useState<{ reference: string; requiresEmailVerification: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [account, setAccount] = useState({ username: '', password: '', confirmPassword: '' });
  const [formData, setFormData] = useState<Record<string, any>>({
    fullName: '',
    universityEmail: '',
    studentId: '',
    academicYear: 'Sophomore',
    department: 'Metallurgical & Materials Engineering',
    phone: '',
    preferredCommitteeId: committees[0]?.id || 'comm_te',
    secondCommitteePreferenceId: committees[1]?.id || 'comm_mc',
    technicalSkills: '',
    previousExperience: '',
    motivation: '',
    availabilityHours: '9-12 hours/week',
    agreedToPolicies: false
  });

  const passwordChecksView = useMemo(() => passwordChecks(account.password), [account.password]);

  const handleChange = (name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const identity: RegistrationInput = {
      fullName: formData.fullName,
      email: formData.universityEmail,
      username: account.username,
      password: account.password,
      confirmPassword: account.confirmPassword,
      committeeId: formData.preferredCommitteeId,
      acceptedPolicies: !!formData.agreedToPolicies,
      studentId: formData.studentId,
      academicYear: formData.academicYear,
      department: formData.department,
      phone: formData.phone,
      secondCommitteePreferenceId: formData.secondCommitteePreferenceId,
      technicalSkills: formData.technicalSkills,
      previousExperience: formData.previousExperience || '',
      motivation: formData.motivation,
      availabilityHours: formData.availabilityHours,
    };

    const errors = validateRegistration(identity);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      setFormError(firstError);
      return;
    }

    setBusy(true);
    const outcome = await register(identity);
    setBusy(false);

    if (!outcome.ok) {
      setFormError(outcome.failure.message);
      setAccount((prev) => ({ ...prev, password: '', confirmPassword: '' }));
      return;
    }

    // The provider holds the identity; this row is the chapter's copy of the questionnaire.
    submitApplication({
      fullName: formData.fullName,
      universityEmail: formData.universityEmail,
      studentId: formData.studentId,
      academicYear: formData.academicYear,
      department: formData.department,
      phone: formData.phone,
      preferredCommitteeId: formData.preferredCommitteeId,
      secondCommitteePreferenceId: formData.secondCommitteePreferenceId,
      technicalSkills: formData.technicalSkills,
      previousExperience: formData.previousExperience || '',
      motivation: formData.motivation,
      availabilityHours: formData.availabilityHours,
      agreedToPolicies: formData.agreedToPolicies,
      authUserId: outcome.receipt.reference,
    });

    setReceipt({
      reference: outcome.receipt.reference,
      requiresEmailVerification: outcome.receipt.requiresEmailVerification,
    });
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
            Thank you, <strong>{formData.fullName}</strong>. Your request is recorded as
            <strong> pending</strong> — it grants no access yet.
          </p>
          <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 text-left space-y-2">
            <div><strong>Reference:</strong> <span className="font-mono">{receipt?.reference || formData.universityEmail}</span></div>
            <div><strong>Preferred Committee:</strong> {committees.find(c => c.id === formData.preferredCommitteeId)?.name ?? 'Not recorded'}</div>
            <div><strong>Email:</strong> {formData.universityEmail}</div>
            <div><strong>Status:</strong> <span className="text-amber-600 font-bold">Pending review</span></div>
            <ol className="pt-1 pl-4 list-decimal space-y-1 text-slate-500">
              <li>
                {receipt?.requiresEmailVerification === false
                  ? 'Your address was already confirmed.'
                  : 'Confirm your email address using the link we just sent.'}
              </li>
              <li>An administrator reviews the application and either approves or rejects it.</li>
              <li>Only after approval does the account reach active and open the member workspace.</li>
            </ol>
          </div>
          <p className="mt-4 text-[11px] text-slate-400 inline-flex items-start gap-1.5 text-left">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
            Verification alone does not grant access, and no role is chosen on this form — every new account is a
            member until an administrator decides otherwise.
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

        {/* Dynamic Form Builder Renderer */}
        <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-6">
          
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-bold text-[#123B60]">Applicant Information</h2>
            <p className="text-xs text-slate-500">All fields marked with an asterisk are required.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {formFields.filter(f => f.enabled).sort((a, b) => a.order - b.order).map((field) => {
              if (field.type === 'textarea') {
                return (
                  <div key={field.id} className="sm:col-span-2 space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {field.description && (
                      <p className="text-[11px] text-slate-400">{field.description}</p>
                    )}
                    <textarea
                      required={field.required}
                      rows={3}
                      value={formData[field.name] || ''}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      placeholder={`Enter your ${field.label.toLowerCase()}...`}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                    />
                  </div>
                );
              }

              if (field.type === 'select') {
                // If this is committee preference, populate from live committees
                let options = field.options || [];
                if (field.name === 'preferredCommitteeId' || field.name === 'secondCommitteePreferenceId') {
                  return (
                    <div key={field.id} className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700">
                        {field.label} {field.required && <span className="text-red-500">*</span>}
                      </label>
                      <select
                        required={field.required}
                        value={formData[field.name] || ''}
                        onChange={(e) => handleChange(field.name, e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition bg-white"
                      >
                        {field.name === 'secondCommitteePreferenceId' && (
                          <option value="">None / No second preference</option>
                        )}
                        {committees.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.shortCode})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                return (
                  <div key={field.id} className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    <select
                      required={field.required}
                      value={formData[field.name] || ''}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition bg-white"
                    >
                      {options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (field.type === 'checkbox') {
                return (
                  <div key={field.id} className="sm:col-span-2 pt-2">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        required={field.required}
                        checked={!!formData[field.name]}
                        onChange={(e) => handleChange(field.name, e.target.checked)}
                        className="mt-1 w-4 h-4 rounded text-[#123B60] border-slate-300 focus:ring-[#123B60]"
                      />
                      <span className="text-xs text-slate-700 leading-relaxed font-medium">
                        {field.label} {field.required && <span className="text-red-500">*</span>}
                      </span>
                    </label>
                  </div>
                );
              }

              return (
                <div key={field.id} className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={field.type}
                    required={field.required}
                    value={formData[field.name] || ''}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    placeholder={`Your ${field.label.toLowerCase()}`}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                  />
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
                  onChange={(e) => setAccount({ ...account, username: e.target.value.toLowerCase() })}
                  autoComplete="username"
                  required
                  placeholder="lowercase, 3-30 characters"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="reg-password" className="block text-xs font-bold text-slate-700">
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  id="reg-password"
                  type="password"
                  value={account.password}
                  onChange={(e) => setAccount({ ...account, password: e.target.value })}
                  autoComplete="new-password"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="reg-confirm" className="block text-xs font-bold text-slate-700">
                  Confirm password <span className="text-red-500">*</span>
                </label>
                <input
                  id="reg-confirm"
                  type="password"
                  value={account.confirmPassword}
                  onChange={(e) => setAccount({ ...account, confirmPassword: e.target.value })}
                  autoComplete="new-password"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none transition"
                />
                <PasswordChecklist checks={passwordChecksView} />
              </div>
            </div>
          </div>

          {formError && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
              {formError}
            </p>
          )}

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
