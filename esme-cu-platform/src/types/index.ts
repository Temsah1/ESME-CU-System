export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: 'super_admin' | 'director' | 'head' | 'member' | 'moderator';
  committeeId?: string;
  subTeam?: string;
  avatar?: string;
  academicYear?: string;
  department?: string;
  studentId?: string;
  phone?: string;
  status: 'active' | 'inactive';
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
  directorId?: string;
  directorName?: string;
  headId?: string;
  headName?: string;
  memberCount: number;
  objectives: string[];
  subTeams: string[];
  isPublic: boolean;
  status: 'active' | 'archived';
  category: 'technical' | 'media' | 'marketing' | 'operations' | 'management';
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
  studentId?: string;
  academicYear: string;
  department: string;
  phone: string;
  preferredCommitteeId: string;
  secondCommitteePreferenceId?: string;
  technicalSkills: string;
  previousExperience: string;
  motivation: string;
  availabilityHours: string;
  agreedToPolicies: boolean;
  appliedDate: string;
  status: 'pending' | 'under_review' | 'accepted' | 'rejected' | 'waitlisted';
  assignedCommitteeId?: string;
  internalNotes?: string;
  reviewedBy?: string;
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
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'alert';
  timestamp: string;
  read: boolean;
  link?: string;
}

export interface WebsiteContentConfig {
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
    socialHandle: string;
    location: string;
  };
}
