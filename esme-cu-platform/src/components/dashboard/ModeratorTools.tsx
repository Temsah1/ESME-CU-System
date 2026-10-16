import React, { useMemo, useState } from 'react';
import { ShieldAlert, Database, History, Activity, CircleCheck, CircleX } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../motion';

type Finding = { table: string; id: string; problem: string };

export const ModeratorTools: React.FC = () => {
  const {
    users,
    committees,
    tasks,
    submissions,
    scoreLedger,
    applications,
    skillMatrix,
    auditLogs,
    logAction,
    storageVersion,
    storageMigration
  } = useApp();
  const { adapter, status: authStatus } = useAuth();
  const currentUser = useActor();
  const { toast } = useToast();

  const [report, setReport] = useState<{ ranAt: string; findings: Finding[] } | null>(null);

  /**
   * Every number and verdict on this page is computed from the records actually held
   * in this workspace. Nothing here reports a health status it has not measured.
   */
  const integrity = useMemo(() => {
    const findings: Finding[] = [];
    const committeeIds = new Set(committees.map((c) => c.id));
    const userIds = new Set(users.map((u) => u.id));
    const taskIds = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      if (task.committeeId && !committeeIds.has(task.committeeId)) {
        findings.push({ table: 'tasks', id: task.id, problem: `references unknown committee "${task.committeeId}"` });
      }
      for (const assignee of task.assigneeIds) {
        if (!userIds.has(assignee)) {
          findings.push({ table: 'tasks', id: task.id, problem: `assigns unknown member "${assignee}"` });
        }
      }
    }

    for (const submission of submissions) {
      if (!taskIds.has(submission.taskId)) {
        findings.push({ table: 'submissions', id: submission.id, problem: `references unknown task "${submission.taskId}"` });
      }
      if (!userIds.has(submission.memberId)) {
        findings.push({ table: 'submissions', id: submission.id, problem: `submitted by unknown member "${submission.memberId}"` });
      }
    }

    for (const entry of scoreLedger) {
      if (!userIds.has(entry.memberId)) {
        findings.push({ table: 'score_ledger', id: entry.id, problem: `credits unknown member "${entry.memberId}"` });
      }
      if (entry.taskId && !taskIds.has(entry.taskId)) {
        findings.push({ table: 'score_ledger', id: entry.id, problem: `credits unknown task "${entry.taskId}"` });
      }
      if (entry.committeeId && !committeeIds.has(entry.committeeId)) {
        findings.push({ table: 'score_ledger', id: entry.id, problem: `booked to unknown committee "${entry.committeeId}"` });
      }
    }

    // One completion may credit a member only once; the provider enforces this with an index.
    const credited = new Set<string>();
    for (const entry of scoreLedger) {
      if (entry.actionType !== 'task_completion' || !entry.taskId) continue;
      const key = `${entry.memberId}::${entry.taskId}`;
      if (credited.has(key)) {
        findings.push({ table: 'score_ledger', id: entry.id, problem: `duplicate completion award for task "${entry.taskId}"` });
      }
      credited.add(key);
    }

    for (const user of users) {
      if (user.committeeId && !committeeIds.has(user.committeeId)) {
        findings.push({ table: 'profiles', id: user.id, problem: `member of unknown committee "${user.committeeId}"` });
      }
    }

    for (const skill of skillMatrix) {
      if (!userIds.has(skill.memberId)) {
        findings.push({ table: 'skill_matrix', id: skill.id, problem: `assesses unknown member "${skill.memberId}"` });
      }
    }

    for (const application of applications) {
      if (application.status === 'accepted' && !application.emailVerified) {
        findings.push({ table: 'registration_requests', id: application.id, problem: 'accepted without a verified email address' });
      }
    }

    return findings;
  }, [users, committees, tasks, submissions, scoreLedger, applications, skillMatrix]);

  const runVerification = () => {
    const ranAt = new Date().toLocaleString();
    setReport({ ranAt, findings: integrity });
    logAction(
      'Ran Referential Integrity Check',
      'system',
      'integrity_check',
      integrity.length === 0
        ? `Scanned ${users.length + committees.length + tasks.length + submissions.length + scoreLedger.length + applications.length + skillMatrix.length} rows across 7 tables — no broken references`
        : `${integrity.length} broken reference(s) found`
    );
    toast(
      integrity.length === 0
        ? 'Verification complete: no broken references found.'
        : `Verification complete: ${integrity.length} issue(s) listed below.`,
      integrity.length === 0 ? 'success' : 'error'
    );
  };

  const tables = [
    { name: 'profiles', rows: users.length },
    { name: 'committees', rows: committees.length },
    { name: 'tasks', rows: tasks.length },
    { name: 'submissions', rows: submissions.length },
    { name: 'score_ledger', rows: scoreLedger.length },
    { name: 'registration_requests', rows: applications.length },
    { name: 'skill_matrix', rows: skillMatrix.length },
    { name: 'audit_log', rows: auditLogs.length },
  ];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">Technical Support Workspace</h1>
        <p className="text-xs text-slate-500">
          Inspects the records this workspace holds and reports what it finds — including findings of zero rows.
        </p>
      </div>

      {/* Capability boundary */}
      <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-300 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <strong className="block font-bold">Capability boundary</strong>
          This account ({currentUser.role.replace('_', ' ')}) may read and verify records. Granting roles, suspending
          accounts and changing settings are separate capabilities held by a Super Administrator; they are enforced by
          the provider, so no tool on this page can widen it.
        </div>
      </div>

      {/* Runtime facts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
            <Database className="w-4 h-4 text-emerald-600" /> Authentication
          </span>
          <div className="text-sm font-black text-slate-900 dark:text-white">
            {adapter ? adapter.kind : 'Not configured'}
          </div>
          <p className="text-[11px] text-slate-400">
            Session state: {authStatus}.{' '}
            {adapter?.kind === 'local-dev'
              ? 'Browser-storage fallback used for development only — it is not production authentication.'
              : adapter
                ? 'Identities, roles and account states are read from the provider.'
                : 'Set the provider environment variables to enable real sign-in.'}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
            <Activity className="w-4 h-4 text-blue-600" /> Local cache
          </span>
          <div className="text-sm font-black text-slate-900 dark:text-white">{storageVersion}</div>
          <p className="text-[11px] text-slate-400">
            {storageMigration.ran
              ? `V1 to V2 migration ran on load: ${storageMigration.removedKeys.length} key(s) retired, ${storageMigration.carriedKeys.length} carried over.`
              : `Already at ${storageVersion}; no migration needed on this load.`}
          </p>
          <p className="text-[11px] text-slate-400">
            Browser cache only. It holds reference content and whatever this device has recorded — it is not a server database.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
            <History className="w-4 h-4 text-[#F59A16]" /> Audit entries
          </span>
          <div className="text-sm font-black text-slate-900 dark:text-white">{auditLogs.length}</div>
          <p className="text-[11px] text-slate-400">
            Append-only record of administrative actions taken in this workspace.
          </p>
        </div>
      </div>

      {/* Row counts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Rows available to this account</h2>
          <p className="text-[11px] text-slate-400">
            Counts come from the records the provider returns for your scope. Zero means genuinely empty.
          </p>
        </div>
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {tables.map((t) => (
            <li key={t.name} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3 py-2.5">
              <div className="font-mono text-[10px] text-slate-400 truncate">{t.name}</div>
              <div className="text-lg font-black text-slate-800 dark:text-slate-100">{t.rows}</div>
            </li>
          ))}
        </ul>
      </div>

      {/* Diagnostic action */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Referential integrity check</h2>
          <p className="text-[11px] text-slate-400">
            Resolves every foreign key between profiles, committees, tasks, submissions and the points ledger.
            {integrity.length > 0 && (
              <span className="text-rose-600 font-bold"> {integrity.length} unresolved reference(s) right now.</span>
            )}
          </p>
        </div>
        <button
          onClick={runVerification}
          className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] text-white text-xs font-bold rounded-xl transition flex items-center gap-2 self-start sm:self-auto"
        >
          <CircleCheck className="w-3.5 h-3.5" />
          Run verification
        </button>
      </div>

      {report && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {report.findings.length === 0 ? 'Clean run' : `${report.findings.length} finding(s)`}
            </h2>
            <span className="text-[11px] text-slate-400">{report.ranAt}</span>
          </div>

          {report.findings.length === 0 ? (
            <p className="text-xs text-emerald-700 inline-flex items-center gap-1.5">
              <CircleCheck className="w-4 h-4" aria-hidden />
              No broken references among the rows that exist. With an empty workspace this proves only that nothing
              contradicts itself — it is not evidence of a populated, healthy backend.
            </p>
          ) : (
            <ul className="text-xs space-y-1.5">
              {report.findings.map((f, i) => (
                <li key={`${f.table}-${f.id}-${i}`} className="flex items-start gap-2 text-rose-700 dark:text-rose-300">
                  <CircleX className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <span className="font-mono text-[10px]">{f.table}</span> · {f.id} — {f.problem}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

    </div>
  );
};
