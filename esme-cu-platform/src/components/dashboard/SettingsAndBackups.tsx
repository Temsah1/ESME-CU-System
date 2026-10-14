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

export const SettingsAndBackups: React.FC = () => {
  const { 
    theme, 
    toggleTheme, 
    resetToDefaultData, 
    exportDataJSON, 
    importDataJSON
  } = useApp();

  const [importText, setImportText] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

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
    const confirmed = window.confirm(
      'Are you sure you want to reset all chapter data to default factory records? All unsaved local tasks and points will be reset.'
    );
    if (confirmed) {
      resetToDefaultData();
      setSuccessMsg('All records reset to default 2026-2027 season baseline.');
      setTimeout(() => setSuccessMsg(''), 4000);
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
              {theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Appearance & Theme</h2>
              <p className="text-[11px] text-slate-400">Toggle light or dark interface theme</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Current Theme: <strong className="capitalize">{theme}</strong>
            </span>
            <button
              onClick={toggleTheme}
              className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-[#F59A16]" /> : <Moon className="w-4 h-4 text-slate-600" />}
              Switch to {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
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
            Exports all active state from LocalStorage into an offline JSON snapshot file compatible with restore.
          </p>

          <button
            onClick={handleExport}
            className="w-full py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm"
          >
            <Download className="w-4 h-4" />
            Download Full State JSON
          </button>
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
        </div>

        {/* Factory Reset Danger Zone */}
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 rounded-3xl p-6 shadow-sm space-y-4 md:col-span-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-rose-600 dark:text-rose-400">Danger Zone: Factory Reset Demo State</h2>
              <p className="text-[11px] text-slate-400">Clear all local storage modifications and restore initial dataset</p>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Resetting clears customized tasks, modified applications, new members, and ledger history, restoring the 100% verified ESME Cairo University initial state.
          </p>

          <button
            onClick={handleReset}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm"
          >
            <RotateCcw className="w-4 h-4" />
            Reset State to Factory Defaults
          </button>
        </div>

      </div>

    </div>
  );
};
