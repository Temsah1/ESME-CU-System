import React, { useState } from 'react';
import { 
  UserPlus, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Layers, 
  Sliders, 
  Plus, 
  Trash2, 
  Eye, 
  ExternalLink,
  ChevronDown,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { RegistrationApplication, RegistrationFieldConfig } from '../../types';

export const RegistrationManager: React.FC = () => {
  const { 
    applications, 
    updateApplicationStatus, 
    committees, 
    formFields, 
    updateFormFields,
    currentUser 
  } = useApp();

  const [activeTab, setActiveTab] = useState<'applications' | 'form_builder'>('applications');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedApp, setSelectedApp] = useState<RegistrationApplication | null>(null);

  // Field editor state for form builder
  const [localFields, setLocalFields] = useState<RegistrationFieldConfig[]>(formFields);

  const filteredApps = applications.filter((a) => {
    const matchesSearch = a.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          a.universityEmail.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleStatusChange = (
    id: string, 
    newStatus: RegistrationApplication['status'], 
    notes?: string, 
    commId?: string
  ) => {
    updateApplicationStatus(id, newStatus, notes, commId);
    if (selectedApp && selectedApp.id === id) {
      setSelectedApp(prev => prev ? { ...prev, status: newStatus } : null);
    }
  };

  const handleSaveFields = () => {
    updateFormFields(localFields);
    alert('Registration form builder configuration saved successfully!');
  };

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

                    <h2 className="text-base font-bold text-slate-900 dark:text-white">{app.fullName}</h2>
                    <p className="text-xs text-slate-500">{app.universityEmail}</p>

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

                    <div className="flex items-center gap-1.5">
                      {app.status !== 'accepted' && (
                        <button
                          onClick={() => handleStatusChange(app.id, 'accepted')}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition"
                        >
                          Accept
                        </button>
                      )}
                      {app.status !== 'rejected' && (
                        <button
                          onClick={() => handleStatusChange(app.id, 'rejected')}
                          className="px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition"
                        >
                          Reject
                        </button>
                      )}
                    </div>
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
            <button
              onClick={handleSaveFields}
              className="px-5 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition"
            >
              Save Schema Changes
            </button>
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
      {selectedApp && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl animate-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">{selectedApp.fullName}</h2>
                <p className="text-xs text-slate-500">{selectedApp.universityEmail} • {selectedApp.phone}</p>
              </div>
              <button onClick={() => setSelectedApp(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs space-y-3 max-h-96 overflow-y-auto">
              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Academic Profile:</span>
                <p className="text-slate-600 dark:text-slate-400">{selectedApp.academicYear} • {selectedApp.department}</p>
              </div>

              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Technical Skills:</span>
                <p className="text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">{selectedApp.technicalSkills}</p>
              </div>

              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Previous Experience:</span>
                <p className="text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">{selectedApp.previousExperience || 'None stated'}</p>
              </div>

              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Motivation:</span>
                <p className="text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">{selectedApp.motivation}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={() => handleStatusChange(selectedApp.id, 'waitlisted')}
                className="px-3.5 py-1.5 rounded-xl border border-amber-300 text-amber-700 text-xs font-bold"
              >
                Waitlist
              </button>
              <button
                onClick={() => handleStatusChange(selectedApp.id, 'accepted')}
                className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold"
              >
                Accept Candidate
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
