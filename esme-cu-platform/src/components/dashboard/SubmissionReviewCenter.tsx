import React, { useMemo, useState } from 'react';
import { Search, CheckCircle2, XCircle, RotateCcw, Award, ExternalLink, User, MessageSquare, X, Paperclip, Inbox, Eye } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { useStickyNonNull, ModalShell, useToast } from '../../motion';
import { scopeFor } from '../../domain/roles';
import { rubricFor, scoreRubric, type RubricMark } from '../../domain/workflow';
import { EmptyState } from '../EmptyState';
import type { TaskSubmission } from '../../types';

const STATUSES: TaskSubmission['status'][] = ['submitted', 'under_review', 'revision_requested', 'approved', 'rejected'];

const MARK_OPTIONS: { value: RubricMark; label: string }[] = [
  { value: 2, label: 'Met' },
  { value: 1, label: 'Partly' },
  { value: 0, label: 'Not met' },
];

export const SubmissionReviewCenter: React.FC = () => {
  const { submissions, tasks, reviewSubmission, startSubmissionReview, can } = useApp();
  const currentUser = useActor();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeSubmission, setActiveSubmission] = useState<TaskSubmission | null>(null);

  // Review action modal state
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected' | 'revision_requested' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [pointsToAward, setPointsToAward] = useState<number>(0);
  const [rubricMarks, setRubricMarks] = useState<Record<string, RubricMark | null>>({});

  // submissions.read is `self` for a member and `committee` for a head or director; the
  // queue only ever lists rows inside that scope, and each row re-checks review rights.
  const readScope = scopeFor(currentUser.role, 'submissions.read');
  const visibleSubmissions = useMemo(() => {
    if (readScope === 'self') return submissions.filter((s) => s.memberId === currentUser.id);
    if (readScope === 'committee') return submissions.filter((s) => s.committeeId === currentUser.committeeId);
    return submissions;
  }, [submissions, readScope, currentUser.id, currentUser.committeeId]);

  const mayReview = (sub: TaskSubmission) => can('submissions.review', { committeeId: sub.committeeId });

  const filteredSubmissions = visibleSubmissions.filter((s) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = s.taskTitle.toLowerCase().includes(term) || s.memberName.toLowerCase().includes(term);
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = visibleSubmissions.filter((s) => s.status === 'submitted' || s.status === 'under_review').length;

  const categoryOf = (sub: TaskSubmission) => tasks.find((t) => t.id === sub.taskId)?.category;

  const handleOpenReview = (sub: TaskSubmission, action: 'approved' | 'rejected' | 'revision_requested') => {
    setActiveSubmission(sub);
    setReviewAction(action);
    setPointsToAward(action === 'approved' ? sub.proposedPoints : 0);
    // No wording is pre-filled: a reviewer writes the judgement, the app does not supply one.
    setFeedback('');
    setRubricMarks({});
  };

  const handleStartReview = (sub: TaskSubmission) => {
    try {
      startSubmissionReview(sub.id);
      toast(`${sub.taskTitle} is now marked under review, with your name on it.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That step was not recorded.', 'error');
    }
  };

  const handleConfirmReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSubmission || !reviewAction) return;

    try {
      reviewSubmission(
        activeSubmission.id,
        reviewAction,
        feedback,
        reviewAction === 'approved' ? pointsToAward : 0,
        rubricMarks
      );
      toast(
        reviewAction === 'approved'
          ? `Approved and ${pointsToAward} pts written to the ledger.`
          : `Marked as ${reviewAction.replace('_', ' ')}.`,
        'success'
      );
      setActiveSubmission(null);
      setReviewAction(null);
      setFeedback('');
      setRubricMarks({});
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That decision was not recorded.', 'error');
    }
  };

  const viewSub = useStickyNonNull(activeSubmission);
  const viewAction = useStickyNonNull(reviewAction);
  const viewCriteria = rubricFor(viewSub ? categoryOf(viewSub) : undefined);
  const viewRubric = scoreRubric(viewCriteria, rubricMarks);

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Submission Review Queue</h1>
          <p className="text-xs text-slate-500">
            {visibleSubmissions.length} submission{visibleSubmissions.length === 1 ? '' : 's'} readable by your account,{' '}
            {pendingCount} awaiting a decision. Points reach the ledger only when a reviewer records a decision here.
          </p>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="search"
            aria-label="Search submissions by task title or member name"
            placeholder="Search submission by task title or member name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by workflow status"
          className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {/* Submissions List */}
      {visibleSubmissions.length === 0 ? (
        <EmptyState
          title={
            readScope === 'self'
              ? 'You have not submitted a deliverable yet'
              : 'The review queue is empty'
          }
          description={
            readScope === 'self'
              ? 'Deliverables you file from the task board appear here with the status the reviewer left on them.'
              : 'Nothing has been filed against a task in the scope your role can read. A queue fills when a member submits work, never before.'
          }
          icon={Inbox}
        />
      ) : filteredSubmissions.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-400">
          {visibleSubmissions.length} submission{visibleSubmissions.length === 1 ? '' : 's'} in view, but none match
          this search or status filter.
        </p>
      ) : (
      <div className="space-y-4">
        {filteredSubmissions.map((sub) => (
          <div
            key={sub.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-[#123B60] text-white font-bold text-[10px] uppercase">
                    {sub.committeeName}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    sub.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                    sub.status === 'revision_requested' ? 'bg-amber-100 text-amber-700' :
                    sub.status === 'rejected' ? 'bg-red-100 text-red-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {sub.status.replace('_', ' ')}
                  </span>
                </div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white mt-1.5">{sub.taskTitle}</h2>
              </div>

              <div className="text-right">
                <div className="text-xs font-bold text-[#F59A16] flex items-center sm:justify-end gap-1">
                  <Award className="w-4 h-4" />
                  <span>Proposed: {sub.proposedPoints} pts</span>
                </div>
                {sub.awardedPoints !== undefined && sub.status === 'approved' && (
                  <div className="text-[11px] font-bold text-emerald-600">
                    Awarded: +{sub.awardedPoints} pts
                  </div>
                )}
                <div className="text-[10px] text-slate-400 mt-0.5">Submitted: {sub.submittedAt}</div>
              </div>
            </div>

            {/* Member and Description */}
            <div className="text-xs space-y-2">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span>Submitted by: <strong>{sub.memberName}</strong></span>
              </div>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800">
                {sub.description}
              </p>
            </div>

            {/* Attachments / External Links */}
            {(sub.externalLinks?.length || sub.attachments?.length) ? (
              <div className="pt-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-slate-400">Attached Proofs:</span>
                {sub.attachments?.map((file, idx) => (
                  <a
                    key={`file-${idx}`}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] text-[#123B60] dark:text-[#F59A16] font-semibold hover:underline"
                  >
                    <Paperclip className="w-3 h-3" />
                    <span>{file.name}{file.size ? ` (${file.size})` : ''}</span>
                  </a>
                ))}
                {sub.externalLinks?.map((link, idx) => (
                  <a
                    key={idx}
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] text-[#123B60] dark:text-[#F59A16] font-semibold hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span className="max-w-[220px] truncate">{link}</span>
                  </a>
                ))}
              </div>
            ) : null}

            {/* Previous Reviewer Feedback */}
            {sub.reviewerFeedback && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-[#F59A16]" />
                  Reviewer Feedback ({sub.reviewedBy}):
                </div>
                <div>{sub.reviewerFeedback}</div>
              </div>
            )}

            {/* Recorded rubric: what the reviewer marked, and over how many criteria */}
            {sub.reviewRubric && sub.reviewRubric.length > 0 && (
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Review rubric — {sub.reviewRubric.length} of {rubricFor(categoryOf(sub)).length} criteria marked
                  </span>
                  {sub.rubricPercent !== null && sub.rubricPercent !== undefined && (
                    <span className="font-bold text-[#123B60] dark:text-[#F59A16]">{sub.rubricPercent}%</span>
                  )}
                </div>
                <ul className="grid sm:grid-cols-2 gap-x-3 gap-y-1">
                  {sub.reviewRubric.map((mark) => (
                    <li key={mark.label} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                      <span className="truncate">{mark.label}</span>
                      <span className={`font-bold ${mark.mark === 2 ? 'text-emerald-600' : mark.mark === 1 ? 'text-amber-600' : 'text-red-600'}`}>
                        {mark.mark === 2 ? 'Met' : mark.mark === 1 ? 'Partly' : 'Not met'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-slate-400">
                  Criteria left unmarked are excluded from this figure, never counted as zero.
                </p>
              </div>
            )}

            {/* Actions for reviewers who hold submissions.review for this committee */}
            {mayReview(sub) && sub.status !== 'approved' && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5">
                {sub.status === 'submitted' && (
                  <button
                    onClick={() => handleStartReview(sub)}
                    className="px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Take into review
                  </button>
                )}
                <button
                  onClick={() => handleOpenReview(sub, 'revision_requested')}
                  className="px-3.5 py-1.5 rounded-xl border border-amber-300 text-amber-700 dark:text-amber-400 text-xs font-bold hover:bg-amber-50 dark:hover:bg-amber-950/20 transition flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Request Revision
                </button>
                <button
                  onClick={() => handleOpenReview(sub, 'rejected')}
                  className="px-3.5 py-1.5 rounded-xl border border-red-300 text-red-700 dark:text-red-400 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-950/20 transition flex items-center gap-1.5"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Reject
                </button>
                <button
                  onClick={() => handleOpenReview(sub, 'approved')}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Approve & Award Points
                </button>
              </div>
            )}

            {!mayReview(sub) && (sub.status === 'submitted' || sub.status === 'under_review') && (
              <p className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">
                {readScope === 'self'
                  ? 'Your role files work but does not decide on it. This row stays read-only until a reviewer records a decision.'
                  : `Only a reviewer with rights over ${sub.committeeName} can decide this submission. Your account can read it, not act on it.`}
              </p>
            )}
          </div>
        ))}
      </div>
      )}

      {/* Review Action Modal */}
      <ModalShell open={!!activeSubmission && !!reviewAction} onClose={() => { setActiveSubmission(null); setReviewAction(null); }} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
          {viewSub && viewAction && (
          <>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white capitalize">
                  {viewAction.replace('_', ' ')} Submission
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{viewSub.taskTitle}</p>
              </div>
              <button onClick={() => { setActiveSubmission(null); setReviewAction(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmReview} className="space-y-4 text-xs">
              {viewAction === 'approved' && viewSub.memberId === currentUser.id && (
                <p className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-[11px] text-red-700 dark:text-red-300">
                  You filed this work yourself. Independent review is required, so this approval will be refused —
                  return it for revision or leave it for another reviewer.
                </p>
              )}
              {viewAction === 'approved' && (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="award-points">
                    Points to Award
                  </label>
                  <input
                    id="award-points"
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={pointsToAward}
                    onChange={(e) => setPointsToAward(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-emerald-600 outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Confirming writes one ledger entry for {viewSub.memberName} carrying your name and this point value.
                  </p>
                </div>
              )}

              <fieldset className="space-y-2">
                <legend className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Review rubric — {categoryOf(viewSub) ?? 'General work'}
                </legend>
                <p className="text-[11px] text-slate-400 -mt-0.5">
                  {viewAction === 'approved'
                    ? 'An approval records a standard, so at least 2 criteria must be marked. Unmarked criteria are excluded from the score, never treated as zero.'
                    : 'Optional for this decision. Marks you leave here are stored with the submission as its quality record.'}
                </p>
                {viewCriteria.map((criterion) => (
                  <div
                    key={criterion.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-slate-200">{criterion.label}</p>
                        <p className="text-[11px] text-slate-500">{criterion.guidance}</p>
                      </div>
                      <div className="flex items-center gap-1.5" role="group" aria-label={`Mark for ${criterion.label}`}>
                        {MARK_OPTIONS.map((option) => {
                          const selected = rubricMarks[criterion.id] === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={selected}
                              onClick={() =>
                                setRubricMarks((prev) => ({ ...prev, [criterion.id]: selected ? null : option.value }))
                              }
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                                selected
                                  ? option.value === 2
                                    ? 'bg-emerald-600 border-emerald-600 text-white'
                                    : option.value === 1
                                      ? 'bg-amber-500 border-amber-500 text-white'
                                      : 'bg-red-600 border-red-600 text-white'
                                  : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-slate-500">
                  {viewRubric.percent === null
                    ? 'Nothing marked yet — this decision carries no quality figure.'
                    : `Recorded as ${viewRubric.percent}% over ${viewRubric.assessed} of ${viewCriteria.length} criteria (${viewRubric.verdict.replace(/_/g, ' ')}).`}
                  {viewRubric.unassessed.length > 0 &&
                    ` Excluded as unassessed: ${viewRubric.unassessed.join(', ')}.`}
                </p>
              </fieldset>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="review-feedback">
                  {viewAction === 'revision_requested' ? 'Revision Instructions (Required)' : 'Review Feedback & Notes'}
                </label>
                <textarea
                  id="review-feedback"
                  required={viewAction === 'revision_requested'}
                  minLength={viewAction === 'revision_requested' ? 15 : undefined}
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={viewAction === 'revision_requested' ? 'Specify what is missing or must be fixed (at least 15 characters)...' : 'Your reasoning for this decision...'}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => { setActiveSubmission(null); setReviewAction(null); }}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 font-bold rounded-xl text-white ${
                    viewAction === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' :
                    viewAction === 'revision_requested' ? 'bg-amber-600 hover:bg-amber-700' :
                    'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  Confirm {viewAction.replace('_', ' ')}
                </button>
              </div>
            </form>
          </>
          )}
      </ModalShell>

    </div>
  );
};
