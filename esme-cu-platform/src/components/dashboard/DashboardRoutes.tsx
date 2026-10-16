import React from 'react';
import { DashboardShell } from './DashboardShell';
import type { DashboardView } from './DashboardShell';
import { SuperAdminOverview } from './SuperAdminOverview';
import { MemberManagement } from './MemberManagement';
import { CommitteeManagement } from './CommitteeManagement';
import { TaskCommandCenter } from './TaskCommandCenter';
import { SubmissionReviewCenter } from './SubmissionReviewCenter';
import { PointsAndLeaderboard } from './PointsAndLeaderboard';
import { RegistrationManager } from './RegistrationManager';
import { WebsiteCMS } from './WebsiteCMS';
import { SeasonPlanner } from './SeasonPlanner';
import { SkillMatrix } from './SkillMatrix';
import { KPIAnalytics } from './KPIAnalytics';
import { SocialMediaInsightsView } from './SocialMediaInsightsView';
import { ModeratorTools } from './ModeratorTools';
import { AuditTrailView } from './AuditTrailView';
import { SettingsAndBackups } from './SettingsAndBackups';

interface DashboardRoutesProps {
  currentView: DashboardView;
  onViewChange: (v: DashboardView) => void;
  onExitToPublicWebsite: () => void;
}

const views: Record<DashboardView, React.FC<React.ComponentProps<typeof SuperAdminOverview>>> = {
  overview: SuperAdminOverview,
  members: MemberManagement,
  committees: CommitteeManagement,
  tasks: TaskCommandCenter,
  submissions: SubmissionReviewCenter,
  scoring: PointsAndLeaderboard,
  applications: RegistrationManager,
  website_cms: WebsiteCMS,
  season_planner: SeasonPlanner,
  skill_matrix: SkillMatrix,
  kpi_analytics: KPIAnalytics,
  social_media: SocialMediaInsightsView,
  moderator: ModeratorTools,
  audit_log: AuditTrailView,
  settings: SettingsAndBackups
};

export const DashboardRoutes: React.FC<DashboardRoutesProps> = ({ currentView, onViewChange, onExitToPublicWebsite }) => {
  const ActiveView = views[currentView];

  return (
    <DashboardShell
      currentView={currentView}
      onViewChange={onViewChange}
      onExitToPublicWebsite={onExitToPublicWebsite}
    >
      <ActiveView onNavigate={onViewChange} />
    </DashboardShell>
  );
};
