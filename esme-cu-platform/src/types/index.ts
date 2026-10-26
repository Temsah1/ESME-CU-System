import type { AccountStatus } from '../domain/accountState';

export type Role = 'super_admin' | 'high_board' | 'director' | 'head' | 'moderator' | 'member';

export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: Role;
  committeeId?: string;
  subTeam?: string;
  avatar?: string;
  academicYear?: string;
  department?: string;
  studentId?: string;
  phone?: string;
  status: AccountStatus;
  totalPoints: number;
  approvedTasksCount: number;
  joinedDate: string;
  lastActive: string;
}

export interface Committee {
  id: string;
  name: string;
  shortCode: string;
  description: string;
  /**
   * Leadership is stored as a reference to the account only. A person's name is read from
   * that account, never copied onto the committee: an earlier shape cached `directorName`
   * and `headName`, so renaming or replacing an office-holder left the old name on the
   * public site and in the dashboard forever.
   */
  directorId?: string;
  headId?: string;
  /** Computed from real memberships; never typed in. Absent until members exist. */
  memberCount?: number;
  objectives: string[];
  subTeams: string[];
  isPublic: boolean;
  status: 'active' | 'archived';
  category: 'technical' | 'media' | 'marketing' | 'operations' | 'management';
  /** Written by the save path; compared on the next write to refuse a stale overwrite. */
  updatedAt?: string;
}

export type TaskStatus = 
  | 'draft' 
  | 'assigned' 
  | 'in_progress' 
  | 'submitted' 
  | 'under_review' 
  | 'revision_requested' 
  | 'approved' 
  | 'rejected' 
  | 'cancelled'
  | 'overdue';

export interface Task {
  id: string;
  title: string;
  description: string;
  committeeId: string;
  committeeName: string;
  assigneeIds: string[];
  assigneeNames: string[];
  createdById: string;
  createdByName: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  points: number;
  startDate: string;
  deadline: string;
  status: TaskStatus;
  acceptanceCriteria: string[];
  referenceLinks?: string[];
  category: string;
  createdAt: string;
  /** Soft delete: an archived row keeps its assignments, submissions and score history. */
  archivedAt?: string;
  archivedBy?: string;
}

export interface TaskSubmission {
  id: string;
  taskId: string;
  taskTitle: string;
  committeeId: string;
  committeeName: string;
  memberId: string;
  memberName: string;
  submittedAt: string;
  description: string;
  attachments?: { name: string; url: string; size?: string }[];
  externalLinks?: string[];
  status: 'submitted' | 'under_review' | 'revision_requested' | 'approved' | 'rejected';
  reviewerFeedback?: string;
  /** Quality is recorded apart from completion: the rubric marks actually given. */
  reviewRubric?: { label: string; mark: 0 | 1 | 2 }[];
  rubricPercent?: number | null;
  reviewedBy?: string;
  reviewedAt?: string;
  proposedPoints: number;
  awardedPoints?: number;
  version: number;
}

export interface ScoreLedgerEntry {
  id: string;
  memberId: string;
  memberName: string;
  committeeId: string;
  taskId?: string;
  taskTitle?: string;
  points: number;
  actionType: 'task_completion' | 'manual_adjustment' | 'bonus' | 'penalty' | 'event_attendance';
  reviewerId: string;
  reviewerName: string;
  timestamp: string;
  reason: string;
  previousTotal: number;
  newTotal: number;
}

export interface RegistrationApplication {
  id: string;
  fullName: string;
  universityEmail: string;
  /**
   * The questionnaire answers are recorded only for the fields the schema enables. A field that
   * is switched off is absent here, not filled with a plausible default — an applicant who was
   * never asked for a department must not be reported as having chosen one.
   */
  studentId?: string;
  academicYear?: string;
  department?: string;
  phone?: string;
  /**
   * The applicant's own answer to "are you already a member of a committee". `'yes'` is what makes
   * the committee answer below obligatory; `'no'` is what makes an empty one correct rather than
   * missing. Absent on applications filed before the question was asked.
   */
  committeeMembership?: string;
  /** Empty when the applicant took the optional committee question as an invitation to leave it. */
  preferredCommitteeId: string;
  secondCommitteePreferenceId?: string;
  technicalSkills?: string;
  previousExperience?: string;
  motivation?: string;
  availabilityHours?: string;
  agreedToPolicies: boolean;
  appliedDate: string;
  status: 'pending' | 'under_review' | 'accepted' | 'rejected' | 'waitlisted';
  /** The provider's own account status, shown next to the stage the board projects it to. */
  accountStatus?: AccountStatus;
  /** Profile / auth identity this queue row is about. */
  authUserId?: string;
  /**
   * `esme_registration_requests.id` — the row a decision must name. Local rows created in this
   * browser have no server queue row yet, so this stays empty until the provider's queue is read.
   */
  requestId?: string;
  assignedCommitteeId?: string;
  internalNotes?: string;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface RegistrationFieldConfig {
  id: string;
  label: string;
  name: string;
  type: 'text' | 'email' | 'tel' | 'select' | 'textarea' | 'checkbox';
  required: boolean;
  enabled: boolean;
  options?: string[];
  description?: string;
  order: number;
}

export interface SeasonEvent {
  id: string;
  title: string;
  acronym?: string;
  category: 'Major Event' | 'Workshop' | 'Professional Session' | 'Magazine Issue' | 'Field Campaign';
  theme?: string;
  dateOrQuarter: string;
  status: 'Planned' | 'In Preparation' | 'Confirmed' | 'Completed';
  targetMetric: string;
  actualMetric?: string;
  responsibleCommittee: string;
  description: string;
  venue?: string;
  isPublic: boolean;
}

export interface SkillMatrixEntry {
  id: string;
  memberId: string;
  memberName: string;
  committeeId: string;
  skillName: 'Materials Science' | 'Inspection & NDT' | 'Engineering Software' | 'Technical Research' | 'Presentation' | 'Project Management';
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'; // L0: Novice, L1: Aware, L2: Practitioner, L3: Advanced, L4: Master
  lastAssessment: string;
  assessorName: string;
  evidence: string;
  improvementGoal: string;
}

/** What a committee or role asks of a member. Empty committee/role means chapter-wide. */
export interface SkillRequirement {
  id: string;
  committeeId?: string;
  role?: Role;
  skillName: SkillMatrixEntry['skillName'];
  minLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  rationale: string;
}

export interface TrainingCourse {
  id: string;
  skillName: SkillMatrixEntry['skillName'];
  title: string;
  provider: string;
  hours: number;
  levelTarget: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
}

export interface CourseCompletion {
  id: string;
  memberId: string;
  courseId: string;
  completedAt: string;
  /** A completion is a claim too: what was submitted or shown to prove it. */
  evidence: string;
  recordedBy: string;
}

export interface DevelopmentGoal {
  id: string;
  memberId: string;
  skillName: SkillMatrixEntry['skillName'];
  fromLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  toLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  dueDate: string;
  status: 'open' | 'achieved' | 'dropped';
  note: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DevelopmentFeedback {
  id: string;
  memberId: string;
  committeeId?: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  kind: 'mentor' | 'reviewer';
  body: string;
  at: string;
  /** 'member' keeps it to the person and the author; 'committee' lets leadership in scope read it. */
  visibility: 'member' | 'committee';
}

export interface AuditLogItem {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: 'user' | 'committee' | 'task' | 'submission' | 'score' | 'application' | 'cms' | 'system';
  targetId: string;
  details: string;
  timestamp: string;
  /**
   * Privilege changes carry their own evidence, not just a sentence in `details`. Rows written
   * before these fields existed leave them unset, which reads as an allowed action — the trail
   * only gained the explicit mark once refusals began to be recorded too.
   */
  outcome?: 'allowed' | 'denied';
  previousRole?: Role;
  newRole?: Role;
  reason?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'alert';
  timestamp: string;
  read: boolean;
  link?: string;
  /** The action-queue key this was raised from. Absent on an item written by hand. */
  sourceKey?: string;
  /** 'in_app' is the only honest status here: this build delivers through no provider. */
  delivery?: 'in_app' | 'suppressed';
}

/** A block of the public page the operator can switch off or move. */
export type PublicSectionKey =
  | 'home'
  | 'about'
  | 'vision'
  | 'history'
  | 'appreciation'
  | 'committees'
  | 'events'
  | 'magazine'
  | 'insights'
  | 'contact';

export interface ContentSectionState {
  key: PublicSectionKey;
  visible: boolean;
  order: number;
}

export interface ContentLink {
  id: string;
  label: string;
  /** An anchor (`#about`), a same-site path (`/branding/x.png`) or an absolute http(s) URL. */
  href: string;
  visible: boolean;
}

export interface ContentSocial {
  id: string;
  network: string;
  handle: string;
  url: string;
  visible: boolean;
}

/**
 * An image slot names a media asset the asset store produced; it never holds a typed URL. That
 * is what keeps a content write from aiming the public site at an arbitrary remote host, and it
 * is what lets the library report which slots still point at an asset.
 */
export interface ContentImageSlot {
  assetId?: string;
  alt?: string;
  caption?: string;
}

/** The four raster formats the library accepts. SVG is deliberately absent: a vector an operator
 * uploads can carry a script, and nothing on this page needs one. */
export type MediaKind = 'png' | 'jpeg' | 'webp' | 'gif';

/**
 * One picture the CMS can point a slot at.
 *
 * `src` is what the page puts in `src`. For a `bundled` asset that is a path shipped with the
 * build; for a `library` asset it is a URL the asset store handed back. A browser cannot promise a
 * URL another device will see, so an asset whose `src` is a `blob:` or `data:` address is marked
 * `deviceOnly` and reported as such instead of being published as if it were shared.
 */
export interface MediaAsset {
  id: string;
  /** The file name the operator uploaded, kept for search and for the library list. */
  name: string;
  src: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  alt: string;
  caption?: string;
  /** True when the picture carries no information and the empty `alt` is therefore correct. */
  decorative?: boolean;
  /** 0..1 focus point, so a crop can keep the face in frame. */
  focal?: { x: number; y: number };
  origin: 'bundled' | 'library';
  addedAt: string;
  /** A bundled asset (the logo, the favicon) that no screen may replace or delete. */
  protected?: boolean;
  /** The bytes live on this device only — no asset store is connected yet. */
  deviceOnly?: boolean;
}

export interface WebsiteContentConfig {
  /**
   * Which shape this document is. The storage migration reads the number on the row, not the
   * version key, so a browser holding an old copy gets its text carried forward instead of a
   * repopulated constant.
   */
  documentVersion: 2;
  hero: {
    badge: string;
    headline: string;
    supportingMessage: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  about: {
    title: string;
    story: string;
    purpose: string;
    objectives: string[];
    values: string[];
    foundedYear: string;
    foundingFaculty: string;
    cairoChapterFounded: string;
  };
  vision2027: {
    headline: string;
    quote: string;
    description: string;
    pillars: {
      title: string;
      description: string;
      points: string[];
    }[];
  };
  contact: {
    email: string;
    phone: string;
    website: string;
    location: string;
  };
  /** What a share card shows when a link to the site is pasted somewhere. */
  sharing: {
    title: string;
    description: string;
  };
  sections: ContentSectionState[];
  navigation: ContentLink[];
  footer: {
    blurb: string;
    copyright: string;
    links: ContentLink[];
  };
  socials: ContentSocial[];
  images: Record<string, ContentImageSlot>;
}
