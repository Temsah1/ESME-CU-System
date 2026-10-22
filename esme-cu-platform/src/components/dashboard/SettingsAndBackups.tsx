import React, { useState } from 'react';
import { 
  Settings, 
  Download, 
  Upload, 
  RotateCcw, 
  ShieldAlert, 
  CheckCircle2, 
  Moon,
  Sun,
  AlertTriangle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ModalShell } from '../../motion';

export const SettingsAndBackups: React.FC = () => {
  const {
    theme,
    setTheme,
    resolvedTheme,
    can,
    resetLocalCache,
    exportDataJSON,
    importDataJSON,
    storageVersion
  } = useApp();

  const mayManageBackups = can('backups.manage');

  const [importText, setImportText] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const handleExport = () => {
    try {
      const dataStr = exportDataJSON();
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ESME_CU_Chapter_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setSuccessMsg('State backup exported successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch {
      setErrorMsg('Failed to export state backup.');
    }
  };

  const handleImport = () => {
    if (!importText.trim()) {
      setErrorMsg('Please paste valid JSON payload into the input area.');
      return;
    }
    const success = importDataJSON(importText);
    if (success) {
      setSuccessMsg('State snapshot successfully restored and verified!');
      setImportText('');
      setTimeout(() => setSuccessMsg(''), 4000);
    } else {
      setErrorMsg('Invalid JSON format or corrupted state schema.');
      setTimeout(() => setErrorMsg(''), 4000);
    }
  };

  const handleReset = () => {
    setConfirmReset(false);
    try {
      resetLocalCache();
      setSuccessMsg('Local cache cleared. Reference content reloaded.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'This browser’s cache was not cleared.');
      setTimeout(() => setErrorMsg(''), 4000);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-[#F59A16]" />
          Platform Settings & Data Backups
        </h1>
        <p className="text-xs text-slate-500">
          Manage local storage persistence, data backups, JSON snapshot restoration, and appearance configurations.
        </p>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-800 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          {errorMsg}
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Appearance Settings */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-[#F59A16]">
              {resolvedTheme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Appearance & Theme</h2>
              <p className="text-[11px] text-slate-400">Light, dark, or follow the device — saved in this browser</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Preference: <strong className="capitalize">{theme}</strong>
              </span>
              <span className="text-[11px] text-slate-400">Rendering: {resolvedTheme}</span>
            </div>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Theme preference">
              {(['light', 'dark', 'system'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  aria-pressed={theme === option}
                  className={`py-2 rounded-xl text-xs font-bold capitalize transition ${
                    theme === option
                      ? 'bg-[#123B60] text-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-[#F59A16]'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Export Data */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 text-blue-600">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Export State Backup</h2>
              <p className="text-[11px] text-slate-400">Download snapshot of all chapter rosters, tasks, points, and logs</p>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Exports what this browser holds for the workspace — including member names and contact details — as an
            offline JSON snapshot. Snapshots are a cache, not a backup of the provider database.
          </p>

          {mayManageBackups ? (
            <button
              onClick={handleExport}
              className="w-full py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download State JSON
            </button>
          ) : (
            <p className="text-[11px] text-slate-400">
              Export and restore require the backup capability, which your role does not hold.
            </p>
          )}
        </div>

        {/* Restore State from JSON */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4 md:col-span-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/30 text-purple-600">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Restore Snapshot from JSON</h2>
              <p className="text-[11px] text-slate-400">Paste an exported backup JSON to restore all tables</p>
            </div>
          </div>

          {mayManageBackups ? (
            <>
              <textarea
                rows={4}
                placeholder="Paste backup JSON string here..."
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="w-full p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-[#123B60]"
              />

              <div className="flex justify-end">
                <button
                  onClick={handleImport}
                  className="px-5 py-2.5 bg-[#123B60] hover:bg-[#0A2239] text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm"
                >
                  <Upload className="w-4 h-4" />
                  Restore Snapshot
                </button>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-slate-400">
              Restoring a snapshot overwrites this browser's copy of the workspace, so it is limited to accounts with
              the backup capability.
            </p>
          )}
        </div>

        {/* Local cache reset */}
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 rounded-3xl p-6 shadow-sm space-y-4 md:col-span-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-rose-600 dark:text-rose-400">Danger Zone: Clear This Browser's Cache</h2>
              <p className="text-[11px] text-slate-400">Removes locally cached edits and reloads the official reference content</p>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Cached edits to committees, form fields, the season plan and website content are replaced with the
            reference set, and the operational tables empty until the provider returns them.
            Nothing here deletes or rewrites data held by the authentication provider or the database —
            an account, once created there, stays there and must be handled from that side.
          </p>

          <div className="text-[11px] text-slate-400">Storage schema: {storageVersion}</div>

          {mayManageBackups ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Clear Local Cache
            </button>
          ) : (
            <p className="text-[11px] text-slate-400">
              Clearing the cache throws away this browser's copy of every operational table, so the store
              refuses the write for an account without the backup capability.
            </p>
          )}
        </div>

      </div>

      {/* The confirmation states what the write does before it happens, in the page rather than in a browser dialog. */}
      <ModalShell open={confirmReset} onClose={() => setConfirmReset(false)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600">
            <ShieldAlert className="w-5 h-5" aria-hidden />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Clear this browser's cache?</h2>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Cached edits to committees, form fields, the season plan and website content are replaced with the
          reference set, and this browser's copies of the operational tables empty until the provider returns
          them. Records stored by the authentication provider or the database are untouched, and any account
          created there stays there.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setConfirmReset(false)}
            className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Keep the cache
          </button>
          <button
            onClick={handleReset}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition"
          >
            Clear Local Cache
          </button>
        </div>
      </ModalShell>

    </div>
  );
};
