import React, { useState } from 'react';
import { Search, X, ShieldCheck, MailWarning } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthProvider';
import { useStickyNonNull, ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import type { RegistrationApplication, RegistrationFieldConfig } from '../../types';

export const RegistrationManager: React.FC = () => {
  const {
    applications,
    registrationQueue,
    refreshRegistrationQueue,
    updateApplicationStatus,
    committees,
    formFields,
    updateFormFields,
    can
  } = useApp();
  const { adapter } = useAuth();
  const adapterKind = adapter ? adapter.kind : 'no provider';

  const mayDecide = can('registrations.decide');
  const mayEditSchema = can('cms.settings.global');

  const [activeTab, setActiveTab] = useState<'applications' | 'form_builder'>('applications');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const { toast } = useToast();
  const [selectedApp, setSelectedApp] = useState<RegistrationApplication | null>(null);

  // Field editor state for form builder
  const [localFields, setLocalFields] = useState<RegistrationFieldConfig[]>(formFields);

  const filteredApps = applications.filter((a) => {
    const matchesSearch = a.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          a.universityEmail.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const isDecided = (app: RegistrationApplication | null) =>
    !!app && (app.status === 'accepted' || app.status === 'rejected');

  const handleStatusChange = async (
    id: string,
    newStatus: RegistrationApplication['status'],
    notes?: string,
    commId?: string
  ) => {
    try {
      await updateApplicationStatus(id, newStatus, notes, commId);
      toast(
        newStatus === 'accepted'
          ? 'Applicant approved. The account is now active.'
          : newStatus === 'rejected'
            ? 'Applicant rejected.'
            : 'Application moved to ' + newStatus.replace('_', ' ') + '.',
        newStatus === 'rejected' ? 'error' : 'success'
      );
      setSelectedApp(prev => prev && prev.id === id ? { ...prev, status: newStatus } : prev);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The decision was refused.', 'error');
    }
  };

  const handleSaveFields = () => {
    try {
      updateFormFields(localFields);
      toast('Registration form schema saved.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The schema was refused.', 'error');
    }
  };

  const viewApp = useStickyNonNull(selectedApp);

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Recruitment & Application Manager</h1>
          <p className="text-xs text-slate-500">
            Review applicant submissions, assign accepted candidates to committees, and customize dynamic form fields.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 flex self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('applications')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'applications' ? 'bg-[#123B60] text-white' : 'text-slate-500'
            }`}
          >
            Applications ({applications.length})
          </button>
          <button
            onClick={() => setActiveTab('form_builder')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'form_builder' ? 'bg-[#123B60] text-white' : 'text-slate-500'
            }`}
          >
            Form Schema Builder
          </button>
        </div>
      </div>

      {activeTab === 'applications' ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
            <p className="text-[11px] text-slate-500">
              {registrationQueue.from === 'provider'
                ? `Queue read from the ${adapterKind} provider — this list is the server's record, not this browser's cache.`
                : 'Queue read from this browser only. The provider did not return a list, so decisions here cannot be relied on for access.'}
              {registrationQueue.error ? ` Last attempt failed: ${registrationQueue.error}` : ''}
            </p>
            <button
              onClick={() => void refreshRegistrationQueue()}
              className="text-[11px] font-bold text-[#123B60] dark:text-[#F59A16] hover:underline"
            >
              Reload from provider
            </button>
          </div>

          
          {/* Search and Filters */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Search applicant by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
            >
              <option value="all">All Application Statuses</option>
              <option value="pending">Pending</option>
              <option value="under_review">Under Review</option>
              <option value="accepted">Accepted</option>
              <option value="waitlisted">Waitlisted</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          {applications.length === 0 && (
            <EmptyState
              title="No applications in this workspace"
              description="Every submission from the public form lands here once the recruitment backend stores it. Nothing is pre-seeded, so an empty queue means no one has applied yet — not that the list was filtered."
            />
          )}

          {/* Applications Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredApps.map((app) => {
              const prefComm = committees.find(c => c.id === app.preferredCommitteeId);
              return (
                <div
                  key={app.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold text-slate-400">{app.appliedDate}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        app.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' :
                        app.status === 'under_review' ? 'bg-blue-100 text-blue-800' :
                        app.status === 'waitlisted' ? 'bg-amber-100 text-amber-800' :
                        app.status === 'rejected' ? 'bg-red-100 text-red-800' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {app.status.replace('_', ' ')}
                      </span>
                    </div>

                    {app.accountStatus && (
                      <p className="text-[10px] text-slate-400 mb-2">
                        Provider status: <span className="font-bold">{app.accountStatus.replace(/_/g, ' ')}</span>
                      </p>
                    )}

                    <h2 className="text-base font-bold text-slate-900 dark:text-white">{app.fullName}</h2>
                    <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                      {app.universityEmail}
                      {app.emailVerified ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                          <ShieldCheck className="w-3 h-3" aria-hidden /> verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700">
                          <MailWarning className="w-3 h-3" aria-hidden /> email unverified
                        </span>
                      )}
                    </p>

                    <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                      <div>Year: <strong className="text-slate-800 dark:text-slate-200">{app.academicYear}</strong> ({app.department})</div>
                      <div>Target: <strong className="text-[#123B60] dark:text-[#F59A16]">{prefComm?.name || app.preferredCommitteeId}</strong></div>
                      <div>Availability: <span className="text-slate-600 dark:text-slate-400">{app.availabilityHours}</span></div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-3 line-clamp-2 leading-relaxed italic">
                      "{app.motivation}"
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800 mt-4 flex items-center justify-between gap-2">
                    <button
                      onClick={() => setSelectedApp(app)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                      Full Profile
                    </button>

                    {mayDecide && (
                      <div className="flex items-center gap-1.5">
                        {app.status !== 'accepted' && (
                          <button
                            onClick={() => handleStatusChange(app.id, 'accepted')}
                            disabled={!app.emailVerified || isDecided(app)}
                            title={app.emailVerified ? 'Approve and activate the account' : 'The applicant must confirm their email first'}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition"
                          >
                            Accept
                          </button>
                        )}
                        {app.status !== 'rejected' && (
                          <button
                            onClick={() => {
                              const reason = window.prompt('Reason for rejection (recorded in the audit trail):') ?? '';
                              handleStatusChange(app.id, 'rejected', reason || 'Rejected by reviewer');
                            }}
                            disabled={isDecided(app)}
                            className="px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 rounded-lg transition"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      ) : (
        /* Form Schema Builder */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Registration Field Schema</h2>
              <p className="text-xs text-slate-500">Configure enabled fields, requirement rules, and input types for the public form.</p>
            </div>
            {mayEditSchema ? (
              <button
                onClick={handleSaveFields}
                className="px-5 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition"
              >
                Save Schema Changes
              </button>
            ) : (
              <span className="text-[11px] text-slate-400">Read-only: editing the schema requires the global CMS settings capability.</span>
            )}
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {localFields.map((field, idx) => (
              <div key={field.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-[10px] text-slate-500">
                    {field.order}
                  </span>
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-100">{field.label}</div>
                    <div className="text-[10px] text-slate-400">Type: {field.type} • Name: {field.name}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => {
                        const copy = [...localFields];
                        copy[idx].required = e.target.checked;
                        setLocalFields(copy);
                      }}
                      className="rounded text-[#123B60]"
                    />
                    <span>Required</span>
                  </label>

                  <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.enabled}
                      onChange={(e) => {
                        const copy = [...localFields];
                        copy[idx].enabled = e.target.checked;
                        setLocalFields(copy);
                      }}
                      className="rounded text-[#123B60]"
                    />
                    <span>Enabled</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Application Detail View Modal */}
      <ModalShell open={!!selectedApp} onClose={() => setSelectedApp(null)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
          {viewApp && (
          <>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">{viewApp.fullName}</h2>
                <p className="text-xs text-slate-500">{viewApp.universityEmail} • {viewApp.phone}</p>
              </div>
              <button onClick={() => setSelectedApp(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs space-y-3 max-h-96 overflow-y-auto">
              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Academic Profile:</span>
                <p className="text-slate-600 dark:text-slate-400">{viewApp.academicYear} • {viewApp.department}</p>
              </div>

              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Technical Skills:</span>
                <p className="text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">{viewApp.technicalSkills}</p>
              </div>

              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Previous Experience:</span>
                <p className="text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">{viewApp.previousExperience || 'None stated'}</p>
              </div>

              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Motivation:</span>
                <p className="text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">{viewApp.motivation}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={() => handleStatusChange(viewApp.id, 'waitlisted')}
                className="px-3.5 py-1.5 rounded-xl border border-amber-300 text-amber-700 text-xs font-bold"
              >
                Waitlist
              </button>
              <button
                onClick={() => handleStatusChange(viewApp.id, 'accepted')}
                className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold"
              >
                Accept Candidate
              </button>
            </div>
          </>
          )}
      </ModalShell>

    </div>
  );
};
