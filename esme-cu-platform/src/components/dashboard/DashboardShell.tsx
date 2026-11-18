import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, ChevronLeft, ChevronRight, ExternalLink, LogOut, Menu, MonitorSmartphone, Moon, Search, Sun, X } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { scopeFor } from '../../domain/roles';
import { NAV_BY_ID, NAV_SECTIONS, type NavItem } from './nav';
import { CommandPalette } from './CommandPalette';
import { DrawerShell, transitions, routeShift, useHasNavRail, useHasRoomForNavLabels } from '../../motion';
import { cn } from '../../lib/cn';

export type DashboardView =
  | 'overview'
  | 'decision_center'
  | 'action_center'
  | 'messages'
  | 'members'
  | 'committees'
  | 'tasks'
  | 'submissions'
  | 'scoring'
  | 'rewards'
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

/**
 * Each pair is chosen for the text it carries, not for the role it names: amber and orange are
 * light hues, so they take the near-black ink rather than white, and the one green that can be
 * read as white-on-fill is a wash with dark ink on top of it. The word is what tells the roles
 * apart; the colour only groups them at a glance.
 */
const roleChip: Record<string, { label: string; color: string }> = {
  super_admin: { label: 'Super Administrator', color: 'bg-accent text-slate-950' },
  high_board: { label: 'High Board', color: 'bg-brand text-white' },
  director: { label: 'Committee Director', color: 'bg-brand text-white' },
  head: { label: 'Team Head', color: 'bg-success/15 text-success-ink' },
  member: { label: 'Member', color: 'bg-ink-muted text-bg' },
  moderator: { label: 'IT Moderator', color: 'bg-violet text-slate-950' },
  hr_manager: { label: 'HR Manager', color: 'bg-accent-strong text-slate-950' },
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

/**
 * Stiff enough that the marker arrives before a fast clicker's next item, soft enough that it
 * visibly travels instead of teleporting. Two `layoutId`s share it so the ribbon and its spine stay
 * locked together on the way to the next row.
 */
const RIBBON_SPRING = { type: 'spring', stiffness: 420, damping: 34 } as const;

/** One list, two hosts: the desktop rail and the mobile drawer render this without duplicating it. */
const NavList: React.FC<NavListProps> = ({ groups, currentView, collapsed, badges, onSelect, activeId }) => (
  <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-6" aria-label="Dashboard sections">
    {groups.map((group) => (
      <div key={group.group} className="space-y-1">
        {!collapsed && (
          <div className="px-3 text-micro font-bold uppercase tracking-wider text-ink-subtle mb-2">{group.group}</div>
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
              className={`relative w-full flex items-center gap-3 py-2 rounded-control text-caption font-semibold overflow-hidden ${
                isActive
                  ? 'text-white font-bold shadow-sm'
                  : 'text-ink-muted hover:bg-tint-hover hover:text-ink transition-colors duration-micro'
              } ${collapsed ? 'justify-center px-0' : 'px-3'}`}
              title={collapsed ? item.label : undefined}
            >
              {isActive && (
                <>
                  <motion.span
                    layoutId={activeId}
                    className="nav-ribbon absolute inset-0 bg-brand shadow-sm"
                    transition={RIBBON_SPRING}
                  />
                  <motion.span
                    layoutId={`${activeId}-spine`}
                    aria-hidden="true"
                    className="absolute start-0 inset-y-1.5 w-[3px] rounded-full bg-accent"
                    transition={RIBBON_SPRING}
                  />
                </>
              )}
              <Icon className={`w-4 h-4 shrink-0 relative z-10 ${isActive ? 'text-accent' : 'text-ink-subtle'}`} />
              {!collapsed && <span className="flex-1 text-left truncate relative z-10">{item.label}</span>}
              {!collapsed && badge ? (
                <motion.span
                  layout
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="px-2 py-1 text-micro font-bold rounded-pill bg-accent text-slate-950 font-numbers relative z-10"
                >
                  {badge}
                </motion.span>
              ) : null}
              {collapsed && badge ? (
                <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
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
  const { can, theme, setTheme, resolvedTheme, notifications, markNotificationRead, submissions, email, actionQueue, seasons } =
    useApp();
  const currentUser = useActor();
  const hasRail = useHasNavRail();
  const hasRoomForLabels = useHasRoomForNavLabels();

  /**
   * Null until the account has said something about the rail. Until then the width of the window
   * decides, so a 1024–1279 laptop opens on icons and a 1440 monitor opens on labels, and neither
   * fights a resize the way an effect that wrote state on every breakpoint change would.
   */
  const [collapseChoice, setCollapseChoice] = useState<boolean | null>(null);
  const sidebarCollapsed = collapseChoice ?? !hasRoomForLabels;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const mountedOnce = useRef(false);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    // Landing in the workspace must not steal focus from whatever the account was doing — the
    // first run only scrolls, and every later one is a navigation someone actually performed.
    if (!mountedOnce.current) {
      mountedOnce.current = true;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
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

  // A count on the rail is a promise about records this account may act on. A member holds
  // submissions.read at self scope and no review grant, so counting the chapter's queue there
  // would describe work they cannot open.
  const reviewScope = scopeFor(currentUser.role, 'submissions.review');
  const reviewable =
    reviewScope === 'all'
      ? submissions
      : reviewScope === 'committee'
        ? submissions.filter((s) => s.committeeId === currentUser.committeeId)
        : [];
  const pendingReview = reviewable.filter((s) => s.status === 'submitted' || s.status === 'under_review').length;

  const badges: Partial<Record<DashboardView, number>> = {
    notifications: email.failures.length > 0 ? email.failures.length : undefined,
    action_center: can('tasks.read') && actionQueue().length > 0 ? actionQueue().length : undefined,
    submissions: pendingReview || undefined,
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
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center font-bold text-caption shrink-0 shadow-sm">
        {initials(currentUser.name)}
      </div>
      <div className="min-w-0">
        <div className="text-caption font-bold truncate text-ink">{currentUser.name}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-micro px-2 py-1 rounded-pill font-bold uppercase tracking-wider ${roleChip[currentUser.role]?.color ?? 'bg-ink-muted text-bg'}`}>
            {(roleChip[currentUser.role]?.label ?? currentUser.role).split(' ')[0]}
          </span>
          <span className="text-micro text-ink-subtle truncate">@{currentUser.username}</span>
        </div>
      </div>
    </div>
  );

  const brand = (
    <div className="h-16 px-4 border-b flex items-center justify-between border-inherit shrink-0">
      <div className="flex items-center gap-2 overflow-hidden">
        <div className="bg-esme-white p-1 rounded-control shadow-card border border-border shrink-0">
          <img src="/branding/esme_logo.png" alt="ESME Logo" className="h-7 w-auto object-contain" />
        </div>
        {!sidebarCollapsed && (
          <div className="flex flex-col min-w-0 truncate">
            <span className="font-extrabold text-caption text-ink-brand tracking-wider uppercase truncate">
              ESME CU Chapter
            </span>
            <span className="text-micro text-ink-subtle font-medium truncate">{seasonNote}</span>
          </div>
        )}
      </div>
      <button
        onClick={() => setCollapseChoice(!sidebarCollapsed)}
        className="p-2 rounded-control text-ink-subtle hover:text-ink hover:bg-tint-hover transition-colors duration-micro shrink-0"
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!sidebarCollapsed}
        aria-controls="dashboard-rail"
      >
        {sidebarCollapsed ? <ChevronRight className="w-4 h-4" aria-hidden /> : <ChevronLeft className="w-4 h-4" aria-hidden />}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-bg text-ink font-sans">
      {/*
       * The first tab stop in the workspace. Without it a keyboard account reaches a report by
       * walking the whole rail, which is the one thing a skip link exists to prevent. It sits one
       * step above the overlay scale (modals and drawers are z-50) because a link that can be
       * focused but not seen is worse than no link.
       */}
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-card focus:bg-brand focus:text-white focus:text-caption focus:font-bold"
      >
        Skip to content
      </a>
      {hasRail && (
        <aside
          id="dashboard-rail"
          style={{ width: sidebarCollapsed ? 'var(--layout-rail-collapsed)' : 'var(--layout-rail)' }}
          className="flex flex-col border-r border-border bg-surface overflow-hidden shrink-0 z-30 chrome-print-hide transition-[width] duration-standard ease-smooth motion-reduce:transition-none"
        >
          {brand}
          <div className="p-3 border-b border-inherit shrink-0 bg-surface-muted">
            {sidebarCollapsed ? (
              <div className="flex justify-center">
                <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center font-bold text-micro">
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
              className={`w-full flex items-center gap-2 py-2 rounded-control text-caption font-semibold text-ink-muted hover:bg-tint-hover hover:text-ink transition-colors duration-micro ${
                sidebarCollapsed ? 'justify-center px-0' : 'px-3'
              }`}
              title="Exit to Website"
            >
              <ExternalLink className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden />
              {!sidebarCollapsed && <span className="truncate">Exit to Website</span>}
            </button>
          </div>
        </aside>
      )}

      <DrawerShell
        open={drawerOpen && !hasRail}
        onClose={() => setDrawerOpen(false)}
        side="left"
        ariaLabel="Dashboard navigation"
        className="w-[min(85vw,18rem)] flex flex-col bg-surface text-ink"
      >
        <div className="h-16 px-4 border-b flex items-center justify-between border-inherit shrink-0">
          <div className="bg-esme-white p-1 rounded-control border border-border shrink-0">
            <img src="/branding/esme_logo.png" alt="ESME Logo" className="h-7 w-auto object-contain" />
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            className="p-2 rounded-control text-ink-subtle hover:bg-tint-hover hover:text-ink transition-colors duration-micro"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div className="p-3 border-b border-inherit bg-surface-muted">{persona}</div>
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
            className="w-full flex items-center gap-2 px-3 py-2 rounded-control text-caption font-semibold text-ink-muted hover:bg-tint-hover hover:text-ink transition-colors duration-micro"
          >
            <ExternalLink className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden />
            Exit to Website
          </button>
          <button
            onClick={() => {
              onSignOut();
              setDrawerOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-control text-caption font-semibold text-danger hover:bg-danger/10 transition-colors duration-micro"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </DrawerShell>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="min-h-14 lg:min-h-16 px-3 sm:px-6 py-2 border-b border-border bg-surface flex flex-wrap items-center justify-between gap-x-3 gap-y-2 z-20 shrink-0 chrome-print-hide">
          <div className="flex items-center gap-2 min-w-0">
            {!hasRail && (
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="p-2 rounded-control text-ink-muted hover:bg-tint-hover hover:text-ink transition-colors duration-micro shrink-0"
              >
                <Menu className="w-4 h-4" aria-hidden />
              </button>
            )}
            <div className="flex items-center gap-2 min-w-0 text-caption overflow-hidden">
              <span className="hidden sm:inline font-semibold text-ink-subtle truncate">{active.group}</span>
              <span aria-hidden className="hidden sm:inline text-ink-faint">/</span>
              <motion.span
                key={currentView}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="font-bold text-ink-accent whitespace-nowrap"
              >
                {active.label}
              </motion.span>
              <span aria-hidden className="hidden lg:inline text-ink-faint">/</span>
              <span className="hidden lg:inline font-medium text-ink-muted whitespace-nowrap">{seasonNote}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-control text-caption font-semibold text-ink-muted hover:text-ink hover:bg-tint-hover border border-border-strong transition-colors duration-micro"
              title="Search pages, people and tasks"
            >
              <Search className="w-4 h-4" aria-hidden />
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden sm:inline text-micro text-ink-subtle font-numbers">Ctrl K</kbd>
            </button>

            <div className="hidden sm:flex items-center gap-2 text-caption bg-surface-muted px-3 py-2 rounded-control border border-border">
              <span className="text-ink-subtle font-medium">Role:</span>
              <span className={`text-micro px-2 py-1 rounded-pill font-bold uppercase tracking-wider ${roleChip[currentUser.role]?.color ?? 'bg-surface-sunken text-ink'}`}>
                {roleChip[currentUser.role]?.label ?? currentUser.role}
              </span>
            </div>

            <button
              onClick={cycleTheme}
              className="p-2 rounded-control text-ink-muted hover:bg-tint-hover hover:text-ink transition-colors duration-micro"
              title={`Appearance: ${theme}. Click to change.`}
              aria-label={`Appearance: ${theme}. Click to change.`}
            >
              {theme === 'system' ? (
                <MonitorSmartphone className="w-4 h-4" aria-hidden />
              ) : resolvedTheme === 'dark' ? (
                <Sun className="w-4 h-4 text-ink-accent" aria-hidden />
              ) : (
                <Moon className="w-4 h-4" aria-hidden />
              )}
            </button>

            <div className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                aria-expanded={notifOpen}
                aria-label={`Notifications, ${unreadCount} unread`}
                className="p-2 rounded-control text-ink-muted hover:bg-tint-hover hover:text-ink transition-colors duration-micro relative"
              >
                <Bell className="w-4 h-4" aria-hidden />
                {unreadCount > 0 && (
                  <motion.span
                    layout
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                    className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-pill bg-accent text-slate-950 text-micro leading-none font-bold flex items-center justify-center ring-2 ring-surface"
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
                      className="absolute right-0 mt-2 w-[min(92vw,20rem)] bg-surface rounded-card shadow-overlay border border-border p-4 z-50"
                    >
                      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border-subtle">
                        <span className="text-label font-bold text-ink-strong">
                          Notifications ({unreadCount} unread)
                        </span>
                        <button
                          onClick={() => {
                            for (const n of notifications) markNotificationRead(n.id);
                            setNotifOpen(false);
                          }}
                          className="text-caption text-ink-accent font-semibold hover:underline"
                        >
                          Mark all read
                        </button>
                      </div>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {notifications.length === 0 && (
                          <p className="text-caption text-ink-muted py-4 text-center">
                            Nothing here yet. Activity notifications appear once the workspace has records.
                          </p>
                        )}
                        {notifications.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => openNotification(n.id, n.link)}
                            className={cn(
                              'w-full text-left p-3 rounded-card text-caption transition-colors duration-micro',
                              !n.read ? 'bg-tint-accent border-l-2 border-accent' : 'bg-surface-muted'
                            )}
                          >
                            <div className="font-bold text-ink-strong">{n.title}</div>
                            <div className="text-ink-muted mt-1">{n.message}</div>
                            <div className="text-micro text-ink-faint mt-1">{n.timestamp}</div>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          navigate('notifications');
                        }}
                        className="mt-3 w-full text-caption font-bold text-ink-brand py-2 rounded-control hover:bg-tint-hover transition-colors duration-micro"
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
              aria-label="Sign out"
              className="px-3 py-2 bg-brand hover:bg-brand-ink text-white rounded-control text-caption font-bold flex items-center gap-1.5 shadow-sm shrink-0 transition-colors duration-micro"
              title="End your session"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/*
         * `tabIndex={-1}` is what makes the skip link land somewhere and what lets a view change
         * move focus, so a screen reader starts the new screen at its heading instead of repeating
         * the rail. The outline is off because this focus is never typed into — it is either a skip
         * link, which the reader already announced, or a navigation the reader just announced.
         */}
        <main
          id="dashboard-main"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 focus:outline-none"
        >
          <div className="max-w-7xl mx-auto pb-safe">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentView}
                initial={{ opacity: 0, y: routeShift.in }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -routeShift.out, transition: transitions.routeOut }}
                transition={transitions.routeIn}
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
