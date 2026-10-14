import React, { createContext, useContext, useState, useEffect } from 'react';
import type {
  User,
  Committee,
  Task,
  TaskSubmission,
  ScoreLedgerEntry,
  RegistrationApplication,
  RegistrationFieldConfig,
  SeasonEvent,
  SkillMatrixEntry,
  AuditLogItem,
  NotificationItem,
  WebsiteContentConfig
} from '../types';
import {
  INITIAL_USERS,
  INITIAL_COMMITTEES,
  INITIAL_TASKS,
  INITIAL_SUBMISSIONS,
  INITIAL_SCORE_LEDGER,
  INITIAL_APPLICATIONS,
  INITIAL_FORM_FIELDS,
  INITIAL_SEASON_EVENTS,
  INITIAL_SKILL_MATRIX,
  INITIAL_NOTIFICATIONS,
  INITIAL_AUDIT_LOGS,
  INITIAL_WEBSITE_CONTENT
} from '../data/initialData';

interface AppContextType {
  currentUser: User;
  setCurrentUser: (user: User) => void;
  switchRole: (role: User['role']) => void;
  
  users: User[];
  addUser: (user: Omit<User, 'id' | 'totalPoints' | 'approvedTasksCount' | 'joinedDate' | 'lastActive'>) => void;
  updateUser: (id: string, updates: Partial<User>) => void;
  deleteUser: (id: string) => void;

  committees: Committee[];
  addCommittee: (committee: Omit<Committee, 'id' | 'memberCount'>) => void;
  updateCommittee: (id: string, updates: Partial<Committee>) => void;
  archiveCommittee: (id: string) => void;

  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;

  submissions: TaskSubmission[];
  addSubmission: (submission: Omit<TaskSubmission, 'id' | 'submittedAt' | 'version'>) => void;
  reviewSubmission: (
    submissionId: string, 
    decision: 'approved' | 'rejected' | 'revision_requested', 
    feedback: string,
    awardedPoints?: number
  ) => void;

  scoreLedger: ScoreLedgerEntry[];
  addManualPointAdjustment: (memberId: string, points: number, reason: string) => void;

  applications: RegistrationApplication[];
  submitApplication: (application: Omit<RegistrationApplication, 'id' | 'appliedDate' | 'status'>) => void;
  updateApplicationStatus: (id: string, status: RegistrationApplication['status'], notes?: string, committeeId?: string) => void;

  formFields: RegistrationFieldConfig[];
  updateFormFields: (fields: RegistrationFieldConfig[]) => void;

  seasonEvents: SeasonEvent[];
  addSeasonEvent: (event: Omit<SeasonEvent, 'id'>) => void;
  updateSeasonEvent: (id: string, updates: Partial<SeasonEvent>) => void;

  skillMatrix: SkillMatrixEntry[];
  updateMemberSkill: (id: string, updates: Partial<SkillMatrixEntry>) => void;
  addMemberSkill: (entry: Omit<SkillMatrixEntry, 'id'>) => void;

  notifications: NotificationItem[];
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;

  auditLogs: AuditLogItem[];
  logAction: (action: string, targetType: AuditLogItem['targetType'], targetId: string, details: string) => void;

  websiteContent: WebsiteContentConfig;
  updateWebsiteContent: (updates: Partial<WebsiteContentConfig>) => void;

  theme: 'light' | 'dark';
  toggleTheme: () => void;

  resetToDefaultData: () => void;
  exportDataJSON: () => string;
  importDataJSON: (jsonStr: string) => boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'ESME_CU_STATE_V1';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Load from local storage or defaults
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_users`);
    return saved ? JSON.parse(saved) : INITIAL_USERS;
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_currentUser`);
    return saved ? JSON.parse(saved) : INITIAL_USERS[0]; // Kareem Tamer (Super Admin)
  });

  const [committees, setCommittees] = useState<Committee[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_committees`);
    return saved ? JSON.parse(saved) : INITIAL_COMMITTEES;
  });

  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_tasks`);
    return saved ? JSON.parse(saved) : INITIAL_TASKS;
  });

  const [submissions, setSubmissions] = useState<TaskSubmission[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_submissions`);
    return saved ? JSON.parse(saved) : INITIAL_SUBMISSIONS;
  });

  const [scoreLedger, setScoreLedger] = useState<ScoreLedgerEntry[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_scoreLedger`);
    return saved ? JSON.parse(saved) : INITIAL_SCORE_LEDGER;
  });

  const [applications, setApplications] = useState<RegistrationApplication[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_applications`);
    return saved ? JSON.parse(saved) : INITIAL_APPLICATIONS;
  });

  const [formFields, setFormFields] = useState<RegistrationFieldConfig[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_formFields`);
    return saved ? JSON.parse(saved) : INITIAL_FORM_FIELDS;
  });

  const [seasonEvents, setSeasonEvents] = useState<SeasonEvent[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_seasonEvents`);
    return saved ? JSON.parse(saved) : INITIAL_SEASON_EVENTS;
  });

  const [skillMatrix, setSkillMatrix] = useState<SkillMatrixEntry[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_skillMatrix`);
    return saved ? JSON.parse(saved) : INITIAL_SKILL_MATRIX;
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_notifications`);
    return saved ? JSON.parse(saved) : INITIAL_NOTIFICATIONS;
  });

  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_auditLogs`);
    return saved ? JSON.parse(saved) : INITIAL_AUDIT_LOGS;
  });

  const [websiteContent, setWebsiteContent] = useState<WebsiteContentConfig>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_websiteContent`);
    return saved ? JSON.parse(saved) : INITIAL_WEBSITE_CONTENT;
  });

  // Sync to LocalStorage
  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_users`, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_currentUser`, JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_committees`, JSON.stringify(committees));
  }, [committees]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_tasks`, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_submissions`, JSON.stringify(submissions));
  }, [submissions]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_scoreLedger`, JSON.stringify(scoreLedger));
  }, [scoreLedger]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_applications`, JSON.stringify(applications));
  }, [applications]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_formFields`, JSON.stringify(formFields));
  }, [formFields]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_seasonEvents`, JSON.stringify(seasonEvents));
  }, [seasonEvents]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_skillMatrix`, JSON.stringify(skillMatrix));
  }, [skillMatrix]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_notifications`, JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_auditLogs`, JSON.stringify(auditLogs));
  }, [auditLogs]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_websiteContent`, JSON.stringify(websiteContent));
  }, [websiteContent]);

  // Logging helper
  const logAction = (action: string, targetType: AuditLogItem['targetType'], targetId: string, details: string) => {
    const newEntry: AuditLogItem = {
      id: `aud_${Date.now()}`,
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action,
      targetType,
      targetId,
      details,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };
    setAuditLogs(prev => [newEntry, ...prev]);
  };

  // Switch role helper for demo testing
  const switchRole = (role: User['role']) => {
    const found = users.find(u => u.role === role);
    if (found) {
      setCurrentUser(found);
      logAction(`Switched Persona to ${found.name} (${role})`, 'system', found.id, `Simulated role switch for interactive testing.`);
    }
  };

  // User Actions
  const addUser = (userData: Omit<User, 'id' | 'totalPoints' | 'approvedTasksCount' | 'joinedDate' | 'lastActive'>) => {
    const newUser: User = {
      ...userData,
      id: `usr_${Date.now()}`,
      totalPoints: 0,
      approvedTasksCount: 0,
      joinedDate: new Date().toISOString().split('T')[0],
      lastActive: 'Just registered'
    };
    setUsers(prev => [newUser, ...prev]);
    logAction('Created User', 'user', newUser.id, `Created account for ${newUser.name} as ${newUser.role}`);
  };

  const updateUser = (id: string, updates: Partial<User>) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    if (currentUser.id === id) {
      setCurrentUser(prev => ({ ...prev, ...updates }));
    }
    logAction('Updated User Profile', 'user', id, `Modified fields: ${Object.keys(updates).join(', ')}`);
  };

  const deleteUser = (id: string) => {
    const u = users.find(x => x.id === id);
    setUsers(prev => prev.filter(x => x.id !== id));
    logAction('Deleted User', 'user', id, `Removed user ${u?.name || id}`);
  };

  // Committee Actions
  const addCommittee = (commData: Omit<Committee, 'id' | 'memberCount'>) => {
    const newComm: Committee = {
      ...commData,
      id: `comm_${Date.now()}`,
      memberCount: 0
    };
    setCommittees(prev => [...prev, newComm]);
    logAction('Created Committee', 'committee', newComm.id, `Created committee: ${newComm.name}`);
  };

  const updateCommittee = (id: string, updates: Partial<Committee>) => {
    setCommittees(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
    logAction('Updated Committee', 'committee', id, `Updated committee settings`);
  };

  const archiveCommittee = (id: string) => {
    setCommittees(prev => prev.map(c => c.id === id ? { ...c, status: 'archived' } : c));
    logAction('Archived Committee', 'committee', id, `Archived committee`);
  };

  // Task Actions
  const addTask = (taskData: Omit<Task, 'id' | 'createdAt'>) => {
    const newTask: Task = {
      ...taskData,
      id: `task_${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0]
    };
    setTasks(prev => [newTask, ...prev]);
    logAction('Created Task', 'task', newTask.id, `Created task: ${newTask.title}`);
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    logAction('Updated Task', 'task', id, `Updated task details`);
  };

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    logAction('Deleted Task', 'task', id, `Removed task`);
  };

  // Submissions & Reviews
  const addSubmission = (subData: Omit<TaskSubmission, 'id' | 'submittedAt' | 'version'>) => {
    const newSub: TaskSubmission = {
      ...subData,
      id: `sub_${Date.now()}`,
      submittedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      version: 1,
      status: 'submitted'
    };
    setSubmissions(prev => [newSub, ...prev]);
    // update task status
    setTasks(prev => prev.map(t => t.id === subData.taskId ? { ...t, status: 'submitted' } : t));
    logAction('Submitted Task Deliverables', 'submission', newSub.id, `Member ${subData.memberName} submitted work for ${subData.taskTitle}`);
  };

  const reviewSubmission = (
    submissionId: string, 
    decision: 'approved' | 'rejected' | 'revision_requested', 
    feedback: string,
    awardedPoints?: number
  ) => {
    const sub = submissions.find(s => s.id === submissionId);
    if (!sub) return;

    const pointsToAward = awardedPoints !== undefined ? awardedPoints : sub.proposedPoints;

    setSubmissions(prev => prev.map(s => {
      if (s.id === submissionId) {
        return {
          ...s,
          status: decision,
          reviewerFeedback: feedback,
          reviewedBy: currentUser.name,
          reviewedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
          awardedPoints: decision === 'approved' ? pointsToAward : 0
        };
      }
      return s;
    }));

    // Update corresponding task status
    const targetStatus = decision === 'approved' 
      ? 'approved' 
      : decision === 'revision_requested' 
        ? 'revision_requested' 
        : 'rejected';

    setTasks(prev => prev.map(t => t.id === sub.taskId ? { ...t, status: targetStatus } : t));

    // If approved, award points in ledger and update member profile
    if (decision === 'approved' && pointsToAward > 0) {
      const member = users.find(u => u.id === sub.memberId);
      const prevTotal = member ? member.totalPoints : 0;
      const newTotal = prevTotal + pointsToAward;

      const ledgerEntry: ScoreLedgerEntry = {
        id: `ledg_${Date.now()}`,
        memberId: sub.memberId,
        memberName: sub.memberName,
        committeeId: sub.committeeId,
        taskId: sub.taskId,
        taskTitle: sub.taskTitle,
        points: pointsToAward,
        actionType: 'task_completion',
        reviewerId: currentUser.id,
        reviewerName: currentUser.name,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        reason: `Approved task deliverables: ${sub.taskTitle}. Feedback: ${feedback}`,
        previousTotal: prevTotal,
        newTotal: newTotal
      };

      setScoreLedger(prev => [ledgerEntry, ...prev]);

      // update member points and approved count
      setUsers(prev => prev.map(u => {
        if (u.id === sub.memberId) {
          return {
            ...u,
            totalPoints: newTotal,
            approvedTasksCount: u.approvedTasksCount + 1
          };
        }
        return u;
      }));
    }

    logAction(
      `Reviewed Submission: ${decision.toUpperCase()}`, 
      'submission', 
      submissionId, 
      `Decision: ${decision} by ${currentUser.name} for ${sub.taskTitle}`
    );
  };

  // Manual Points Adjustment
  const addManualPointAdjustment = (memberId: string, points: number, reason: string) => {
    const member = users.find(u => u.id === memberId);
    if (!member) return;

    const prevTotal = member.totalPoints;
    const newTotal = prevTotal + points;

    const ledgerEntry: ScoreLedgerEntry = {
      id: `ledg_${Date.now()}`,
      memberId: member.id,
      memberName: member.name,
      committeeId: member.committeeId || 'comm_general',
      points: points,
      actionType: 'manual_adjustment',
      reviewerId: currentUser.id,
      reviewerName: currentUser.name,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      reason: reason,
      previousTotal: prevTotal,
      newTotal: newTotal
    };

    setScoreLedger(prev => [ledgerEntry, ...prev]);
    setUsers(prev => prev.map(u => u.id === memberId ? { ...u, totalPoints: newTotal } : u));
    logAction('Adjusted Member Score', 'score', memberId, `Adjustment: ${points > 0 ? '+' : ''}${points} pts. Reason: ${reason}`);
  };

  // Applications
  const submitApplication = (appData: Omit<RegistrationApplication, 'id' | 'appliedDate' | 'status'>) => {
    const newApp: RegistrationApplication = {
      ...appData,
      id: `app_${Date.now()}`,
      appliedDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
      status: 'pending'
    };
    setApplications(prev => [newApp, ...prev]);
    setNotifications(prev => [
      {
        id: `notif_${Date.now()}`,
        title: 'New Chapter Application',
        message: `${newApp.fullName} applied for ${newApp.preferredCommitteeId}.`,
        type: 'info',
        timestamp: 'Just now',
        read: false
      },
      ...prev
    ]);
    logAction('Application Submitted', 'application', newApp.id, `Application received from ${newApp.fullName}`);
  };

  const updateApplicationStatus = (
    id: string, 
    status: RegistrationApplication['status'], 
    notes?: string, 
    committeeId?: string
  ) => {
    setApplications(prev => prev.map(a => {
      if (a.id === id) {
        return {
          ...a,
          status,
          internalNotes: notes !== undefined ? notes : a.internalNotes,
          assignedCommitteeId: committeeId || a.assignedCommitteeId,
          reviewedBy: currentUser.name
        };
      }
      return a;
    }));
    logAction('Updated Application Status', 'application', id, `Status changed to ${status}`);
  };

  // Form Fields
  const updateFormFields = (fields: RegistrationFieldConfig[]) => {
    setFormFields(fields);
    logAction('Updated Registration Form Builder', 'cms', 'form_builder', `Saved customized registration form schema`);
  };

  // Season Events
  const addSeasonEvent = (evtData: Omit<SeasonEvent, 'id'>) => {
    const newEvt: SeasonEvent = {
      ...evtData,
      id: `evt_${Date.now()}`
    };
    setSeasonEvents(prev => [...prev, newEvt]);
    logAction('Added Season Event', 'system', newEvt.id, `Added event: ${newEvt.title}`);
  };

  const updateSeasonEvent = (id: string, updates: Partial<SeasonEvent>) => {
    setSeasonEvents(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    logAction('Updated Season Event', 'system', id, `Updated season event: ${id}`);
  };

  // Skill Matrix
  const updateMemberSkill = (id: string, updates: Partial<SkillMatrixEntry>) => {
    setSkillMatrix(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    logAction('Updated Member Skill', 'user', id, `Updated skill assessment level`);
  };

  const addMemberSkill = (entry: Omit<SkillMatrixEntry, 'id'>) => {
    const newEntry: SkillMatrixEntry = {
      ...entry,
      id: `sk_${Date.now()}`
    };
    setSkillMatrix(prev => [...prev, newEntry]);
    logAction('Added Skill Assessment', 'user', newEntry.id, `Assessed ${newEntry.memberName} in ${newEntry.skillName}`);
  };

  // Notifications
  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  // Website Content
  const updateWebsiteContent = (updates: Partial<WebsiteContentConfig>) => {
    setWebsiteContent(prev => ({ ...prev, ...updates }));
    logAction('Updated Website Content CMS', 'cms', 'website_config', `Modified public page content`);
  };

  // Theme toggle
  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Reset to default
  const resetToDefaultData = () => {
    localStorage.clear();
    setUsers(INITIAL_USERS);
    setCurrentUser(INITIAL_USERS[0]);
    setCommittees(INITIAL_COMMITTEES);
    setTasks(INITIAL_TASKS);
    setSubmissions(INITIAL_SUBMISSIONS);
    setScoreLedger(INITIAL_SCORE_LEDGER);
    setApplications(INITIAL_APPLICATIONS);
    setFormFields(INITIAL_FORM_FIELDS);
    setSeasonEvents(INITIAL_SEASON_EVENTS);
    setSkillMatrix(INITIAL_SKILL_MATRIX);
    setNotifications(INITIAL_NOTIFICATIONS);
    setAuditLogs(INITIAL_AUDIT_LOGS);
    setWebsiteContent(INITIAL_WEBSITE_CONTENT);
  };

  const exportDataJSON = () => {
    const exportObj = {
      users,
      committees,
      tasks,
      submissions,
      scoreLedger,
      applications,
      formFields,
      seasonEvents,
      skillMatrix,
      notifications,
      auditLogs,
      websiteContent,
      exportedAt: new Date().toISOString()
    };
    return JSON.stringify(exportObj, null, 2);
  };

  const importDataJSON = (jsonStr: string): boolean => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.users && data.committees && data.tasks) {
        setUsers(data.users);
        setCommittees(data.committees);
        setTasks(data.tasks);
        if (data.submissions) setSubmissions(data.submissions);
        if (data.scoreLedger) setScoreLedger(data.scoreLedger);
        if (data.applications) setApplications(data.applications);
        if (data.formFields) setFormFields(data.formFields);
        if (data.seasonEvents) setSeasonEvents(data.seasonEvents);
        if (data.skillMatrix) setSkillMatrix(data.skillMatrix);
        if (data.websiteContent) setWebsiteContent(data.websiteContent);
        logAction('Imported Backup Data', 'system', 'json_restore', 'Restored complete organization state from JSON file');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        switchRole,
        users,
        addUser,
        updateUser,
        deleteUser,
        committees,
        addCommittee,
        updateCommittee,
        archiveCommittee,
        tasks,
        addTask,
        updateTask,
        deleteTask,
        submissions,
        addSubmission,
        reviewSubmission,
        scoreLedger,
        addManualPointAdjustment,
        applications,
        submitApplication,
        updateApplicationStatus,
        formFields,
        updateFormFields,
        seasonEvents,
        addSeasonEvent,
        updateSeasonEvent,
        skillMatrix,
        updateMemberSkill,
        addMemberSkill,
        notifications,
        markNotificationRead,
        clearAllNotifications,
        auditLogs,
        logAction,
        websiteContent,
        updateWebsiteContent,
        theme,
        toggleTheme,
        resetToDefaultData,
        exportDataJSON,
        importDataJSON
      }}
    >
      <div className={theme === 'dark' ? 'dark' : ''}>
        {children}
      </div>
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
