import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
import { transitions } from '../../motion';

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
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [currentView]);

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
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 80 : 256 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={`flex flex-col border-r overflow-hidden shrink-0 z-30 ${
          theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}
      >

        {/* Brand header */}
        <div className="h-16 px-4 border-b flex items-center justify-between border-inherit shrink-0">
          <AnimatePresence mode="wait" initial={false}>
            {!sidebarCollapsed ? (
              <motion.div
                key="brand-full"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-2.5 overflow-hidden"
              >
                <div className="bg-white p-1 rounded-md shadow-sm border border-slate-200 shrink-0">
                  <img src="/branding/esme_logo.png" alt="ESME Logo" className="h-7 w-auto object-contain" />
                </div>
                <div className="flex flex-col min-w-0 truncate">
                  <span className="font-extrabold text-xs text-[#123B60] dark:text-[#F59A16] tracking-wider uppercase truncate">ESME CU Chapter</span>
                  <span className="text-[10px] text-slate-400 font-medium truncate">Season 2026–2027</span>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="brand-mini"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                className="mx-auto bg-white p-1 rounded border shrink-0"
              >
                <img src="/branding/esme_logo.png" alt="ESME" className="h-6 w-auto" />
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            whileTap={{ scale: 0.9, rotate: sidebarCollapsed ? -12 : 12 }}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </motion.button>
        </div>

        {/* Current Active Persona Banner in Sidebar */}
        <div className={`p-3 border-b border-inherit shrink-0 ${theme === 'dark' ? 'bg-slate-800/40' : 'bg-slate-50'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#123B60] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm">
              {currentUser.name.split(' ').map(n => n[0]).join('')}
            </div>
            <AnimatePresence initial={false}>
              {!sidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden flex-1 min-w-0"
                >
                  <div className="text-xs font-bold truncate text-slate-800 dark:text-slate-100">{currentUser.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${roleDisplayNames[currentUser.role]?.color}`}>
                      {roleDisplayNames[currentUser.role]?.label.split(' ')[0]}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate">@{currentUser.username}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-6">
          {navItems.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              <AnimatePresence initial={false}>
                {!sidebarCollapsed && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 overflow-hidden"
                  >
                    {group.group}
                  </motion.div>
                )}
              </AnimatePresence>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <motion.button
                    key={item.id}
                    onClick={() => onViewChange(item.id)}
                    whileTap={{ scale: 0.97 }}
                    transition={transitions.micro}
                    className={`relative w-full flex items-center gap-3 py-2 rounded-xl text-xs font-semibold overflow-hidden ${
                      isActive
                        ? 'text-white font-bold shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    } ${sidebarCollapsed ? 'justify-center px-0' : 'px-3'}`}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active-item"
                        className="absolute inset-0 bg-[#123B60] rounded-xl shadow-sm"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <Icon className={`w-4 h-4 shrink-0 relative z-10 ${isActive ? 'text-[#F59A16]' : 'text-slate-400'}`} />
                    <AnimatePresence initial={false}>
                      {!sidebarCollapsed && (
                        <motion.span
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={{ duration: 0.2 }}
                          className="flex-1 text-left truncate relative z-10"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {!sidebarCollapsed && item.badge && (
                      <motion.span
                        layout
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#F59A16] text-white relative z-10"
                      >
                        {item.badge}
                      </motion.span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-inherit space-y-1 shrink-0">
          <motion.button
            onClick={onExitToPublicWebsite}
            whileHover={{ x: sidebarCollapsed ? 0 : 3 }}
            whileTap={{ scale: 0.97 }}
            transition={transitions.micro}
            className={`w-full flex items-center gap-2.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${sidebarCollapsed ? 'justify-center px-0' : 'px-3'}`}
          >
            <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
            {!sidebarCollapsed && <span className="truncate">Exit to Website</span>}
          </motion.button>
        </div>

      </motion.aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top Header */}
        <header className={`h-16 px-6 border-b flex items-center justify-between z-20 shrink-0 ${
          theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>

          {/* Breadcrumb / Title */}
          <div className="flex items-center gap-3 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.span
                key={currentView}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="text-xs font-bold uppercase tracking-wider text-[#F59A16] whitespace-nowrap"
              >
                {currentView.replace('_', ' ')}
              </motion.span>
            </AnimatePresence>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
              Season 2026–2027
            </span>
          </div>

          {/* Right Header Utilities */}
          <div className="flex items-center gap-3">

            {/* Persona Switcher Quick Dropdown */}
            <div className="flex items-center gap-2 text-xs bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors hover:border-[#123B60]/40">
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
            <motion.button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              whileTap={{ scale: 0.9, rotate: -15 }}
              title="Toggle theme"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ rotate: -60, opacity: 0, scale: 0.7 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: 60, opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.2 }}
                  className="block"
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
                </motion.span>
              </AnimatePresence>
            </motion.button>

            {/* Notification Bell */}
            <div className="relative">
              <motion.button
                onClick={() => setNotifDropdownOpen(!notifDropdownOpen)}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative"
                whileTap={{ scale: 0.92 }}
                aria-expanded={notifDropdownOpen}
              >
                <motion.span
                  animate={unreadNotifsCount > 0 ? { rotate: [0, -10, 10, -6, 6, 0] } : undefined}
                  transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 6 }}
                  className="block"
                >
                  <Bell className="w-4 h-4" />
                </motion.span>
                {unreadNotifsCount > 0 && (
                  <motion.span
                    layout
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#F59A16] ring-2 ring-white"
                  />
                )}
              </motion.button>

              <AnimatePresence>
                {notifDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotifDropdownOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 z-50"
                    >
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
                        {notifications.map((n, i) => (
                          <motion.div
                            key={n.id}
                            initial={{ opacity: 0, x: 12 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.05 + i * 0.04, duration: 0.25 }}
                            onClick={() => markNotificationRead(n.id)}
                            className={`p-2.5 rounded-xl text-xs cursor-pointer transition-colors ${
                              !n.read ? 'bg-amber-50/60 dark:bg-amber-950/20 border-l-2 border-[#F59A16]' : 'bg-slate-50 dark:bg-slate-800/50'
                            }`}
                          >
                            <div className="font-bold text-slate-800 dark:text-slate-100">{n.title}</div>
                            <div className="text-slate-500 text-[11px] mt-0.5">{n.message}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{n.timestamp}</div>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Profile Avatar & Sign Out */}
            <motion.button
              onClick={onExitToPublicWebsite}
              className="px-3 py-1.5 bg-[#123B60] hover:bg-[#0A2239] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              transition={transitions.micro}
              title="Logout session"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </motion.button>

          </div>

        </header>

        {/* Body Viewport */}
        <main ref={mainRef} className="flex-1 overflow-y-auto p-6 sm:p-8">
          <div className="max-w-7xl mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentView}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

      </div>

    </div>
  );
};
