import React, { useState } from 'react';
import { 
  Calendar, 
  Target, 
  CheckCircle2, 
  Clock, 
  Compass, 
  Plus, 
  BookOpen, 
  Share2, 
  Layers, 
  X,
  AlertTriangle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ModalShell } from '../../motion';
import type { SeasonEvent } from '../../types';

export const SeasonPlanner: React.FC = () => {
  const { seasonEvents, updateSeasonEvent, addSeasonEvent, currentUser } = useApp();
  
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New event form state
  const [newEvent, setNewEvent] = useState({
    title: '',
    acronym: '',
    category: 'Major Event' as SeasonEvent['category'],
    theme: '',
    dateOrQuarter: '',
    targetMetric: '',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: '',
    venue: '',
    status: 'Planned' as SeasonEvent['status'],
    isPublic: true
  });

  const filteredEvents = seasonEvents.filter(e => {
    return categoryFilter === 'all' || e.category === categoryFilter;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    addSeasonEvent({
      ...newEvent
    });
    setIsAddModalOpen(false);
    setNewEvent({
      title: '',
      acronym: '',
      category: 'Major Event',
      theme: '',
      dateOrQuarter: '',
      targetMetric: '',
      responsibleCommittee: 'Technical & Engineering Committee',
      description: '',
      venue: '',
      status: 'Planned',
      isPublic: true
    });
  };

  const handleStatusChange = (id: string, status: SeasonEvent['status']) => {
    updateSeasonEvent(id, { status });
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Season 2026–2027 Master Strategic Planner</h1>
          <p className="text-xs text-slate-500">
            Authoritative roadmap: 4 Major Summits, 10 Workshops, 32 Professional Sessions, 3 Scientific Magazine Issues, and Social Media Deliverables.
          </p>
        </div>

        {currentUser.role === 'super_admin' && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Add Milestone / Event
          </button>
        )}
      </div>

      {/* Category Filter */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {['all', 'Major Event', 'Workshop', 'Magazine Issue', 'Field Campaign'].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-[#123B60] text-white shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
              }`}
            >
              {cat === 'all' ? 'All Deliverables' : cat}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <strong>{filteredEvents.length}</strong> planned season milestones
        </div>
      </div>

      {/* Events Roadmap Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEvents.map((evt) => (
          <div
            key={evt.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="px-2.5 py-0.5 rounded-full bg-[#123B60] text-white font-bold text-[10px] uppercase">
                  {evt.category}
                </span>
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                  evt.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' :
                  evt.status === 'In Preparation' ? 'bg-amber-100 text-amber-800' :
                  evt.status === 'Confirmed' ? 'bg-blue-100 text-blue-800' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {evt.status}
                </span>
              </div>

              <h2 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                {evt.title}
              </h2>
              {evt.acronym && (
                <span className="text-xs font-extrabold text-[#F59A16] uppercase mt-0.5 block">
                  [{evt.acronym}]
                </span>
              )}

              <p className="text-xs text-slate-500 mt-2 line-clamp-3 leading-relaxed">
                {evt.description}
              </p>

              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Date/Window:</span>
                  <strong className="text-slate-800 dark:text-slate-200">{evt.dateOrQuarter}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Target KPI:</span>
                  <strong className="text-[#F59A16]">{evt.targetMetric}</strong>
                </div>
                {evt.venue && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Venue:</span>
                    <span className="text-slate-600 dark:text-slate-300 truncate max-w-[150px]">{evt.venue}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Status Update for Leadership */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 mt-4 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">Update State:</span>
              <select
                value={evt.status}
                onChange={(e) => handleStatusChange(evt.id, e.target.value as any)}
                className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-semibold outline-none text-slate-700 dark:text-slate-300"
              >
                <option value="Planned">Planned</option>
                <option value="In Preparation">In Preparation</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>
        ))}
      </div>

      {/* Add Modal */}
      <ModalShell open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Add Season Milestone</h2>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  placeholder="e.g. Non-Destructive Testing (NDT) Workshop"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <select
                    value={newEvent.category}
                    onChange={(e) => setNewEvent({ ...newEvent, category: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    <option value="Major Event">Major Event</option>
                    <option value="Workshop">Workshop</option>
                    <option value="Professional Session">Professional Session</option>
                    <option value="Magazine Issue">Magazine Issue</option>
                    <option value="Field Campaign">Field Campaign</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Date / Month</label>
                  <input
                    type="text"
                    required
                    value={newEvent.dateOrQuarter}
                    onChange={(e) => setNewEvent({ ...newEvent, dateOrQuarter: e.target.value })}
                    placeholder="e.g. February 2027"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Target KPI Metric</label>
                <input
                  type="text"
                  required
                  value={newEvent.targetMetric}
                  onChange={(e) => setNewEvent({ ...newEvent, targetMetric: e.target.value })}
                  placeholder="e.g. 150+ Attendees, 80%+ Completion"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newEvent.description}
                  onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                  placeholder="Scope, speakers, and agenda details..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl"
                >
                  Save Milestone
                </button>
              </div>
            </form>
      </ModalShell>

    </div>
  );
};
