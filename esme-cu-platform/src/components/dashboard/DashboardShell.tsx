import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, ChevronLeft, ChevronRight, ExternalLink, LogOut, Menu, MonitorSmartphone, Moon, Search, Sun, X } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { NAV_BY_ID, NAV_SECTIONS, type NavItem } from './nav';
import { CommandPalette } from './CommandPalette';
import { DrawerShell, transitions, useIsDesktop } from '../../motion';

export type DashboardView =
  | 'overview'
  | 'decision_center'
  | 'action_center'
  | 'members'
  | 'committees'
  | 'tasks'
  | 'submissions'
  | 'scoring'
  | 'rewards'
  | 'applications'
  | 'website_cms'
  | 'media_library'
  | 'season_planner'
  | 'seasons_objectives'
  | 'report_builder'
  | 'skill_matrix'
  | 'kpi_analytics'
  | 'social_media'
  | 'moderator'
  | 'audit_log'
  | 'notifications'
  | 'settings';

type NavGroup = { group: string; items: NavItem[] };

interface DashboardShellProps {
  currentView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  onExitToPublicWebsite: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
}

const roleChip: Record<string, { label: string; color: string }> = {
  super_admin: { label: 'Super Administrator', color: 'bg-[#F59A16] text-white' },
  high_board: { label: 'High Board', color: 'bg-[#123B60] text-white' },
  director: { label: 'Committee Director', color: 'bg-[#123B60] text-white' },
  head: { label: 'Team Head', color: 'bg-emerald-600 text-white' },
  member: { label: 'Member', color: 'bg-slate-600 text-white' },
  moderator: { label: 'IT Moderator', color: 'bg-purple-600 text-white' },
};

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

interface NavListProps {
  groups: NavGroup[];
  currentView: DashboardView;
  collapsed: boolean;
  badges: Partial<Record<DashboardView, number>>;
  onSelect: (view: DashboardView) => void;
  activeId: string;
}

/** One list, two hosts: the desktop rail and the mobile drawer render this without duplicating it. */
const NavList: React.FC<NavListProps> = ({ groups, currentView, collapsed, badges, onSelect, activeId }) => (
  <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-6" aria-label="Dashboard sections">
    {groups.map((group) => (
      <div key={group.group} className="space-y-1">
        {!collapsed && (
          <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{group.group}</div>
        )}
        {group.items.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          const badge = badges[item.id];
          return (
            <motion.button
              key={item.id}
              onClick={() => onSelect(item.id)}
              whileTap={{ scale: 0.97 }}
              transition={transitions.micro}
              aria-current={isActive ? 'page' : undefined}
              className={`relative w-full flex items-center gap-3 py-2 rounded-xl text-xs font-semibold overflow-hidden ${
                isActive
                  ? 'text-white font-bold shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              } ${collapsed ? 'justify-center px-0' : 'px-3'}`}
              title={collapsed ? item.label : undefined}
            >
              {isActive && (
                <motion.span
                  layoutId={activeId}
                  className="absolute inset-0 bg-[#123B60] rounded-xl shadow-sm"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className={`w-4 h-4 shrink-0 relative z-10 ${isActive ? 'text-[#F59A16]' : 'text-slate-400'}`} />
              {!collapsed && <span className="flex-1 text-left truncate relative z-10">{item.label}</span>}
              {!collapsed && badge ? (
                <motion.span
                  layout
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#F59A16] text-white relative z-10"
                >
                  {badge}
                </motion.span>
              ) : null}
              {collapsed && badge ? (
                <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-[#F59A16]" aria-hidden="true" />
              ) : null}
            </motion.button>
          );
        })}
      </div>
    ))}
  </nav>
);

export const DashboardShell: React.FC<DashboardShellProps> = ({
  currentView,
  onViewChange,
  onExitToPublicWebsite,
  onSignOut,
  children,
}) => {
  const { can, theme, setTheme, resolvedTheme, notifications, markNotificationRead, applications, submissions, email, actionQueue, seasons } =
    useApp();
  const currentUser = useActor();
  const isDesktop = useIsDesktop();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [currentView]);

  // Ctrl+K / Cmd+K opens the palette from anywhere in the workspace.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typeof event.key !== 'string') return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cycleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  };

  // `can` is rebuilt with the session, so this is computed per render rather than memoised.
  const groups: NavGroup[] = NAV_SECTIONS.map((group) => ({
    ...group,
    items: group.items.filter((entry) => entry.capability === null || can(entry.capability)),
  })).filter((group) => group.items.length > 0);

  const badges: Partial<Record<DashboardView, number>> = {
    notifications: email.failures.length > 0 ? email.failures.length : undefined,
    action_center: can('tasks.read') && actionQueue().length > 0 ? actionQueue().length : undefined,
    applications: applications.filter((a) => a.status === 'pending').length || undefined,
    submissions:
      submissions.filter((s) => s.status === 'submitted' || s.status === 'under_review').length || undefined,
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const active = NAV_BY_ID[currentView];
  const activeSeason = seasons.find((s) => s.status === 'active');
  const seasonNote = activeSeason
    ? activeSeason.label
    : seasons.length > 0
      ? `${seasons.length} season${seasons.length === 1 ? '' : 's'} recorded, none active`
      : 'No season set';

  const navigate = (view: DashboardView) => {
    onViewChange(view);
    setDrawerOpen(false);
    setNotifOpen(false);
  };

  const openNotification = (id: string, link?: string) => {
    markNotificationRead(id);
    const target = link as DashboardView | undefined;
    if (target && target in NAV_BY_ID) navigate(target);
  };

  const persona = (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-full bg-[#123B60] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm">
        {initials(currentUser.name)}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold truncate text-slate-800 dark:text-slate-100">{currentUser.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${roleChip[currentUser.role]?.color ?? 'bg-slate-600 text-white'}`}>
            {(roleChip[currentUser.role]?.label ?? currentUser.role).split(' ')[0]}
          </span>
          <span className="text-[10px] text-slate-400 truncate">@{currentUser.username}</span>
        </div>
      </div>
    </div>
  );

  const brand = (
    <div className="h-16 px-4 border-b flex items-center justify-between border-inherit shrink-0">
      <div className="flex items-center gap-2.5 overflow-hidden">
        <div className="bg-white p-1 rounded-md shadow-sm border border-slate-200 shrink-0 dark:border-slate-700">
          <img src="/branding/esme_logo.png" alt="ESME Logo" className="h-7 w-auto object-contain" />
        </div>
        {!sidebarCollapsed && (
          <div className="flex flex-col min-w-0 truncate">
            <span className="font-extrabold text-xs text-[#123B60] dark:text-[#F59A16] tracking-wider uppercase truncate">
              ESME CU Chapter
            </span>
            <span className="text-[10px] text-slate-400 font-medium truncate">{seasonNote}</span>
          </div>
        )}
      </div>
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </div>
  );

  return (
    <div
      className={`min-h-screen flex ${
        resolvedTheme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      } font-sans`}
    >
      {isDesktop && (
        <motion.aside
          initial={false}
          animate={{ width: sidebarCollapsed ? 80 : 256 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className={`flex flex-col border-r overflow-hidden shrink-0 z-30 ${
            resolvedTheme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          {brand}
          <div className={`p-3 border-b border-inherit shrink-0 ${resolvedTheme === 'dark' ? 'bg-slate-800/40' : 'bg-slate-50'}`}>
            {sidebarCollapsed ? (
              <div className="flex justify-center">
                <div className="w-8 h-8 rounded-full bg-[#123B60] text-white flex items-center justify-center font-bold text-[10px]">
                  {initials(currentUser.name)}
                </div>
              </div>
            ) : (
              persona
            )}
          </div>
          <NavList
            groups={groups}
            currentView={currentView}
            collapsed={sidebarCollapsed}
            badges={badges}
            onSelect={navigate}
            activeId="sidebar-active-item"
          />
          <div className="p-3 border-t border-inherit shrink-0">
            <button
              onClick={onExitToPublicWebsite}
              className={`w-full flex items-center gap-2.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                sidebarCollapsed ? 'justify-center px-0' : 'px-3'
              }`}
              title="Exit to Website"
            >
              <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">Exit to Website</span>}
            </button>
          </div>
        </motion.aside>
      )}

      <DrawerShell
        open={drawerOpen && !isDesktop}
        onClose={() => setDrawerOpen(false)}
        side="left"
        className={`w-[min(85vw,18rem)] flex flex-col ${
          resolvedTheme === 'dark' ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-900'
        }`}
      >
        <div className="h-16 px-4 border-b flex items-center justify-between border-inherit shrink-0">
          <div className="bg-white p-1 rounded-md shadow-sm border border-slate-200 shrink-0 dark:border-slate-700">
            <img src="/branding/esme_logo.png" alt="ESME Logo" className="h-7 w-auto object-contain" />
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className={`p-3 border-b border-inherit ${resolvedTheme === 'dark' ? 'bg-slate-800/40' : 'bg-slate-50'}`}>{persona}</div>
        <NavList
          groups={groups}
          currentView={currentView}
          collapsed={false}
          badges={badges}
          onSelect={navigate}
          activeId="drawer-active-item"
        />
        <div className="p-3 border-t border-inherit space-y-1 shrink-0">
          <button
            onClick={() => {
              onExitToPublicWebsite();
              setDrawerOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
            Exit to Website
          </button>
          <button
            onClick={() => {
              onSignOut();
              setDrawerOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </DrawerShell>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header
          className={`min-h-16 px-3 sm:px-6 py-2.5 border-b flex flex-wrap items-center justify-between gap-x-3 gap-y-2 z-20 shrink-0 ${
            resolvedTheme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {!isDesktop && (
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-2 min-w-0 text-xs overflow-hidden">
              <span className="hidden sm:inline font-semibold text-slate-400 truncate">{active.group}</span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
              <motion.span
                key={currentView}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="font-bold text-[#F59A16] whitespace-nowrap"
              >
                {active.label}
              </motion.span>
              <span className="hidden lg:inline text-slate-300 dark:text-slate-700">/</span>
              <span className="hidden lg:inline font-medium text-slate-500 whitespace-nowrap">{seasonNote}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 ml-auto">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700"
              title="Search pages, people and tasks"
            >
              <Search className="w-4 h-4" />
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden sm:inline text-[10px] text-slate-400">Ctrl K</kbd>
            </button>

            <div className="hidden sm:flex items-center gap-2 text-xs bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 font-medium">Role:</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${roleChip[currentUser.role]?.color ?? 'bg-slate-600 text-white'}`}>
                {roleChip[currentUser.role]?.label ?? currentUser.role}
              </span>
            </div>

            <button
              onClick={cycleTheme}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={`Appearance: ${theme} — click to change`}
              aria-label={`Appearance: ${theme}. Click to change.`}
            >
              {theme === 'system' ? (
                <MonitorSmartphone className="w-4 h-4 text-slate-500" />
              ) : resolvedTheme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
            </button>

            <div className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                aria-expanded={notifOpen}
                aria-label={`Notifications, ${unreadCount} unread`}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <motion.span
                    layout
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                    className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#F59A16] text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-900"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </motion.span>
                )}
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute right-0 mt-2 w-[min(92vw,20rem)] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 z-50"
                    >
                      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                          Notifications ({unreadCount} unread)
                        </span>
                        <button
                          onClick={() => {
                            for (const n of notifications) markNotificationRead(n.id);
                            setNotifOpen(false);
                          }}
                          className="text-[10px] text-[#F59A16] font-semibold hover:underline"
                        >
                          Mark all read
                        </button>
                      </div>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {notifications.length === 0 && (
                          <p className="text-[11px] text-slate-500 py-4 text-center">
                            Nothing here yet. Activity notifications appear once the workspace has records.
                          </p>
                        )}
                        {notifications.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => openNotification(n.id, n.link)}
                            className={`w-full text-left p-2.5 rounded-xl text-xs transition-colors ${
                              !n.read
                                ? 'bg-amber-50/60 dark:bg-amber-950/20 border-l-2 border-[#F59A16]'
                                : 'bg-slate-50 dark:bg-slate-800/50'
                            }`}
                          >
                            <div className="font-bold text-slate-800 dark:text-slate-100">{n.title}</div>
                            <div className="text-slate-500 text-[11px] mt-0.5">{n.message}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{n.timestamp}</div>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          navigate('notifications');
                        }}
                        className="mt-3 w-full text-[11px] font-bold text-[#123B60] dark:text-[#F59A16] py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Open Alerts &amp; Email
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <button
              onClick={onSignOut}
              className="px-2.5 sm:px-3 py-1.5 bg-[#123B60] hover:bg-[#0A2239] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shrink-0"
              title="End your session"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={onViewChange} />
    </div>
  );
};
