import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AppProvider } from './context/AppContext';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireAuth } from './auth/guards';
import { PublicWebsite } from './components/PublicWebsite';
import { RegistrationPortal } from './components/RegistrationPortal';
import { LoginScreen } from './components/LoginScreen';
import { AuthPendingScreen } from './components/AuthPendingScreen';
import type { DashboardView } from './components/dashboard/DashboardShell';
import { ToastProvider } from './motion';

const DashboardRoutes = lazy(() =>
  import('./components/dashboard/DashboardRoutes').then(m => ({ default: m.DashboardRoutes }))
);

type MainAppMode = 'website' | 'join' | 'login' | 'dashboard';

const DashboardFallback: React.FC = () => (
  <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 dark:bg-slate-950">
    <div className="hidden lg:block w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900" />
    <div className="flex-1 p-6 space-y-4">
      <div className="h-8 w-56 rounded-xl bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-28 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
        ))}
      </div>
      <div className="h-72 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
      <p className="text-[11px] text-slate-400 font-semibold">Loading your workspace…</p>
    </div>
  </div>
);

/**
 * The local development adapter declares what it is; this strip keeps that declaration
 * on screen for the whole session, so a browser-storage fallback can never be mistaken
 * for the configured provider.
 */
const DevAuthBanner: React.FC = () => {
  const { adapter } = useAuth();
  if (!adapter || adapter.warningBanner === '') return null;
  return (
    <div
      role="status"
      className="w-full bg-amber-400/95 text-[#123B60] px-4 py-2 text-[11px] font-bold tracking-wide text-center border-b-2 border-amber-600"
    >
      {adapter.warningBanner}
    </div>
  );
};

const MainAppContent: React.FC = () => {
  const { status, configurationError, signOut } = useAuth();
  const [mode, setMode] = useState<MainAppMode>('website');
  const [dashboardView, setDashboardView] = useState<DashboardView>('overview');

  // A lost session never stays on a protected surface.
  useEffect(() => {
    if (mode === 'dashboard' && status === 'signed_out') setMode('login');
  }, [mode, status]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  const screen = (() => {
    if (status === 'unavailable' && configurationError) {
      return <AuthPendingScreen reason={configurationError} />;
    }
    switch (mode) {
      case 'join':
        return (
          <RegistrationPortal
            onBackToHome={() => setMode('website')}
            onNavigateToLogin={() => setMode('login')}
            onEnterWorkspace={() => setMode('dashboard')}
          />
        );
      case 'login':
        return (
          <LoginScreen
            onBackToHome={() => setMode('website')}
            onNavigateToJoin={() => setMode('join')}
            onLoginSuccess={() => setMode('dashboard')}
          />
        );
      case 'dashboard':
        return (
          <RequireAuth onExit={() => setMode('website')}>
            <Suspense fallback={<DashboardFallback />}>
              <DashboardRoutes
                currentView={dashboardView}
                onViewChange={(v) => setDashboardView(v)}
                onExitToPublicWebsite={() => setMode('website')}
                onSignOut={async () => {
                  await signOut();
                  setMode('website');
                }}
              />
            </Suspense>
          </RequireAuth>
        );
      default:
        return (
          <PublicWebsite
            // A session that was restored on this visit makes the sign-in form a detour, not a
            // doorway: someone already inside the chapter is taken in rather than asked to prove it
            // again. The dashboard branch still re-checks the session through RequireAuth.
            onNavigateToDashboard={() => setMode(status === 'signed_in' ? 'dashboard' : 'login')}
            onNavigateToJoin={() => setMode('join')}
          />
        );
    }
  })();

  return (
    <>
      <DevAuthBanner />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        >
          {screen}
        </motion.div>
      </AnimatePresence>
    </>
  );
};

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <AppProvider>
          <ToastProvider>
            <MainAppContent />
          </ToastProvider>
        </AppProvider>
      </AuthProvider>
    </MotionConfig>
  );
}

export default App;
