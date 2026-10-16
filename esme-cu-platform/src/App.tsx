import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AppProvider, useApp } from './context/AppContext';
import { PublicWebsite } from './components/PublicWebsite';
import { RegistrationPortal } from './components/RegistrationPortal';
import { LoginModal } from './components/LoginModal';
import type { DashboardView } from './components/dashboard/DashboardShell';
import { ToastProvider } from './motion';

const DashboardRoutes = lazy(() =>
  import('./components/dashboard/DashboardRoutes').then(m => ({ default: m.DashboardRoutes }))
);

type MainAppMode = 'website' | 'join' | 'login' | 'dashboard';

const DashboardFallback: React.FC = () => {
  const { currentUser } = useApp();
  return (
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
        <p className="text-[11px] text-slate-400 font-semibold">Loading {currentUser.name}'s workspace…</p>
      </div>
    </div>
  );
};

const MainAppContent: React.FC = () => {
  const [mode, setMode] = useState<MainAppMode>('website');
  const [dashboardView, setDashboardView] = useState<DashboardView>('overview');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  const screen = (() => {
    switch (mode) {
      case 'join':
        return (
          <RegistrationPortal
            onBackToHome={() => setMode('website')}
            onNavigateToLogin={() => setMode('login')}
          />
        );
      case 'login':
        return (
          <LoginModal
            onBackToHome={() => setMode('website')}
            onLoginSuccess={() => setMode('dashboard')}
          />
        );
      case 'dashboard':
        return (
          <Suspense fallback={<DashboardFallback />}>
            <DashboardRoutes
              currentView={dashboardView}
              onViewChange={(v) => setDashboardView(v)}
              onExitToPublicWebsite={() => setMode('website')}
            />
          </Suspense>
        );
      default:
        return (
          <PublicWebsite
            onNavigateToDashboard={() => setMode('login')}
            onNavigateToJoin={() => setMode('join')}
          />
        );
    }
  })();

  return (
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
  );
};

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AppProvider>
        <ToastProvider>
          <MainAppContent />
        </ToastProvider>
      </AppProvider>
    </MotionConfig>
  );
}

export default App;
