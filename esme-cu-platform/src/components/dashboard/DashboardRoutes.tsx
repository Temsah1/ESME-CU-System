import React from 'react';
import { DashboardShell } from './DashboardShell';
import type { DashboardView } from './DashboardShell';
import { RequireCapability } from '../../auth/guards';
import type { Capability } from '../../domain/roles';
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
  onViewChange: (view: DashboardView) => void;
  onExitToPublicWebsite: () => void;
  onSignOut: () => void;
}

type ViewProps = { onNavigate: (view: DashboardView) => void };

/** The capability each surface needs, kept in one table so nav and render agree. */
const VIEW_REQUIREMENTS: Record<DashboardView, Capability | null> = {
  overview: null,
  members: 'users.read',
  committees: 'committees.read',
  tasks: 'tasks.read',
  submissions: 'submissions.read',
  scoring: 'scores.read',
  applications: 'registrations.read',
  website_cms: 'cms.content.write',
  season_planner: 'events.read',
  skill_matrix: 'skills.read',
  kpi_analytics: 'analytics.configure',
  social_media: 'cms.content.write',
  moderator: 'registrations.decide',
  audit_log: 'audit.read',
  settings: 'settings.manage',
};

const views: Record<DashboardView, React.FC<ViewProps>> = {
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
  settings: SettingsAndBackups,
};

export const DashboardRoutes: React.FC<DashboardRoutesProps> = ({
  currentView,
  onViewChange,
  onExitToPublicWebsite,
  onSignOut,
}) => {
  const ActiveView = views[currentView];
  const requirement = VIEW_REQUIREMENTS[currentView];
  const body = <ActiveView onNavigate={onViewChange} />;

  return (
    <DashboardShell
      currentView={currentView}
      onViewChange={onViewChange}
      onExitToPublicWebsite={onExitToPublicWebsite}
      onSignOut={onSignOut}
    >
      {requirement === null ? body : <RequireCapability capability={requirement}>{body}</RequireCapability>}
    </DashboardShell>
  );
};

export default DashboardRoutes;
