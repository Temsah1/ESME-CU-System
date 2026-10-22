import React, { useMemo, useState } from 'react';
import { ShieldAlert, Database, History, Activity, CircleCheck, CircleX, UserRoundCog, Trash2, RotateCcw } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthProvider';
import { useToast, ModalShell } from '../../motion';
import { ROLE_LABELS } from '../../domain/roles';
import { TEST_ACCOUNT_FIXTURES, TEST_ACCOUNT_NOTE } from '../../domain/testAccounts';
import type { TestAccountReport } from '../../domain/testAccounts';

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
    storageMigration,
    can,
    seedTestAccounts,
    removeTestAccounts
  } = useApp();
  const { adapter, status: authStatus } = useAuth();
  const currentUser = useActor();
  const { toast } = useToast();

  const [report, setReport] = useState<{ ranAt: string; findings: Finding[] } | null>(null);
  const [seedReport, setSeedReport] = useState<TestAccountReport | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testAccountError, setTestAccountError] = useState('');
  const [testAccountBusy, setTestAccountBusy] = useState(false);

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

    return findings;
  }, [users, committees, tasks, submissions, scoreLedger, skillMatrix]);

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

  const maySeedTesters = can('users.create');
  const mayDeleteTesters = can('users.delete');

  const testerRow = (email: string) => users.find((u) => u.email.trim().toLowerCase() === email);
  const committeeName = (id?: string) => committees.find((c) => c.id === id)?.name;

  const reportToast = (result: TestAccountReport, kind: 'seed' | 'remove') => {
    if (result.refusal) {
      toast('The provider refused this action. The reason is printed on the page.', 'error');
      return;
    }
    toast(
      kind === 'seed'
        ? `Test accounts: ${result.created.length} created, ${result.repaired.length} reset.`
        : `Test accounts: ${result.removed.length} deleted.`,
      'success'
    );
  };

  const runSeedTesters = async () => {
    setTestAccountError('');
    setTestAccountBusy(true);
    try {
      const result = await seedTestAccounts();
      setSeedReport(result);
      reportToast(result, 'seed');
    } catch (error) {
      setTestAccountError(error instanceof Error ? error.message : 'The seed did not run.');
    } finally {
      setTestAccountBusy(false);
    }
  };

  const runDeleteTesters = async () => {
    setConfirmDelete(false);
    setTestAccountError('');
    setTestAccountBusy(true);
    try {
      const result = await removeTestAccounts();
      setSeedReport(result);
      reportToast(result, 'remove');
    } catch (error) {
      setTestAccountError(error instanceof Error ? error.message : 'Nothing was deleted.');
    } finally {
      setTestAccountBusy(false);
    }
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
              ? `Storage migration ran on load: ${storageMigration.removedKeys.length} key(s) retired, ${storageMigration.carriedKeys.length} carried over.`
              : `Already at ${storageVersion}; no migration needed on this load.`}
          </p>
          {storageMigration.notes.length > 0 && (
            <ul className="mt-1 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              {storageMigration.notes.map((note) => (
                <li key={note}>- {note}</li>
              ))}
            </ul>
          )}
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

      {/* Seeded test accounts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-[#123B60] dark:text-[#F59A16]">
            <UserRoundCog className="w-5 h-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Test accounts</h2>
            <p className="text-[11px] text-slate-400">
              Three provisioned sign-ins for checking the role-based screens. Seeding adds the missing ones and
              re-applies the password, role and committee of the ones that already exist; it refuses an address that
              belongs to somebody else rather than taking it over.
            </p>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {adapter?.kind === 'local-dev'
            ? 'These accounts are written to the local development vault in this browser — the same place every other development identity lives, and the same place that is not production authentication.'
            : 'Against the real provider these rows are created by an operator in the SQL editor, never from a browser: an endpoint that opens auth identities is granted to the service role only, and the guard refuses an environment that has not been declared as development or staging.'}
        </p>

        <ul className="grid grid-cols-1 gap-3">
          {TEST_ACCOUNT_FIXTURES.map((fixture) => {
            const row = testerRow(fixture.email);
            return (
              <li
                key={fixture.fixtureKey}
                className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-4 py-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    {fixture.displayName} · {ROLE_LABELS[fixture.role]}
                  </span>
                  <span
                    className={
                      row
                        ? 'text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400'
                        : 'text-[10px] font-bold uppercase tracking-wider text-slate-400'
                    }
                  >
                    {row ? `${TEST_ACCOUNT_NOTE} · seeded` : 'not seeded'}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  <span>{fixture.email}</span>
                  <span>{fixture.username}</span>
                  {/* The fixture password is published in the repository on purpose: it only ever opens a
                      development sandbox. A real account's password is never printed anywhere. */}
                  <span>password: {fixture.password}</span>
                  <span>committee: {committeeName(row?.committeeId ?? fixture.committeeId) ?? `${fixture.committeeId} (not in this workspace)`}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{fixture.exercises}</p>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          {maySeedTesters ? (
            <button
              type="button"
              onClick={runSeedTesters}
              disabled={testAccountBusy}
              className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition flex items-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden />
              Seed or reset test accounts
            </button>
          ) : (
            <p className="text-[11px] text-slate-400">
              Seeding opens accounts, so it needs <code>users.create</code> — this role does not hold it, and the
              store refuses the call whether or not this control were here.
            </p>
          )}
          {mayDeleteTesters && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={testAccountBusy}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition flex items-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden />
              Delete test accounts
            </button>
          )}
        </div>

        {testAccountError && (
          <p className="text-xs text-rose-700 dark:text-rose-300 inline-flex items-start gap-1.5">
            <CircleX className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            {testAccountError}
          </p>
        )}

        {seedReport && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-xs space-y-2">
            {seedReport.refusal ? (
              <p className="font-mono text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed whitespace-pre-wrap">
                {seedReport.refusal}
              </p>
            ) : (
              <>
                <p className="font-bold text-slate-800 dark:text-slate-100">
                  {seedReport.created.length + seedReport.repaired.length + seedReport.removed.length} account(s) affected
                </p>
                <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                  {seedReport.created.map((r) => (
                    <li key={`c-${r.email}`}>created · {r.email} · {ROLE_LABELS[r.role]}</li>
                  ))}
                  {seedReport.repaired.map((r) => (
                    <li key={`r-${r.email}`}>reset · {r.email} · {ROLE_LABELS[r.role]}</li>
                  ))}
                  {seedReport.removed.map((email) => (
                    <li key={`d-${email}`}>deleted · {email}</li>
                  ))}
                  {seedReport.conflicts.map((c) => (
                    <li key={`x-${c.fixtureKey}`} className="text-rose-700 dark:text-rose-300">
                      refused · {c.reason}
                    </li>
                  ))}
                  {seedReport.unresolvedCommittees.map((id) => (
                    <li key={`u-${id}`} className="text-amber-700 dark:text-amber-300">
                      unseated · this workspace has no committee “{id}”, so the tester was created without one
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-400">
                  No password is written to the audit trail; the entry records the accounts touched and by whom.
                </p>
              </>
            )}
          </div>
        )}
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

      <ModalShell
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600">
            <ShieldAlert className="w-5 h-5" aria-hidden />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Delete the seeded test accounts?</h2>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          This removes exactly {TEST_ACCOUNT_FIXTURES.map((f) => f.email).join(', ')} and nothing else. An account
          whose address or username is not one of those three is never touched, and a leadership seat a tester held
          is left vacant rather than pointed at somebody else.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Keep them
          </button>
          <button
            type="button"
            onClick={runDeleteTesters}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition"
          >
            Delete the three testers
          </button>
        </div>
      </ModalShell>

    </div>
  );
};
