/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  User,
  StudentProfile,
  TeacherProfile,
  Course,
  ClassEntity,
  SessionEntity,
  Payment,
  Subscription,
  DashboardStats,
  AutomatedTestCaseResult,
  AuditLog,
  IntegrationSetting,
  NotificationEntity,
  ActiveSession,
  UploadCategory,
  UploadedFileMetadata,
  Tenant,
  TenantPublicSummary,
  TenantSubscription,
  SuperAdminOverviewStats,
  SuperAdminTenantSummary,
  TenantPlanCode,
  TenantSubscriptionStatus,
  TenantStatus,
  PaymentMethod,
  SupportedLanguage,
  ChargilyCheckout,
  ChargilyCardMethod,
  InstallmentPlan,
  PaymentReminder,
  Invoice,
  EmailTemplateType,
  NotificationCategory,
  UserNotificationPreferences,
  EmailQueueItem,
  EmailQueueStats,
  EmailQueueStatus,
} from '../types/index.js';

// Session tokens live exclusively in HttpOnly + Secure + SameSite=Strict cookies.
// Only the anti-CSRF synchronizer token and optional X-Tenant-Id selector (for public discovery
// or SUPER_ADMIN governance inspection) are held in memory.
let inMemoryCsrfToken: string | null = null;
let inMemoryTenantOverrideId: string | null = null;

export function getCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export function setCsrfToken(token: string | null | undefined): void {
  inMemoryCsrfToken = token || null;
}

export function clearCsrfToken(): void {
  inMemoryCsrfToken = null;
}

export function getActiveTenantHeader(): string | null {
  return inMemoryTenantOverrideId;
}

export function setActiveTenantHeader(tenantId: string | null | undefined): void {
  inMemoryTenantOverrideId = tenantId || null;
}

function isDevCrossOriginIframe(): boolean {
  try {
    return Boolean(
      import.meta.env.DEV && typeof window !== 'undefined' && window.self !== window.top
    );
  } catch {
    return true;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (isDevCrossOriginIframe()) {
    headers.set('X-Aistudio-Iframe', '1');
  }

  if (inMemoryTenantOverrideId && !headers.has('X-Tenant-Id')) {
    headers.set('X-Tenant-Id', inMemoryTenantOverrideId);
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && inMemoryCsrfToken) {
    headers.set('X-CSRF-Token', inMemoryCsrfToken);
  }

  const response = await fetch(`/api${endpoint}`, {
    ...options,
    method,
    headers,
    credentials: 'include',
  });

  // Automatically synchronize CSRF token upon login or automatic/explicit session rotation
  const rotatedCsrf = response.headers.get('X-CSRF-Token');
  if (rotatedCsrf) {
    inMemoryCsrfToken = rotatedCsrf;
  }

  if (response.status === 401) {
    const errorData = await response.json().catch(() => ({}));
    if (
      errorData.code === 'NOUVELLE_CONNEXION_AUTRE_APPAREIL' ||
      errorData.error === 'SESSION_REVOKED'
    ) {
      window.dispatchEvent(
        new CustomEvent('session-revoked-duplicate-login', { detail: errorData })
      );
    }
    throw new Error(errorData.message || 'Session expirée ou non autorisée.');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Erreur serveur (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  // Public Multi-Tenant Discovery
  getPublicTenants: () => request<{ tenants: TenantPublicSummary[] }>('/tenants/public'),

  getCurrentTenant: (params?: { tenantId?: string; slug?: string }) => {
    const query = new URLSearchParams();
    if (params?.tenantId) query.set('tenantId', params.tenantId);
    if (params?.slug) query.set('slug', params.slug);
    const qs = query.toString();
    return request<{ tenant: TenantPublicSummary }>(`/tenants/current${qs ? `?${qs}` : ''}`);
  },

  // School ADMIN Establishment Branding & Settings
  getTenantSettings: () =>
    request<{
      tenant: Tenant;
      usage: {
        studentsCount: number;
        maxStudents: number;
        teachersCount: number;
        maxTeachers: number;
        coursesCount: number;
      };
      contracts: TenantSubscription[];
    }>('/tenant/settings'),

  updateTenantSettings: (data: {
    name?: string;
    shortName?: string;
    tagline?: string;
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
    city?: string;
    wilaya?: string;
    website?: string;
    accreditationNumber?: string;
    taxId?: string;
    nif?: string;
    nis?: string;
    rc?: string;
    articleImposition?: string;
    tvaApplicable?: boolean;
    tvaRatePercent?: number;
    invoicePrefix?: string;
    invoiceFooterNote?: string;
    settings?: {
      receiptPrefix?: string;
      receiptFooterNote?: string;
      supportHours?: string;
      enforceSingleStudentSession?: boolean;
      allowManualPayments?: boolean;
      allowInstallments?: boolean;
      autoRemindersEnabled?: boolean;
      reminderDaysBeforeDue?: number;
      reminderDaysAfterOverdue?: number;
      reminderFinalDaysAfterOverdue?: number;
    };
  }) =>
    request<{
      success: boolean;
      tenant: Tenant;
      publicSummary: TenantPublicSummary;
      message: string;
    }>('/tenant/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // SUPER_ADMIN SaaS Governance
  getSuperAdminOverview: () =>
    request<{
      stats: SuperAdminOverviewStats;
      tenants: SuperAdminTenantSummary[];
      contracts: TenantSubscription[];
    }>('/super-admin/overview'),

  createSuperAdminTenant: (data: {
    name: string;
    slug: string;
    shortName: string;
    tagline?: string;
    logoUrl?: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    contactEmail: string;
    contactPhone: string;
    address: string;
    city: string;
    wilaya: string;
    website?: string;
    accreditationNumber?: string;
    taxId?: string;
    receiptPrefix?: string;
    subscriptionPlan: TenantPlanCode;
    billingCycle: 'MONTHLY' | 'ANNUAL';
    monthlyFeeDzd?: number;
    maxStudents?: number;
    maxTeachers?: number;
    subscriptionEndDate?: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  }) =>
    request<{
      success: boolean;
      tenant: Tenant;
      contract: TenantSubscription;
      adminUser: User;
      message: string;
    }>('/super-admin/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSuperAdminTenant: (
    id: string,
    data: {
      name?: string;
      shortName?: string;
      tagline?: string;
      logoUrl?: string;
      primaryColor?: string;
      secondaryColor?: string;
      accentColor?: string;
      contactEmail?: string;
      contactPhone?: string;
      address?: string;
      city?: string;
      wilaya?: string;
      accreditationNumber?: string;
      taxId?: string;
      subscriptionPlan?: TenantPlanCode;
      subscriptionStatus?: TenantSubscriptionStatus;
      subscriptionEndDate?: string;
      monthlyFeeDzd?: number;
      billingNotes?: string;
      status?: TenantStatus;
      maxStudents?: number;
      maxTeachers?: number;
    }
  ) =>
    request<{ success: boolean; tenant: Tenant; message: string }>(`/super-admin/tenants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  createTenantSubscription: (
    tenantId: string,
    data: {
      planCode: TenantPlanCode;
      billingCycle: 'MONTHLY' | 'ANNUAL';
      amountDzd: number;
      maxStudents?: number;
      maxTeachers?: number;
      startDate?: string;
      endDate: string;
      paymentMethod: PaymentMethod;
      notes?: string;
    }
  ) =>
    request<{
      success: boolean;
      contract: TenantSubscription;
      tenant: Tenant;
      message: string;
    }>(`/super-admin/tenants/${tenantId}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Auth & Security
  getCsrf: () => request<{ csrfToken: string }>('/auth/csrf'),

  login: (
    email: string,
    password: string,
    expectedRole?: 'SUPER_ADMIN' | 'ADMIN' | 'TEACHER' | 'STUDENT'
  ) =>
    request<{
      user: User;
      tenant?: TenantPublicSummary;
      fullTenant?: Tenant;
      csrfToken: string;
      session: ActiveSession;
      studentProfile?: StudentProfile;
      teacherProfile?: TeacherProfile;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, expectedRole }),
    }),

  firebaseLogin: (idToken: string) =>
    request<{
      user: User;
      tenant?: TenantPublicSummary;
      fullTenant?: Tenant;
      csrfToken: string;
      session: ActiveSession;
      studentProfile?: StudentProfile;
      teacherProfile?: TeacherProfile;
    }>('/auth/firebase-login', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ idToken }),
    }),

  rotateSession: () =>
    request<{ success: boolean; csrfToken: string; session: ActiveSession }>(
      '/auth/rotate-session',
      { method: 'POST' }
    ),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean; csrfToken?: string; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  forgotPassword: (email: string) =>
    request<{
      success: boolean;
      message: string;
      isEmailConfigured: boolean;
      notice?: string;
      testToken?: string;
    }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    request<{ success: boolean; message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  getMe: () =>
    request<{
      user: User;
      tenant?: TenantPublicSummary;
      fullTenant?: Tenant;
      csrfToken?: string;
      studentProfile?: StudentProfile;
      teacherProfile?: TeacherProfile;
      activeSubscription?: Subscription;
      currentSession?: ActiveSession;
    }>('/auth/me'),

  updatePreferences: (preferredLanguage: SupportedLanguage) =>
    request<{
      success: boolean;
      preferredLanguage: SupportedLanguage;
      user: User;
    }>('/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ preferredLanguage }),
    }),

  getSessions: () => request<{ sessions: ActiveSession[] }>('/auth/sessions'),

  revokeSession: (id: string) =>
    request<{ success: boolean }>(`/auth/sessions/${id}/revoke`, { method: 'POST' }),

  demoSwitch: (targetRole?: string, userId?: string, tenantId?: string) =>
    request<{
      user: User;
      tenant?: TenantPublicSummary;
      fullTenant?: Tenant;
      csrfToken: string;
      session: ActiveSession;
      studentProfile?: StudentProfile;
      teacherProfile?: TeacherProfile;
    }>('/auth/demo-switch', {
      method: 'POST',
      body: JSON.stringify({ targetRole, userId, tenantId }),
    }),

  // Students
  getStudents: (params: { query?: string; classId?: string; status?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.query) query.set('query', params.query);
    if (params.classId) query.set('classId', params.classId);
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    return request<{ students: any[] }>(`/students${qs ? `?${qs}` : ''}`);
  },

  createStudent: (data: any) =>
    request<{ success: boolean; student: User; profile: StudentProfile }>('/students', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateStudentStatus: (id: string, status: string, administrativeNotes?: string) =>
    request<{ success: boolean; user: User }>(`/students/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, administrativeNotes }),
    }),

  importStudentsCsv: (csvText: string, dryRun: boolean = false) =>
    request<{
      success?: boolean;
      dryRun?: boolean;
      createdCount?: number;
      duplicatesCount?: number;
      formulaNeutralizedCount?: number;
      validCount?: number;
      totalRows?: number;
      errors: string[];
      preview?: any[];
    }>('/students/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csvText, dryRun }),
    }),

  exportCsv: async (type: 'students' | 'payments') => {
    const headers = new Headers();
    if (isDevCrossOriginIframe()) {
      headers.set('X-Aistudio-Iframe', '1');
    }
    if (inMemoryTenantOverrideId) {
      headers.set('X-Tenant-Id', inMemoryTenantOverrideId);
    }
    const endpoint = type === 'students' ? '/api/students/export-csv' : '/api/payments/export-csv';
    const filename =
      type === 'students' ? 'etudiants_etablissement.csv' : 'paiements_etablissement.csv';
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Export CSV refusé (${response.status})`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },

  // Classes & Courses
  getClasses: () => request<{ classes: any[] }>('/classes'),

  createClass: (data: any) =>
    request<{ success: boolean; class: ClassEntity }>('/classes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getCourses: () => request<{ courses: Course[] }>('/courses'),

  getCourse: (id: string) => request<{ course: Course; modules: any[] }>(`/courses/${id}`),

  // Sessions & Videoconference
  getSessionsList: (params: { classId?: string; teacherId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.classId) query.set('classId', params.classId);
    if (params.teacherId) query.set('teacherId', params.teacherId);
    const qs = query.toString();
    return request<{ sessions: SessionEntity[] }>(`/sessions${qs ? `?${qs}` : ''}`);
  },

  createSession: (data: any) =>
    request<{ success: boolean; session: SessionEntity; zoomNotice?: string }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSession: (id: string, data: any) =>
    request<{ success: boolean; session: SessionEntity }>(`/sessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  joinSessionProtected: (sessionId: string) =>
    request<{
      canJoin: boolean;
      role: string;
      videoJoinUrl: string;
      videoProvider: string;
      videoMeetingId: string;
      videoPasscode?: string;
      subscriptionValidUntil?: string;
      error?: string;
      reason?: string;
    }>(`/sessions/${sessionId}/join`),

  // Attendance
  getSessionAttendance: (sessionId: string) =>
    request<{ session: SessionEntity; roster: any[] }>(`/attendance/session/${sessionId}`),

  saveSessionAttendance: (sessionId: string, entries: any[]) =>
    request<{ success: boolean; message: string }>(`/attendance/session/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }),

  getMyAttendance: () =>
    request<{
      records: any[];
      attendanceRate: number;
      totalSessions: number;
      presentCount: number;
    }>('/attendance/my-records'),

  // Payments & Subscriptions
  getPayments: () => request<{ payments: Payment[] }>('/payments'),

  createPayment: (data: any) =>
    request<{ success: boolean; payment: Payment }>('/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  confirmPayment: (paymentId: string, administrativeNotes?: string) =>
    request<{ success: boolean; payment: Payment; message: string }>(
      `/payments/${paymentId}/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ administrativeNotes }),
      }
    ),

  refundPayment: (paymentId: string, data: { reason: string; amountDzd?: number }) =>
    request<{
      success: boolean;
      payment: Payment;
      invoice?: Invoice | null;
      message: string;
    }>(`/payments/${paymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  createChargilyCheckout: (data: {
    courseId: string;
    cardMethod: ChargilyCardMethod;
    installmentItemId?: string;
    installmentsCount?: number;
    idempotencyKey?: string;
    locale?: SupportedLanguage;
  }) =>
    request<{
      success: boolean;
      checkout: ChargilyCheckout;
      payment: Payment;
      installmentPlan?: InstallmentPlan | null;
      reusedIdempotent: boolean;
    }>('/payments/chargily/checkout', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  simulateChargilySandbox: (
    checkoutId: string,
    data: {
      outcome: 'paid' | 'failed' | 'canceled' | 'expired';
      eventIdOverride?: string;
      failureReason?: string;
    }
  ) =>
    request<{
      handled: boolean;
      duplicate?: boolean;
      statusCode: number;
      eventId?: string;
      eventType?: string;
      checkoutId?: string;
      paymentId?: string;
      paymentStatus?: string;
      invoiceNumber?: string;
      message: string;
    }>(`/payments/chargily/sandbox/${checkoutId}/simulate`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getInstallments: (studentId?: string) => {
    const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
    return request<{ plans: InstallmentPlan[] }>(`/installments${qs}`);
  },

  createInstallmentPlan: (data: {
    studentId?: string;
    courseId: string;
    totalAmountDzd?: number;
    installmentsCount: number;
    intervalDays?: number;
    firstDueDate?: string;
    title?: string;
    notes?: string;
  }) =>
    request<{ success: boolean; plan: InstallmentPlan }>('/installments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getPaymentReminders: (studentId?: string) => {
    const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
    return request<{ reminders: PaymentReminder[] }>(`/installments/reminders${qs}`);
  },

  runAutomatedReminders: (referenceDateYmd?: string) =>
    request<{
      success: boolean;
      tenantId: string;
      evaluatedCount: number;
      markedOverdueCount: number;
      sentCount: number;
      skippedAlreadySentCount: number;
      reminders: PaymentReminder[];
    }>('/installments/run-reminders', {
      method: 'POST',
      body: JSON.stringify(referenceDateYmd ? { referenceDateYmd } : {}),
    }),

  getInvoices: (studentId?: string) => {
    const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
    return request<{ invoices: Invoice[] }>(`/invoices${qs}`);
  },

  getInvoiceById: (id: string) => request<{ invoice: Invoice }>(`/invoices/${id}`),

  downloadInvoicePdf: async (id: string, fallbackFilename: string = 'facture.pdf') => {
    const headers = new Headers();
    if (isDevCrossOriginIframe()) {
      headers.set('X-Aistudio-Iframe', '1');
    }
    if (inMemoryTenantOverrideId) {
      headers.set('X-Tenant-Id', inMemoryTenantOverrideId);
    }
    const response = await fetch(`/api/invoices/${id}/pdf`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Téléchargement PDF refusé (${response.status})`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fallbackFilename.endsWith('.pdf') ? fallbackFilename : `${fallbackFilename}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },

  getSubscriptions: () => request<{ subscriptions: Subscription[] }>('/subscriptions'),

  // Dashboard & Settings
  getDashboardStats: () => request<DashboardStats>('/dashboard/stats'),

  getAuditLogs: () => request<{ logs: AuditLog[] }>('/audit-logs'),

  getIntegrations: () => request<{ integrations: IntegrationSetting[] }>('/settings/integrations'),

  updateIntegration: (provider: string, data: any) =>
    request<{ success: boolean; setting: IntegrationSetting }>(
      `/settings/integrations/${provider}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    ),

  // Test Suite
  runTestSuite: () =>
    request<{
      success: boolean;
      totalPassed: number;
      totalTests: number;
      durationMs: number;
      results: AutomatedTestCaseResult[];
    }>('/test-suite/run', { method: 'POST' }),

  resetDemo: () => request<{ success: boolean; message: string }>('/reset-demo', { method: 'POST' }),

  getNotifications: (
    params: { unreadOnly?: boolean; category?: 'ALL' | NotificationCategory; limit?: number } = {}
  ) => {
    const query = new URLSearchParams();
    if (typeof params.unreadOnly === 'boolean') query.set('unreadOnly', String(params.unreadOnly));
    if (params.category) query.set('category', params.category);
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<{ notifications: NotificationEntity[]; unreadCount: number }>(
      `/notifications${qs ? `?${qs}` : ''}`
    );
  },

  markNotificationRead: (id: string) =>
    request<{ success: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' }),

  markAllNotificationsRead: () =>
    request<{ success: boolean; updatedCount: number }>('/notifications/read-all', {
      method: 'POST',
    }),

  deleteNotification: (id: string) =>
    request<{ success: boolean }>(`/notifications/${id}`, { method: 'DELETE' }),

  getNotificationPreferences: () =>
    request<{ preferences: UserNotificationPreferences }>('/notifications/preferences'),

  updateNotificationPreferences: (
    patch: Partial<
      Omit<UserNotificationPreferences, 'userId' | 'tenantId' | 'emailPasswordReset' | 'updatedAt'>
    >
  ) =>
    request<{ success: boolean; preferences: UserNotificationPreferences }>(
      '/notifications/preferences',
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      }
    ),

  // Admin Transactional Email Outbox Queue & SMTP Tester
  getEmailQueue: (
    params: {
      status?: 'ALL' | EmailQueueStatus;
      templateType?: 'ALL' | EmailTemplateType;
      limit?: number;
    } = {}
  ) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.templateType) query.set('templateType', params.templateType);
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<{
      items: EmailQueueItem[];
      stats: EmailQueueStats;
      smtpStatus: {
        isEnabled: boolean;
        isTestMode: boolean;
        hasLiveSmtpTransport: boolean;
        host: string;
        port: number;
        secure: boolean;
        fromName: string;
        fromEmail: string;
      };
    }>(`/emails/queue${qs ? `?${qs}` : ''}`);
  },

  getEmailQueueItem: (id: string) => request<{ item: EmailQueueItem }>(`/emails/queue/${id}`),

  processEmailQueue: (data: { limit?: number; forceDueNow?: boolean } = {}) =>
    request<{
      success: boolean;
      evaluatedCount: number;
      sentCount: number;
      retryScheduledCount: number;
      failedPermanentlyCount: number;
      processedItems: EmailQueueItem[];
    }>('/emails/queue/process', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  retryEmailQueueItem: (id: string) =>
    request<{
      success: boolean;
      item: EmailQueueItem;
    }>(`/emails/queue/${id}/retry`, {
      method: 'POST',
    }),

  runEmailSweeps: (
    data: { referenceDateYmd?: string; referenceTimeIso?: string; windowHours?: number } = {}
  ) =>
    request<{
      success: boolean;
      subscriptionsSweep: {
        evaluatedSubscriptions: number;
        expiringSoonMatched: number;
        emailsQueued: number;
        inAppCreated: number;
      };
      sessionsSweep: {
        evaluatedSessions: number;
        upcomingSessionsMatched: number;
        emailsQueued: number;
        inAppCreated: number;
      };
    }>('/emails/run-sweeps', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  sendTestEmailTemplate: (data: {
    templateType: EmailTemplateType;
    locale: 'fr' | 'ar';
    recipientEmail?: string;
    simulateTransientFailuresCount?: number;
  }) =>
    request<{
      success: boolean;
      item?: EmailQueueItem;
    }>('/emails/test-template', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Ownership-checked single-resource endpoints
  getStudentById: (id: string) =>
    request<{ student: User; profile: StudentProfile | null }>(`/students/${id}`),

  getPaymentById: (id: string) => request<{ payment: Payment }>(`/payments/${id}`),

  accessLesson: (courseId: string, lessonId: string) =>
    request<{
      canAccess: boolean;
      lesson: { id: string; title: string; type: string; url: string; recordingUrl?: string };
    }>(`/courses/${courseId}/lessons/${lessonId}/access`),

  // Secure Private File Uploads (PDF, PNG, JPEG, WEBP <= 5 MB)
  uploadFile: (params: {
    file: File;
    category: UploadCategory;
    courseId?: string;
    paymentId?: string;
    description?: string;
  }) => {
    const formData = new FormData();
    formData.append('file', params.file);
    formData.append('category', params.category);
    if (params.courseId) formData.append('courseId', params.courseId);
    if (params.paymentId) formData.append('paymentId', params.paymentId);
    if (params.description) formData.append('description', params.description);
    return request<{ success: boolean; file: UploadedFileMetadata }>('/uploads', {
      method: 'POST',
      body: formData,
    });
  },

  getUploads: (params: { category?: UploadCategory; courseId?: string; paymentId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.category) query.set('category', params.category);
    if (params.courseId) query.set('courseId', params.courseId);
    if (params.paymentId) query.set('paymentId', params.paymentId);
    const qs = query.toString();
    return request<{ files: UploadedFileMetadata[] }>(`/uploads${qs ? `?${qs}` : ''}`);
  },

  downloadUpload: async (id: string, fallbackFilename: string = 'document') => {
    const headers = new Headers();
    if (isDevCrossOriginIframe()) {
      headers.set('X-Aistudio-Iframe', '1');
    }
    if (inMemoryTenantOverrideId) {
      headers.set('X-Tenant-Id', inMemoryTenantOverrideId);
    }
    const response = await fetch(`/api/uploads/${id}/download`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Téléchargement refusé (${response.status})`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fallbackFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  },

  deleteUpload: (id: string) =>
    request<{ success: boolean; message: string }>(`/uploads/${id}`, { method: 'DELETE' }),
};
