import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ArrowLeft, 
  Lock, 
  User as UserIcon, 
  LogIn, 
  Check, 
  Info,
  ChevronRight
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { User } from '../types';

interface LoginModalProps {
  onBackToHome: () => void;
  onLoginSuccess: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ 
  onBackToHome, 
  onLoginSuccess 
}) => {
  const { users, currentUser, setCurrentUser, logAction } = useApp();
  const [selectedUserId, setSelectedUserId] = useState<string>(currentUser.id);
  const [password, setPassword] = useState('••••••••');

  const handleSimulatedLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const userToLogin = users.find(u => u.id === selectedUserId);
    if (userToLogin) {
      setCurrentUser(userToLogin);
      logAction(`User Logged In: ${userToLogin.name} (${userToLogin.role})`, 'user', userToLogin.id, 'Authenticated via simulated portal selector.');
      onLoginSuccess();
    }
  };

  const handleQuickPersonaSelect = (user: User) => {
    setSelectedUserId(user.id);
    setCurrentUser(user);
    logAction(`Quick Switched to ${user.name} (${user.role})`, 'user', user.id, 'One-click role switch for demonstration.');
    onLoginSuccess();
  };

  const samplePersonas = [
    { label: 'Super Admin', user: users.find(u => u.role === 'super_admin')! },
    { label: 'Director (T&E)', user: users.find(u => u.id === 'usr_dir_te')! },
    { label: 'Head (NDT)', user: users.find(u => u.id === 'usr_head_te_inspection')! },
    { label: 'Active Member', user: users.find(u => u.id === 'usr_mem_te_1')! },
    { label: 'IT Moderator', user: users.find(u => u.role === 'moderator')! }
  ].filter(p => !!p.user);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col justify-center items-center px-4 py-12 relative">
      <div className="max-w-md w-full">
        
        {/* Back Link */}
        <button 
          onClick={onBackToHome}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#123B60] hover:text-[#F59A16] transition mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Public Website
        </button>

        {/* Card */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-8 relative overflow-hidden">
          
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                <img src="/branding/esme_logo.png" alt="ESME Logo" className="h-9 w-auto object-contain" />
              </div>
              <div>
                <h1 className="text-lg font-black text-[#123B60]">ESME CU Portal</h1>
                <p className="text-[11px] text-slate-500 font-semibold">2026–2027 Season</p>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-[#F59A16]/15 text-[#D47F0A] text-[10px] font-bold rounded-full">
              Demo Auth
            </span>
          </div>

          <form onSubmit={handleSimulatedLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">Select Demo Account</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none bg-white font-medium text-slate-800"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.role.toUpperCase()} ({u.department || 'ESME CU'})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-700">Password</label>
                <span className="text-[10px] text-slate-400">Simulated local demo</span>
              </div>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#123B60] focus:border-transparent outline-none"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-[#123B60] hover:bg-[#0A2239] text-white font-bold rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2 mt-2"
            >
              <LogIn className="w-4 h-4" />
              Sign Into Dashboard
            </button>
          </form>

          {/* Quick Role Selectors for Evaluation */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-[#F59A16]" />
              Quick Persona Switch (1-Click)
            </div>
            <div className="space-y-2">
              {samplePersonas.map(({ label, user }) => (
                <button
                  key={user.id}
                  onClick={() => handleQuickPersonaSelect(user)}
                  className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between text-xs transition ${
                    currentUser.id === user.id 
                      ? 'border-[#F59A16] bg-[#F59A16]/5 font-bold text-[#123B60]' 
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-[#123B60] text-white flex items-center justify-center font-bold text-[10px]">
                      {user.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800">{user.name}</div>
                      <div className="text-[10px] text-slate-500">{label} • {user.email}</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 text-center text-[10px] text-slate-400 leading-relaxed">
            Frontend demonstration prototype with simulated local authorization.
          </div>

        </div>

      </div>
    </div>
  );
};
