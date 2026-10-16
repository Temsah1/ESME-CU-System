import React, { useState } from 'react';
import { 
  FileCheck2, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  RotateCcw, 
  Award, 
  Calendar, 
  ExternalLink, 
  User, 
  MessageSquare,
  AlertCircle,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useStickyNonNull, ModalShell } from '../../motion';
import type { TaskSubmission } from '../../types';

export const SubmissionReviewCenter: React.FC = () => {
  const { submissions, reviewSubmission, currentUser } = useApp();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeSubmission, setActiveSubmission] = useState<TaskSubmission | null>(null);

  // Review action modal state
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected' | 'revision_requested' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [pointsToAward, setPointsToAward] = useState<number>(100);

  const canReview = currentUser.role === 'super_admin' || currentUser.role === 'director' || currentUser.role === 'head';

  const filteredSubmissions = submissions.filter((s) => {
    const matchesSearch = s.taskTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.memberName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleOpenReview = (sub: TaskSubmission, action: 'approved' | 'rejected' | 'revision_requested') => {
    setActiveSubmission(sub);
    setReviewAction(action);
    setPointsToAward(sub.proposedPoints);
    setFeedback(action === 'approved' ? 'Exemplary work meeting all acceptance criteria.' : '');
  };

  const handleConfirmReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSubmission || !reviewAction) return;

    reviewSubmission(
      activeSubmission.id,
      reviewAction,
      feedback,
      reviewAction === 'approved' ? pointsToAward : 0
    );

    setActiveSubmission(null);
    setReviewAction(null);
    setFeedback('');
  };

  const viewSub = useStickyNonNull(activeSubmission);
  const viewAction = useStickyNonNull(reviewAction);

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Submission Review Queue</h1>
          <p className="text-xs text-slate-500">
            Verify member deliverables against criteria, provide constructive feedback, request revisions, and award points.
          </p>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search submission by task title or member name..."
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
          <option value="all">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="revision_requested">Revision Requested</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Submissions List */}
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
                {sub.externalLinks?.map((link, idx) => (
                  <a
                    key={idx}
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] text-[#123B60] dark:text-[#F59A16] font-semibold hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>View Shared Link {idx + 1}</span>
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

            {/* Actions for Reviewers */}
            {canReview && sub.status !== 'approved' && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
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
          </div>
        ))}
      </div>

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
              {viewAction === 'approved' && (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Points to Award</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={pointsToAward}
                    onChange={(e) => setPointsToAward(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-emerald-600 outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">This will update the organization scoring ledger and member total immediately.</p>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {viewAction === 'revision_requested' ? 'Revision Instructions (Required)' : 'Review Feedback & Notes'}
                </label>
                <textarea
                  required={viewAction === 'revision_requested'}
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={viewAction === 'revision_requested' ? 'Specify missing citations, formatting flaws, or required fixes...' : 'Feedback for the student...'}
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
