import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  CheckCircle2, 
  ArrowLeft, 
  Send, 
  Sparkles, 
  ShieldAlert,
  HelpCircle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useToast } from '../motion';

interface RegistrationPortalProps {
  onBackToHome: () => void;
  onNavigateToLogin: () => void;
}

export const RegistrationPortal: React.FC<RegistrationPortalProps> = ({
  onBackToHome,
  onNavigateToLogin
}) => {
  const { committees, formFields, submitApplication } = useApp();
  const { toast } = useToast();
  
  const [submitted, setSubmitted] = useState(false);
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

  const handleChange = (name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.agreedToPolicies) {
      alert('You must agree to chapter policies and code of conduct.');
      return;
    }

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
      agreedToPolicies: formData.agreedToPolicies
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
          <h2 className="text-2xl font-bold text-[#123B60]">Application Submitted!</h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Thank you, <strong>{formData.fullName}</strong>. Your membership application for the 2026–2027 season has been recorded in the chapter management registry.
          </p>
          <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 text-left space-y-1.5">
            <div><strong>Preferred Committee:</strong> {committees.find(c => c.id === formData.preferredCommitteeId)?.name}</div>
            <div><strong>Email:</strong> {formData.universityEmail}</div>
            <div><strong>Status:</strong> <span className="text-amber-600 font-bold">Pending Review</span></div>
          </div>
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

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
            <span className="text-[11px] text-slate-400">
              Applications are reviewed by the chapter executive board.
            </span>
            <button
              type="submit"
              className="px-8 py-3.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl text-xs shadow-md transition flex items-center gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              Submit Application
            </button>
          </div>

        </form>

      </motion.div>
    </div>
  );
};
