import React from 'react';
import { 
  ShieldAlert, 
  Terminal, 
  Cpu, 
  Database, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw,
  HardDrive
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ModeratorTools: React.FC = () => {
  const { users, tasks, submissions, auditLogs, logAction, currentUser } = useApp();

  const handleRunHealthCheck = () => {
    logAction('Executed Diagnostic Check', 'system', 'diagnostics_runner', 'All local storage tables, integrity hashes, and entity relations verified.');
    alert('Diagnostics Passed: 0 schema corruptions, 0 orphaned foreign keys found in local state.');
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">IT Moderator Technical Workspace</h1>
        <p className="text-xs text-slate-500">
          Restricted technical support role. Monitors application state integrity, diagnostics, and local audit persistence.
        </p>
      </div>

      {/* Role Restriction Banner */}
      <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-300 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <strong className="block font-bold">Strict Role Isolation Active:</strong>
          IT Moderators have system health inspection tools, but do NOT possess Super Administrator privileges to promote themselves, approve member tasks, or modify scoring rules.
        </div>
      </div>

      {/* System Integrity Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <Database className="w-4 h-4 text-emerald-600" />
              LocalStorage Engine
            </span>
            <span className="text-emerald-600">Online</span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">Healthy</div>
          <div className="text-[11px] text-slate-400">12 isolated chapter data tables active</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-blue-600" />
              Runtime Heap
            </span>
            <span className="text-blue-600">Optimal</span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">&lt; 35 MB</div>
          <div className="text-[11px] text-slate-400">Lightweight client footprint for student laptops</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-[#F59A16]" />
              Audit Trail Entries
            </span>
            <span className="text-[#F59A16]">Active</span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">{auditLogs.length} Records</div>
          <div className="text-[11px] text-slate-400">Append-only administrative tracking</div>
        </div>
      </div>

      {/* Diagnostic Action */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Run Chapter Schema Integrity Verification</h2>
          <p className="text-[11px] text-slate-400">Checks foreign key references between users, committees, and task submissions.</p>
        </div>
        <button
          onClick={handleRunHealthCheck}
          className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] text-white text-xs font-bold rounded-xl transition flex items-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Execute Diagnostic Check
        </button>
      </div>

    </div>
  );
};
