/**
 * Server-side copy of the ESME CU email templates.
 *
 * This file is a port of `src/domain/email.ts`, not a second design. It exists because a
 * Supabase Edge Function can only import modules from inside `supabase/functions/`, so the
 * deployable bundle needs its own copy of the wording. The drift is not left to good
 * intentions: `src/domain/emailTemplates.server.test.ts` renders every event through both
 * modules and fails if any subject, line or link differs in either language.
 *
 * What the two copies share: no template accepts raw HTML, every interpolated value is
 * escaped, and only http/https links survive. The payload an Edge Function receives comes
 * from a database trigger, so its fields are record facts — never a request body.
 */

export type EmailLocale = 'en' | 'ar';

export type WarningSeverity = 'notice' | 'formal' | 'final';

export type EmailEvent =
  | 'account_created'
  | 'account_approved'
  | 'account_rejected'
  | 'login_security_alert'
  | 'task_assigned'
  | 'task_assigned_to_team'
  | 'bonus_awarded'
  | 'warning_issued'
  | 'warning_escalated'
  | 'deadline_reminder'
  | 'submission_revision_requested'
  | 'submission_approved'
  | 'submission_rejected';

export const SECURITY_EVENTS: EmailEvent[] = ['account_created', 'account_approved', 'account_rejected', 'login_security_alert'];

export function isSecurityEvent(event: EmailEvent): boolean {
  return SECURITY_EVENTS.includes(event);
}

export type EmailPayload =
  | { event: 'account_created'; fullName: string; reference: string; reviewNote?: string }
  | { event: 'account_approved'; fullName: string; loginUrl: string; committeeName?: string }
  | { event: 'account_rejected'; fullName: string; reason?: string; reapplyUrl?: string }
  | { event: 'login_security_alert'; fullName: string; occurredAt: string; device: string; location?: string; wasNotYouUrl: string }
  | { event: 'task_assigned'; fullName: string; taskTitle: string; deadline: string; points: number; taskUrl: string; leaderName: string }
  | { event: 'task_assigned_to_team'; supervisorName: string; assigneeName: string; taskTitle: string; deadline: string; leaderName: string; taskUrl: string }
  | { event: 'bonus_awarded'; fullName: string; points: number; reason: string; awarderName: string; newTotal: number; taskTitle?: string }
  | { event: 'warning_issued'; fullName: string; severity: WarningSeverity; reason: string; issuerName: string; evidenceUrl?: string }
  | { event: 'warning_escalated'; recipientName: string; memberName: string; count: number; windowDays: number }
  | { event: 'deadline_reminder'; fullName: string; taskTitle: string; deadline: string; daysRemaining: number; taskUrl: string }
  | { event: 'submission_revision_requested'; fullName: string; taskTitle: string; feedback: string; taskUrl: string }
  | { event: 'submission_approved'; fullName: string; taskTitle: string; points: number; newTotal: number }
  | { event: 'submission_rejected'; fullName: string; taskTitle: string; reason: string };

export const EMAIL_EVENTS: EmailEvent[] = [
  'account_created',
  'account_approved',
  'account_rejected',
  'login_security_alert',
  'task_assigned',
  'task_assigned_to_team',
  'bonus_awarded',
  'warning_issued',
  'warning_escalated',
  'deadline_reminder',
  'submission_revision_requested',
  'submission_approved',
  'submission_rejected',
];

export const EMAIL_EVENT_LABELS: Record<EmailEvent, string> = {
  account_created: 'Account created',
  account_approved: 'Committee placement recorded',
  account_rejected: 'Application rejected',
  login_security_alert: 'New sign-in',
  task_assigned: 'Task assigned',
  task_assigned_to_team: 'Task assigned in your team',
  bonus_awarded: 'Bonus awarded',
  warning_issued: 'Warning issued',
  warning_escalated: 'Warning escalation',
  deadline_reminder: 'Deadline reminder',
  submission_revision_requested: 'Revision requested',
  submission_approved: 'Submission approved',
  submission_rejected: 'Submission rejected',
};

export type RenderedEmail = {
  event: EmailEvent;
  locale: EmailLocale;
  to: string;
  subject: string;
  preheader: string;
  /** Escaped HTML only. Rendered by the provider, never by React. */
  html: string;
  /** Plain-text alternative for clients that strip markup. */
  text: string;
};

/** Only these schemes can appear in a link. `javascript:` and friends are dropped, not escaped. */
export function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAVY = '#123B60';
const ORANGE = '#F59A16';

type Copy = { subject: string; preheader: string; greeting: string; lines: string[]; cta?: string };

const sevAr = (severity: WarningSeverity) =>
  severity === 'notice' ? 'تنبيه' : severity === 'formal' ? 'إنذار رسمي' : 'إنذار أخير';

/**
 * One copy block per event per language, built from the payload's own fields — which is what
 * makes "the record says X" and "the email says X" impossible to diverge.
 */
function copyFor(p: EmailPayload, ar: boolean): Copy {
  switch (p.event) {
    case 'account_created':
      return {
        subject: ar ? 'تم إنشاء حسابك — يمكنك تسجيل الدخول الآن' : 'Account created — you can sign in now',
        preheader: ar
          ? 'لا ينتظر حسابك موافقة أحد: لوحة الأعضاء مفتوحة لك.'
          : 'Nothing inside the chapter has to approve you before you sign in.',
        greeting: ar ? `أهلاً ${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar ? `تم استلام طلب انضمامك إلى شعبة طلاب كلية الهندسة جامعة القاهرة برقم مرجعي ${p.reference}.` : `Your request to join the ESME CU student chapter is recorded under reference ${p.reference}.`,
          ar
            ? 'سجّل دخولك بالبريد الإلكتروني وكلمة المرور اللذين اخترتهما؛ فلوحة الأعضاء تُفتح لك مباشرة. لا يحتاج حسابك إلى موافقة أي شخص داخل الشعبة قبل ذلك.'
            : 'Sign in with the email and password you chose — the member workspace opens straight away. Nobody inside the chapter has to approve your account first.',
          ar
            ? 'سيسجّل أحد الأعضاء المسؤولين لاحقًا في أي لجنة ستعمل. هذا تعديل في السجل، وليس شرطًا للحصول على الدخول.'
            : 'Later, an officer records which committee you join. That placement is a roster change, not a condition of access.',
          ...(p.reviewNote ? [p.reviewNote] : []),
        ],
      };
    case 'account_approved':
      return {
        subject: ar ? 'تم تسجيل لجنتك — بيانات حسابك محدّثة' : 'Your committee placement is recorded',
        preheader: ar
          ? 'كان دخولك متاحًا منذ إنشاء الحساب؛ هذه الرسالة تسجّل عضويتك فقط.'
          : 'Your access never depended on this message — it records your committee.',
        greeting: ar ? `مبروك ${p.fullName}،` : `Welcome aboard, ${p.fullName},`,
        lines: [
          ar
            ? 'تم تسجيل عضويتك في الشعبة، ويمكنك تسجيل الدخول إلى لوحة الأعضاء في أي وقت.'
            : 'Your placement in the chapter is recorded, and you can sign in to the member workspace at any time.',
          ...(p.committeeName ? [ar ? `لجنتك: ${p.committeeName}.` : `Your committee: ${p.committeeName}.`] : []),
        ],
        cta: ar ? 'تسجيل الدخول' : 'Sign in',
      };
    case 'account_rejected':
      return {
        subject: ar ? 'نتيجة مراجعة طلب الانضمام' : 'About your membership request',
        preheader: ar ? 'تم رفض الطلب مع السبب.' : 'The request was not approved, with the reason attached.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar ? 'بعد المراجعة، لم يتم قبول طلب انضمامك في هذا الموسم.' : 'After review, your request was not approved for this season.',
          ...(p.reason ? [ar ? `السبب: ${p.reason}` : `Reason: ${p.reason}`] : []),
          ar ? 'يمكنك التقديم مجددًا في الموسم القادم.' : 'You are welcome to apply again next season.',
        ],
        cta: p.reapplyUrl ? (ar ? 'إعادة التقديم' : 'Apply again') : undefined,
      };
    case 'login_security_alert':
      return {
        subject: ar ? 'تسجيل دخول جديد على حسابك' : 'New sign-in to your ESME CU account',
        preheader: ar ? 'إذا لم يكن هذا أنت، غيّر كلمة المرور فورًا.' : 'Not you? Secure the account now.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar ? 'تم تسجيل الدخول إلى حسابك بالبيانات التالية:' : 'Your account was just signed in to, from:',
          `${ar ? 'التاريخ' : 'Time'}: ${p.occurredAt}`,
          `${ar ? 'الجهاز' : 'Device'}: ${p.device}`,
          ...(p.location ? [`${ar ? 'الموقع التقريبي' : 'Approximate location'}: ${p.location}`] : []),
          ar
            ? 'إذا لم تكن أنت، استخدم الرابط لتأمين حسابك فورًا. لن يطلب منك أي مسؤول كلمة المرور عبر البريد.'
            : 'If this was not you, use the link to secure the account immediately. No ESME administrator will ever ask for your password by email.',
        ],
        cta: ar ? 'لم أكن أنا' : 'This was not me',
      };
    case 'task_assigned':
      return {
        subject: ar ? `مهمة جديدة: ${p.taskTitle}` : `New task: ${p.taskTitle}`,
        preheader: ar ? 'مهم من قائدك مع موعد التسليم.' : 'Assigned by your leader, with a deadline.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar
            ? `كلّفك ${p.leaderName} بالمهمة «${p.taskTitle}»، تسليمها ${p.deadline}، ونقاطها ${p.points}.`
            : `${p.leaderName} assigned you "${p.taskTitle}", due ${p.deadline}, worth ${p.points} points.`,
        ],
        cta: ar ? 'فتح المهمة' : 'Open the task',
      };
    case 'task_assigned_to_team':
      return {
        subject: ar ? `مهمة في فريقك: ${p.taskTitle}` : `Task in your team: ${p.taskTitle}`,
        preheader: ar ? 'توزيع العمل داخل لجنتك.' : 'How work sits inside your team.',
        greeting: ar ? `${p.supervisorName}،` : `Hello ${p.supervisorName},`,
        lines: [
          ar
            ? `كلّف ${p.leaderName} العضو ${p.assigneeName} بالمهمة «${p.taskTitle}»، تسليمها ${p.deadline}.`
            : `${p.leaderName} assigned "${p.taskTitle}" to ${p.assigneeName} in your team, due ${p.deadline}.`,
        ],
        cta: ar ? 'فتح المهمة' : 'Open the task',
      };
    case 'bonus_awarded':
      return {
        subject: ar ? `مكافأة ${p.points} نقطة` : `${p.points} bonus points awarded`,
        preheader: ar ? 'سبب المكافأة موضح.' : 'The reason is recorded with the award.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar ? `أضاف ${p.awarderName} ${p.points} نقطة إلى رصيدك. السبب: ${p.reason}.` : `${p.awarderName} added ${p.points} bonus points to your total. Reason: ${p.reason}.`,
          ...(p.taskTitle ? [ar ? `المهمة: ${p.taskTitle}` : `Task: ${p.taskTitle}`] : []),
          ar ? `رصيدك الآن: ${p.newTotal} نقطة.` : `New total: ${p.newTotal} points.`,
        ],
      };
    case 'warning_issued':
      return {
        subject: ar ? 'تنبيه بخصوص التزامك' : 'A note about your conduct',
        preheader: ar ? 'السبب والدرجة مسجلان.' : 'Severity and reason are on the record.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar
            ? `سجّل ${p.issuerName} ${sevAr(p.severity)}${p.severity === 'notice' ? '' : ' بحقك'}. السبب: ${p.reason}.`
            : `${p.issuerName} recorded a ${p.severity} warning. Reason: ${p.reason}.`,
          ...(p.evidenceUrl ? [ar ? `المستند: ${p.evidenceUrl}` : `Reference: ${p.evidenceUrl}`] : []),
          ar
            ? 'إذا كنت ترى أن هذا غير صحيح، يمكنك فتح طلب مراجعة من لوحة الأعضاء.'
            : 'If you believe this is incorrect, you can open a review request from your workspace.',
        ],
      };
    case 'warning_escalated':
      return {
        subject: ar ? 'تصعيد: تراكم إنذارات' : 'Escalation: warnings have accumulated',
        preheader: ar ? 'عدد الإنذارات تجاوز الحد المتفق عليه.' : 'The configured threshold was reached.',
        greeting: ar ? `${p.recipientName}،` : `Hello ${p.recipientName},`,
        lines: [
          ar
            ? `وصل ${p.memberName} إلى ${p.count} إنذارات خلال ${p.windowDays} يومًا، وهو الحد الذي يستدعي تدخلك.`
            : `${p.memberName} has ${p.count} warnings within ${p.windowDays} days, which is the point this chapter agreed you should see.`,
        ],
      };
    case 'deadline_reminder':
      return {
        subject: ar ? `تذكير بموعد: ${p.taskTitle}` : `Deadline approaching: ${p.taskTitle}`,
        preheader: ar ? 'الوقت المتبقي محسوب من التاريخ المسجل.' : 'Remaining time is counted from the recorded date.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          p.daysRemaining < 0
            ? ar
              ? `«${p.taskTitle}» كان تسليمها ${p.deadline} — تجاوزت الموعد بـ ${Math.abs(p.daysRemaining)} يومًا.`
              : `"${p.taskTitle}" was due ${p.deadline} — it is ${Math.abs(p.daysRemaining)} day(s) past the deadline.`
            : ar
              ? `«${p.taskTitle}» تسليمها ${p.deadline} — باقي ${p.daysRemaining} يومًا.`
              : `"${p.taskTitle}" is due ${p.deadline} — ${p.daysRemaining} day(s) left.`,
        ],
        cta: ar ? 'فتح المهمة' : 'Open the task',
      };
    case 'submission_revision_requested':
      return {
        subject: ar ? 'مطلوب مراجعة عملك' : 'Revision requested on your submission',
        preheader: ar ? 'الملاحظات من المراجع.' : 'The reviewer left notes.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar
            ? `طلب المراجع مراجعة على «${p.taskTitle}». الملاحظات: ${p.feedback}`
            : `The reviewer asked for changes on "${p.taskTitle}". Notes: ${p.feedback}`,
        ],
        cta: ar ? 'رفع المراجعة' : 'Upload the revision',
      };
    case 'submission_approved':
      return {
        subject: ar ? 'تم اعتماد عملك' : 'Your submission was approved',
        preheader: ar ? 'النقاط مضافة من السجل.' : 'Points come from the ledger, not a message.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar
            ? `تم اعتماد «${p.taskTitle}» وإضافة ${p.points} نقطة. رصيدك: ${p.newTotal}.`
            : `"${p.taskTitle}" was approved and ${p.points} points were added. New total: ${p.newTotal}.`,
        ],
      };
    case 'submission_rejected':
      return {
        subject: ar ? 'لم يتم اعتماد عملك' : 'Your submission was not approved',
        preheader: ar ? 'السبب مسجل مع القرار.' : 'The reason sits with the decision.',
        greeting: ar ? `${p.fullName}،` : `Hello ${p.fullName},`,
        lines: [
          ar ? `لم يتم اعتماد «${p.taskTitle}». السبب: ${p.reason}` : `"${p.taskTitle}" was not approved. Reason: ${p.reason}`,
        ],
      };
  }
}

function actionHrefFor(p: EmailPayload, override?: string): string | null {
  if (override) return safeUrl(override);
  if (p.event === 'account_approved') return safeUrl(p.loginUrl);
  if (p.event === 'account_rejected') return safeUrl(p.reapplyUrl);
  if (p.event === 'login_security_alert') return safeUrl(p.wasNotYouUrl);
  if (p.event === 'task_assigned' || p.event === 'task_assigned_to_team') return safeUrl(p.taskUrl);
  if (p.event === 'deadline_reminder') return safeUrl(p.taskUrl);
  if (p.event === 'submission_revision_requested') return safeUrl(p.taskUrl);
  return null;
}

/**
 * Renders one message. The recipient, the template and its fields travel together, so a caller
 * cannot pair an address with a body the record does not support.
 */
export function renderEmail(input: {
  payload: EmailPayload;
  to: string;
  locale: EmailLocale;
  /** Overrides the template's own link — used when the app knows a deeper URL than the payload. */
  actionUrl?: string;
}): RenderedEmail {
  const { payload, to, locale } = input;
  const ar = locale === 'ar';
  const copy = copyFor(payload, ar);
  const ctaHref = actionHrefFor(payload, input.actionUrl);

  const html = [
    `<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">`,
    `<body style="margin:0;padding:0;background:#f1f5f9;font-family:${ar ? "'Segoe UI', Tahoma, Arial" : "'Segoe UI', Arial"},sans-serif;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">`,
    `<tr><td align="center">`,
    `<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">`,
    `<tr><td style="background:${NAVY};padding:18px 24px;">`,
    `<span style="color:#ffffff;font-size:14px;font-weight:700;letter-spacing:.4px;">ESME CU</span>`,
    `<span style="color:${ORANGE};font-size:12px;font-weight:700;display:block;">${ar ? 'شعبة طلاب كلية الهندسة — جامعة القاهرة' : 'Engineering Students of Cairo University'}</span>`,
    `</td></tr>`,
    `<tr><td style="padding:24px;color:#0f172a;font-size:14px;line-height:1.7;">`,
    `<p style="margin:0 0 12px;font-weight:700;">${escapeHtml(copy.greeting)}</p>`,
    copy.lines.map((line) => `<p style="margin:0 0 10px;">${escapeHtml(line)}</p>`).join(''),
    ctaHref && copy.cta
      ? `<p style="margin:18px 0 4px;"><a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:${ORANGE};color:#0f172a;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:10px;">${escapeHtml(copy.cta)}</a></p>`
      : '',
    `</td></tr>`,
    `<tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:11px;border-top:1px solid #e2e8f0;">`,
    `<p style="margin:0;">${ar ? 'رسالة آلية من نظام أعضاء ESME CU. لا ترسل كلمة مرورك لأي شخص.' : 'Automated message from the ESME CU member system. Never send your password to anyone.'}</p>`,
    `</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join('');

  const text = [
    `ESME CU — ${ar ? 'شعبة طلاب كلية الهندسة جامعة القاهرة' : 'Engineering Students of Cairo University'}`,
    '',
    copy.greeting,
    '',
    ...copy.lines,
    ctaHref && copy.cta ? `${copy.cta}: ${ctaHref}` : '',
    '',
    ar
      ? 'رسالة آلية من نظام أعضاء ESME CU. لا ترسل كلمة مرورك لأي شخص.'
      : 'Automated message from the ESME CU member system. Never send your password to anyone.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { event: payload.event, locale, to, subject: copy.subject, preheader: copy.preheader, html, text };
}
