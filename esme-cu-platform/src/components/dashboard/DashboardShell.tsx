import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Layers,
  CheckSquare,
  FileCheck2,
  Award,
  UserPlus,
  Globe,
  Compass,
  LineChart,
  Share2,
  ShieldAlert,
  Bell,
  History,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Sun,
  Moon,
  ExternalLink
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export type DashboardView =
  | 'overview'
  | 'members'
  | 'committees'
  | 'tasks'
  | 'submissions'
  | 'scoring'
  | 'applications'
  | 'website_cms'
  | 'season_planner'
  | 'skill_matrix'
  | 'kpi_analytics'
  | 'social_media'
  | 'moderator'
  | 'audit_log'
  | 'settings';

interface DashboardShellProps {
  currentView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  onExitToPublicWebsite: () => void;
  children: React.ReactNode;
}

export const DashboardShell: React.FC<DashboardShellProps> = ({
  currentView,
  onViewChange,
  onExitToPublicWebsite,
  children
}) => {
  const { 
    currentUser, 
    switchRole, 
    theme, 
    toggleTheme, 
    notifications, 
    markNotificationRead,
    applications,
    submissions
  } = useApp();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  const pendingSubmissionsCount = submissions.filter(s => s.status === 'submitted' || s.status === 'under_review').length;
  const pendingAppsCount = applications.filter(a => a.status === 'pending').length;
  const unreadNotifsCount = notifications.filter(n => !n.read).length;

  // Role badges & capabilities
  const roleDisplayNames: Record<string, { label: string; color: string }> = {
    super_admin: { label: 'Super Administrator', color: 'bg-[#F59A16] text-white' },
    director: { label: 'Committee Director', color: 'bg-[#123B60] text-white' },
    head: { label: 'Team Head', color: 'bg-emerald-600 text-white' },
    member: { label: 'Member', color: 'bg-slate-600 text-white' },
    moderator: { label: 'IT Moderator', color: 'bg-purple-600 text-white' }
  };

  // Nav Groups
  const navItems = [
    {
      group: 'Core Command',
      items: [
        { id: 'overview' as DashboardView, label: 'Overview', icon: LayoutDashboard },
        { id: 'kpi_analytics' as DashboardView, label: 'KPI & Analytics', icon: LineChart },
        { id: 'season_planner' as DashboardView, label: 'Season 26–27', icon: Compass },
      ]
    },
    {
      group: 'Organization & People',
      items: [
        { id: 'members' as DashboardView, label: 'Members Directory', icon: Users },
        { id: 'committees' as DashboardView, label: 'Committees & Teams', icon: Layers },
        { id: 'applications' as DashboardView, label: 'Recruitment Apps', icon: UserPlus, badge: pendingAppsCount > 0 ? pendingAppsCount : undefined },
        { id: 'skill_matrix' as DashboardView, label: 'L0–L4 Skill Matrix', icon: Award },
      ]
    },
    {
      group: 'Operations & Execution',
      items: [
        { id: 'tasks' as DashboardView, label: 'Tasks Command', icon: CheckSquare },
        { id: 'submissions' as DashboardView, label: 'Submissions Review', icon: FileCheck2, badge: pendingSubmissionsCount > 0 ? pendingSubmissionsCount : undefined },
        { id: 'scoring' as DashboardView, label: 'Points & Ledger', icon: Award },
      ]
    },
    {
      group: 'Public Channels & Content',
      items: [
        { id: 'website_cms' as DashboardView, label: 'Website CMS', icon: Globe },
        { id: 'social_media' as DashboardView, label: 'Meta Post Insights', icon: Share2 },
      ]
    },
    {
      group: 'System & Governance',
      items: [
        { id: 'audit_log' as DashboardView, label: 'Audit Trail', icon: History },
        { id: 'moderator' as DashboardView, label: 'IT Moderator Tools', icon: ShieldAlert },
        { id: 'settings' as DashboardView, label: 'Settings & Backups', icon: Settings },
      ]
    }
  ];

  return (
    <div className={`min-h-screen flex ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans`}>
      
      {/* Sidebar */}
      <aside className={`transition-all duration-300 flex flex-col border-r ${
        theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      } ${sidebarCollapsed ? 'w-20' : 'w-64'} shrink-0 z-30`}>
        
        {/* Brand header */}
        <div className="h-16 px-4 border-b flex items-center justify-between border-inherit">
          {!sidebarCollapsed ? (
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="bg-white p-1 rounded-md shadow-sm border border-slate-200 shrink-0">
                <img src="/branding/esme_logo.png" alt="ESME Logo" className="h-7 w-auto object-contain" />
              </div>
              <div className="flex flex-col truncate">
                <span className="font-extrabold text-xs text-[#123B60] dark:text-[#F59A16] tracking-wider uppercase">ESME CU Chapter</span>
                <span className="text-[10px] text-slate-400 font-medium truncate">Season 2026–2027</span>
              </div>
            </div>
          ) : (
            <div className="mx-auto bg-white p-1 rounded border">
              <img src="/branding/esme_logo.png" alt="ESME" className="h-6 w-auto" />
            </div>
          )}

          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Current Active Persona Banner in Sidebar */}
        <div className={`p-3 border-b border-inherit ${theme === 'dark' ? 'bg-slate-800/40' : 'bg-slate-50'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#123B60] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm">
              {currentUser.name.split(' ').map(n => n[0]).join('')}
            </div>
            {!sidebarCollapsed && (
              <div className="overflow-hidden flex-1">
                <div className="text-xs font-bold truncate text-slate-800 dark:text-slate-100">{currentUser.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${roleDisplayNames[currentUser.role]?.color}`}>
                    {roleDisplayNames[currentUser.role]?.label.split(' ')[0]}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate">@{currentUser.username}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {navItems.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  {group.group}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onViewChange(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                      isActive
                        ? 'bg-[#123B60] text-white shadow-sm font-bold'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#F59A16]' : 'text-slate-400'}`} />
                    {!sidebarCollapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
                    {!sidebarCollapsed && item.badge && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#F59A16] text-white">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-inherit space-y-1">
          <button
            onClick={onExitToPublicWebsite}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
            {!sidebarCollapsed && <span className="truncate">Exit to Website</span>}
          </button>
        </div>

      </aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* Top Header */}
        <header className={`h-16 px-6 border-b flex items-center justify-between z-20 ${
          theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
          
          {/* Breadcrumb / Title */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#F59A16]">
              {currentView.replace('_', ' ')}
            </span>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-xs font-medium text-slate-500">
              Season 2026–2027
            </span>
          </div>

          {/* Right Header Utilities */}
          <div className="flex items-center gap-3">
            
            {/* Persona Switcher Quick Dropdown */}
            <div className="flex items-center gap-2 text-xs bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 font-medium">Role:</span>
              <select
                value={currentUser.role}
                onChange={(e) => switchRole(e.target.value as any)}
                className="bg-transparent font-bold text-[#123B60] dark:text-[#F59A16] outline-none cursor-pointer text-xs"
              >
                <option value="super_admin">Super Admin (Kareem Tamer)</option>
                <option value="director">Director (Mahmoud Khalil)</option>
                <option value="head">Head (Ali Salah)</option>
                <option value="member">Member (Noureldin Mohamed)</option>
                <option value="moderator">IT Moderator (Sameh Ibrahem)</option>
              </select>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setNotifDropdownOpen(!notifDropdownOpen)}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition relative"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifsCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#F59A16] ring-2 ring-white"></span>
                )}
              </button>

              {notifDropdownOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Notifications ({unreadNotifsCount})</span>
                    <button 
                      onClick={() => { notifications.forEach(n => markNotificationRead(n.id)); setNotifDropdownOpen(false); }}
                      className="text-[10px] text-[#F59A16] font-semibold hover:underline"
                    >
                      Mark all read
                    </button>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {notifications.map((n) => (
                      <div 
                        key={n.id}
                        onClick={() => markNotificationRead(n.id)}
                        className={`p-2.5 rounded-xl text-xs cursor-pointer transition ${
                          !n.read ? 'bg-amber-50/60 dark:bg-amber-950/20 border-l-2 border-[#F59A16]' : 'bg-slate-50 dark:bg-slate-800/50'
                        }`}
                      >
                        <div className="font-bold text-slate-800 dark:text-slate-100">{n.title}</div>
                        <div className="text-slate-500 text-[11px] mt-0.5">{n.message}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{n.timestamp}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Avatar & Sign Out */}
            <button
              onClick={onExitToPublicWebsite}
              className="px-3 py-1.5 bg-[#123B60] hover:bg-[#0A2239] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
              title="Logout session"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>

          </div>

        </header>

        {/* Body Viewport */}
        <main className="flex-1 overflow-y-auto p-6 sm:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>

      </div>

    </div>
  );
};
