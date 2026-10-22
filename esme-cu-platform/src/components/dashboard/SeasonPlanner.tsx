import React, { useMemo, useState } from 'react';
import { Plus, X, CalendarDays, ClipboardCopy } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { seasonCovering, seasonsInOrder } from '../../domain/seasons';
import { ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import type { SeasonEvent } from '../../types';

const CATEGORIES: SeasonEvent['category'][] = [
  'Major Event',
  'Workshop',
  'Professional Session',
  'Magazine Issue',
  'Field Campaign',
];

const STATUSES: SeasonEvent['status'][] = ['Planned', 'In Preparation', 'Confirmed', 'Completed'];

const BLANK_EVENT = {
  title: '',
  acronym: '',
  category: 'Major Event' as SeasonEvent['category'],
  theme: '',
  dateOrQuarter: '',
  targetMetric: '',
  responsibleCommittee: '',
  description: '',
  venue: '',
  status: 'Planned' as SeasonEvent['status'],
  isPublic: true,
};

export const SeasonPlanner: React.FC = () => {
  const { seasonEvents, updateSeasonEvent, addSeasonEvent, loadReferenceSeasonPlan, seasons, committees, can } = useApp();
  const { toast } = useToast();

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newEvent, setNewEvent] = useState(BLANK_EVENT);

  const mayPlan = can('events.write');

  // The plan is named after the season someone recorded, not after a year this screen assumes.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const activeSeason = useMemo(() => {
    const ordered = seasonsInOrder(seasons);
    return seasonCovering(ordered, today) ?? ordered.find((s) => s.status === 'active') ?? null;
  }, [seasons, today]);

  const filteredEvents = useMemo(
    () => seasonEvents.filter((e) => categoryFilter === 'all' || e.category === categoryFilter),
    [seasonEvents, categoryFilter]
  );

  const statusSummary = useMemo(() => {
    const counts = new Map<SeasonEvent['status'], number>();
    for (const event of seasonEvents) counts.set(event.status, (counts.get(event.status) ?? 0) + 1);
    return STATUSES.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s.toLowerCase()}`).join(', ');
  }, [seasonEvents]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addSeasonEvent({ ...newEvent, responsibleCommittee: newEvent.responsibleCommittee || 'Not yet assigned' });
      setIsAddModalOpen(false);
      setNewEvent(BLANK_EVENT);
      toast('Milestone added to the season plan.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The milestone was not added.', 'error');
    }
  };

  const handleStatusChange = (id: string, status: SeasonEvent['status']) => {
    try {
      updateSeasonEvent(id, { status });
      toast(`Marked "${seasonEvents.find((e) => e.id === id)?.title ?? id}" as ${status}.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The status was not changed.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">
            {activeSeason ? `Season ${activeSeason.label} Planner` : 'Season Planner'}
          </h1>
          <p className="text-xs text-slate-500">
            {seasonEvents.length} milestone{seasonEvents.length === 1 ? '' : 's'} written into the plan
            {statusSummary ? ` — ${statusSummary}` : ''}. Status changes here are editorial: they record what the
            planning committee decided, and nothing marks an event complete on its own.
            {!activeSeason && ' No dated season is recorded yet, so this planner is not filed under any season label.'}
          </p>
        </div>

        {mayPlan && (
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {seasonEvents.length === 0 && (
              <button
                onClick={() => {
                  const added = loadReferenceSeasonPlan();
                  toast(
                    added === 0
                      ? 'Every milestone from the transcribed plan is already written.'
                      : `${added} milestone(s) copied in from the transcribed 2026–2027 plan as drafts.`,
                    'success'
                  );
                }}
                className="px-4 py-2 bg-white dark:bg-slate-900 text-[#123B60] dark:text-[#F59A16] text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 hover:border-[#F59A16] transition flex items-center gap-1.5"
              >
                <ClipboardCopy className="w-4 h-4" />
                Copy the transcribed plan
              </button>
            )}
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add Milestone / Event
            </button>
          </div>
        )}
      </div>

      {!mayPlan && (
        <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 text-xs text-slate-600 dark:text-slate-300">
          You are reading the plan. Adding a milestone or changing a status needs the{' '}
          <span className="font-mono text-[10px]">events.write</span> capability, which your role does not hold — the
          cards below carry no controls because that write would be refused.
        </p>
      )}

      {/* Category Filter */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {['all', ...CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              aria-pressed={categoryFilter === cat}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-[#123B60] text-white shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {cat === 'all' ? 'All deliverables' : cat}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <strong>{filteredEvents.length}</strong> of {seasonEvents.length} written milestones
        </div>
      </div>

      {/* Events Roadmap Grid */}
      {seasonEvents.length === 0 ? (
        <EmptyState
          title="The season plan has no milestones yet"
          description="This planner starts empty — no milestones are seeded on first load. Someone holding the events capability writes them here, or copies the transcribed vision list in with the button above; either way they stay as written targets until a result is recorded against them."
          icon={CalendarDays}
          action={
            mayPlan ? (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-4 py-2 bg-[#123B60] text-white text-xs font-bold rounded-xl"
              >
                Write the first milestone
              </button>
            ) : undefined
          }
        />
      ) : filteredEvents.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-400">
          {seasonEvents.length} milestone{seasonEvents.length === 1 ? '' : 's'} exist, but none are filed under{' '}
          {categoryFilter.toLowerCase()}.
        </p>
      ) : (
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
                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider text-slate-700 dark:text-slate-100 ${
                    evt.status === 'Completed' ? 'bg-emerald-100 dark:bg-emerald-900/40' :
                    evt.status === 'In Preparation' ? 'bg-amber-100 dark:bg-amber-900/40' :
                    evt.status === 'Confirmed' ? 'bg-blue-100 dark:bg-blue-900/40' :
                    'bg-slate-100 dark:bg-slate-800'
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
                  {evt.description || 'No description recorded for this milestone.'}
                </p>

                <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Date/window:</span>
                    <strong className="text-slate-800 dark:text-slate-200">{evt.dateOrQuarter}</strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Target written:</span>
                    <strong className="text-[#F59A16] text-right">{evt.targetMetric || 'None stated'}</strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Result recorded:</span>
                    <span className="text-slate-600 dark:text-slate-300 text-right">
                      {evt.actualMetric || 'Nothing recorded yet'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Owner:</span>
                    <span className="text-slate-600 dark:text-slate-300 text-right truncate max-w-[160px]">
                      {evt.responsibleCommittee || 'Not yet assigned'}
                    </span>
                  </div>
                  {evt.venue && (
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Venue:</span>
                      <span className="text-slate-600 dark:text-slate-300 truncate max-w-[150px]">{evt.venue}</span>
                    </div>
                  )}
                </div>
              </div>

              {mayPlan && (
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 mt-4 flex items-center justify-between gap-2">
                  <label htmlFor={`status-${evt.id}`} className="text-[11px] text-slate-400">Record state:</label>
                  <select
                    id={`status-${evt.id}`}
                    value={evt.status}
                    onChange={(e) => handleStatusChange(evt.id, e.target.value as SeasonEvent['status'])}
                    className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-semibold outline-none text-slate-700 dark:text-slate-300"
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      <ModalShell open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Add Season Milestone</h2>
          <button onClick={() => setIsAddModalOpen(false)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="evt-title">Title</label>
            <input
              id="evt-title"
              type="text"
              required
              value={newEvent.title}
              onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
              placeholder="Name the event exactly as the chapter calls it"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="evt-category">Category</label>
              <select
                id="evt-category"
                value={newEvent.category}
                onChange={(e) => setNewEvent({ ...newEvent, category: e.target.value as SeasonEvent['category'] })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="evt-date">Date / month</label>
              <input
                id="evt-date"
                type="text"
                required
                value={newEvent.dateOrQuarter}
                onChange={(e) => setNewEvent({ ...newEvent, dateOrQuarter: e.target.value })}
                placeholder="e.g. February 2027"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="evt-owner">Responsible committee</label>
              <select
                id="evt-owner"
                value={newEvent.responsibleCommittee}
                onChange={(e) => setNewEvent({ ...newEvent, responsibleCommittee: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
              >
                <option value="">Not yet assigned</option>
                {committees.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="evt-venue">Venue</label>
              <input
                id="evt-venue"
                type="text"
                value={newEvent.venue}
                onChange={(e) => setNewEvent({ ...newEvent, venue: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="evt-target">Target to write down</label>
            <input
              id="evt-target"
              type="text"
              required
              value={newEvent.targetMetric}
              onChange={(e) => setNewEvent({ ...newEvent, targetMetric: e.target.value })}
              placeholder="e.g. 150 attendees — a plan, not a measured result"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="evt-desc">Description</label>
            <textarea
              id="evt-desc"
              rows={2}
              value={newEvent.description}
              onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
              placeholder="Scope, speakers and agenda details..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold"
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
