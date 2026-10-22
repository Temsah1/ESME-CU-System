import {
  Award,
  CheckSquare,
  Compass,
  FileCheck2,
  FileSpreadsheet,
  Flag,
  Gauge,
  Globe,
  History,
  Images,
  Inbox,
  Layers,
  LayoutDashboard,
  LineChart,
  Mail,
  Scale,
  Settings,
  Share2,
  ShieldAlert,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '../../domain/roles';
import type { DashboardView } from './DashboardShell';

/**
 * The one list of screens. The sidebar renders it, the route guard reads `capability` from it,
 * the command palette searches it and the breadcrumb prints from it, so a screen cannot be
 * reachable in one of those four and hidden in another.
 *
 * `capability` is presentation as much as routing: `DashboardRoutes` wraps the view in
 * `RequireCapability`, and the provider refuses the request regardless of what this file says.
 */
export type NavItem = {
  id: DashboardView;
  label: string;
  group: string;
  icon: LucideIcon;
  /** Null means every signed-in account may open it. */
  capability: Capability | null;
  /** What the screen holds, so a search for "ledger" finds the screen that shows it. */
  keywords: string;
};

const item = (
  id: DashboardView,
  label: string,
  group: string,
  icon: LucideIcon,
  capability: Capability | null,
  keywords = ''
): NavItem => ({ id, label, group, icon, capability, keywords });

export const NAV_ITEMS: NavItem[] = [
  item('overview', 'Overview', 'Core Command', LayoutDashboard, null, 'home, today, my chapter'),
  item('notifications', 'Alerts & Email', 'Core Command', Mail, null, 'inbox, delivery, notifications, preferences'),
  item('decision_center', 'Decision Center', 'Core Command', Gauge, 'analytics.configure', 'approvals, bottlenecks, risk'),
  item('action_center', 'Action Center', 'Core Command', Inbox, 'tasks.read', 'pending, waiting on me, queue'),
  item('kpi_analytics', 'KPI & Analytics', 'Core Command', LineChart, 'analytics.configure', 'metrics, throughput, charts'),
  item('season_planner', 'Season Planner', 'Core Command', Compass, 'events.read', 'milestones, calendar, plan'),
  item('seasons_objectives', 'Seasons & Objectives', 'Core Command', Flag, 'analytics.configure', 'okr, key results, continuity'),

  item('members', 'Members Directory', 'Organization & People', Users, 'users.read', 'people, accounts, roster'),
  item('committees', 'Committees & Teams', 'Organization & People', Layers, 'committees.read', 'structure, seats, director, head'),
  item('applications', 'Recruitment Apps', 'Organization & People', UserPlus, 'registrations.read', 'applicants, approve, reject'),
  item('skill_matrix', 'L0–L4 Skill Matrix', 'Organization & People', Award, 'skills.read', 'levels, courses, development'),

  item('tasks', 'Tasks Command', 'Operations & Execution', CheckSquare, 'tasks.read', 'assignments, deadlines, create task'),
  item('submissions', 'Submissions Review', 'Operations & Execution', FileCheck2, 'submissions.read', 'review, approve, revision'),
  item('scoring', 'Points & Ledger', 'Operations & Execution', Award, 'scores.read', 'points, leaderboard, appeal'),
  item('rewards', 'Bonuses & Warnings', 'Operations & Execution', Scale, 'rewards.read', 'bonus, warning, discipline, matrix'),

  item('website_cms', 'Website CMS', 'Public Channels & Content', Globe, 'cms.content.write', 'pages, images, publish, media'),
  item('media_library', 'Media Library', 'Public Channels & Content', Images, 'cms.media.manage', 'upload, pictures, files, which block uses this image, delete'),
  item('social_media', 'Meta Post Insights', 'Public Channels & Content', Share2, 'cms.content.write', 'posts, reach, engagement'),

  item('audit_log', 'Audit Trail', 'System & Governance', History, 'audit.read', 'who did what, append-only'),
  item('report_builder', 'Report Export', 'System & Governance', FileSpreadsheet, 'submissions.read', 'xlsx, export, workbook'),
  item('moderator', 'IT Moderator Tools', 'System & Governance', ShieldAlert, 'registrations.decide', 'bootstrap, roles, suspend, cache'),
  item('settings', 'Settings & Backups', 'System & Governance', Settings, 'settings.manage', 'theme, registration form, export, backup'),
];

export const NAV_BY_ID: Record<DashboardView, NavItem> = NAV_ITEMS.reduce(
  (acc, entry) => {
    acc[entry.id] = entry;
    return acc;
  },
  {} as Record<DashboardView, NavItem>
);

/** Grouped the way the sidebar draws them, in the order the list above is written. */
export const NAV_SECTIONS: { group: string; items: NavItem[] }[] = [
  'Core Command',
  'Organization & People',
  'Operations & Execution',
  'Public Channels & Content',
  'System & Governance',
].map((group) => ({ group, items: NAV_ITEMS.filter((entry) => entry.group === group) }));
