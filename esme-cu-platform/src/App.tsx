import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { PublicWebsite } from './components/PublicWebsite';
import { RegistrationPortal } from './components/RegistrationPortal';
import { LoginModal } from './components/LoginModal';
import { DashboardShell } from './components/dashboard/DashboardShell';
import type { DashboardView } from './components/dashboard/DashboardShell';
import { SuperAdminOverview } from './components/dashboard/SuperAdminOverview';
import { MemberManagement } from './components/dashboard/MemberManagement';
import { CommitteeManagement } from './components/dashboard/CommitteeManagement';
import { TaskCommandCenter } from './components/dashboard/TaskCommandCenter';
import { SubmissionReviewCenter } from './components/dashboard/SubmissionReviewCenter';
import { PointsAndLeaderboard } from './components/dashboard/PointsAndLeaderboard';
import { RegistrationManager } from './components/dashboard/RegistrationManager';
import { WebsiteCMS } from './components/dashboard/WebsiteCMS';
import { SeasonPlanner } from './components/dashboard/SeasonPlanner';
import { SkillMatrix } from './components/dashboard/SkillMatrix';
import { KPIAnalytics } from './components/dashboard/KPIAnalytics';
import { SocialMediaInsightsView } from './components/dashboard/SocialMediaInsightsView';
import { ModeratorTools } from './components/dashboard/ModeratorTools';
import { AuditTrailView } from './components/dashboard/AuditTrailView';
import { SettingsAndBackups } from './components/dashboard/SettingsAndBackups';

type MainAppMode = 'website' | 'join' | 'login' | 'dashboard';

const MainAppContent: React.FC = () => {
  const [mode, setMode] = useState<MainAppMode>('website');
  const [dashboardView, setDashboardView] = useState<DashboardView>('overview');

  if (mode === 'join') {
    return (
      <RegistrationPortal
        onBackToHome={() => setMode('website')}
        onNavigateToLogin={() => setMode('login')}
      />
    );
  }

  if (mode === 'login') {
    return (
      <LoginModal
        onBackToHome={() => setMode('website')}
        onLoginSuccess={() => setMode('dashboard')}
      />
    );
  }

  if (mode === 'dashboard') {
    return (
      <DashboardShell
        currentView={dashboardView}
        onViewChange={(v) => setDashboardView(v)}
        onExitToPublicWebsite={() => setMode('website')}
      >
        {dashboardView === 'overview' && (
          <SuperAdminOverview onNavigate={(v) => setDashboardView(v)} />
        )}
        {dashboardView === 'members' && <MemberManagement />}
        {dashboardView === 'committees' && <CommitteeManagement />}
        {dashboardView === 'tasks' && <TaskCommandCenter />}
        {dashboardView === 'submissions' && <SubmissionReviewCenter />}
        {dashboardView === 'scoring' && <PointsAndLeaderboard />}
        {dashboardView === 'applications' && <RegistrationManager />}
        {dashboardView === 'website_cms' && <WebsiteCMS />}
        {dashboardView === 'season_planner' && <SeasonPlanner />}
        {dashboardView === 'skill_matrix' && <SkillMatrix />}
        {dashboardView === 'kpi_analytics' && <KPIAnalytics />}
        {dashboardView === 'social_media' && <SocialMediaInsightsView />}
        {dashboardView === 'moderator' && <ModeratorTools />}
        {dashboardView === 'audit_log' && <AuditTrailView />}
        {dashboardView === 'settings' && <SettingsAndBackups />}
      </DashboardShell>
    );
  }

  return (
    <PublicWebsite
      onNavigateToDashboard={() => setMode('login')}
      onNavigateToJoin={() => setMode('join')}
    />
  );
};

export function App() {
  return (
    <AppProvider>
      <MainAppContent />
    </AppProvider>
  );
}

export default App;
