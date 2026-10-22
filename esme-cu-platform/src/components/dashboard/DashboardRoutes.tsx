import React from 'react';
import { DashboardShell } from './DashboardShell';
import type { DashboardView } from './DashboardShell';
import { RequireCapability } from '../../auth/guards';
import { NAV_BY_ID } from './nav';
import { DashboardHome } from './DashboardHome';
import { ExecutiveDecisionCenter } from './ExecutiveDecisionCenter';
import { ActionCenter } from './ActionCenter';
import { MemberManagement } from './MemberManagement';
import { CommitteeManagement } from './CommitteeManagement';
import { TaskCommandCenter } from './TaskCommandCenter';
import { SubmissionReviewCenter } from './SubmissionReviewCenter';
import { PointsAndLeaderboard } from './PointsAndLeaderboard';
import { RewardsAndDiscipline } from './RewardsAndDiscipline';
import { RegistrationManager } from './RegistrationManager';
import { WebsiteCMS } from './WebsiteCMS';
import { MediaLibrary } from './MediaLibrary';
import { SeasonPlanner } from './SeasonPlanner';
import { SeasonsAndObjectives } from './SeasonsAndObjectives';
import { SkillMatrix } from './SkillMatrix';
import { KPIAnalytics } from './KPIAnalytics';
import { SocialMediaInsightsView } from './SocialMediaInsightsView';
import { ModeratorTools } from './ModeratorTools';
import { AuditTrailView } from './AuditTrailView';
import { NotificationsAndEmail } from './NotificationsAndEmail';
import { ReportBuilder } from './ReportBuilder';
import { SettingsAndBackups } from './SettingsAndBackups';

interface DashboardRoutesProps {
  currentView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  onExitToPublicWebsite: () => void;
  onSignOut: () => void;
}

type ViewProps = { onNavigate: (view: DashboardView) => void };

/**
 * What each surface needs is declared once, in `nav.ts`, so a screen cannot be listed in the
 * sidebar without also being wrapped here. The wrapper is presentation as much as routing —
 * `RequireCapability` refuses to render, and the provider refuses the request regardless.
 */

const views: Record<DashboardView, React.FC<ViewProps>> = {
  overview: DashboardHome,
  decision_center: ExecutiveDecisionCenter,
  action_center: ActionCenter,
  members: MemberManagement,
  committees: CommitteeManagement,
  tasks: TaskCommandCenter,
  submissions: SubmissionReviewCenter,
  scoring: PointsAndLeaderboard,
  rewards: RewardsAndDiscipline,
  applications: RegistrationManager,
  website_cms: WebsiteCMS,
  media_library: MediaLibrary,
  season_planner: SeasonPlanner,
  seasons_objectives: SeasonsAndObjectives,
  skill_matrix: SkillMatrix,
  kpi_analytics: KPIAnalytics,
  social_media: SocialMediaInsightsView,
  moderator: ModeratorTools,
  audit_log: AuditTrailView,
  notifications: NotificationsAndEmail,
  report_builder: ReportBuilder,
  settings: SettingsAndBackups,
};

export const DashboardRoutes: React.FC<DashboardRoutesProps> = ({
  currentView,
  onViewChange,
  onExitToPublicWebsite,
  onSignOut,
}) => {
  const ActiveView = views[currentView];
  const requirement = NAV_BY_ID[currentView]?.capability ?? null;
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
