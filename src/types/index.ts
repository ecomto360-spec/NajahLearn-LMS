/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'TEACHER' | 'STUDENT';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type SupportedLanguage = 'fr' | 'ar';

export type TenantPlanCode = 'STARTER' | 'PRO' | 'ENTERPRISE';
export type TenantSubscriptionStatus = 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface TenantSettings {
  currency: 'DZD' | 'EUR' | 'USD';
  timezone: string;
  locale: string;
  receiptPrefix: string;
  receiptFooterNote: string;
  enforceSingleStudentSession: boolean;
  allowManualPayments: boolean;
  allowInstallments?: boolean;
  autoRemindersEnabled?: boolean;
  reminderDaysBeforeDue?: number;
  reminderDaysAfterOverdue?: number;
  reminderFinalDaysAfterOverdue?: number;
  maxStudents: number;
  maxTeachers: number;
  supportHours: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  city: string;
  wilaya: string;
  country: string;
  website?: string;
  accreditationNumber?: string;
  taxId?: string;
  nif?: string;
  nis?: string;
  rc?: string;
  articleImposition?: string;
  tvaApplicable: boolean;
  tvaRatePercent: number;
  invoicePrefix: string;
  invoiceNextSequence: number;
  invoiceFooterNote?: string;
  settings: TenantSettings;
  subscriptionPlan: TenantPlanCode;
  subscriptionStatus: TenantSubscriptionStatus;
  subscriptionStartDate: string;
  subscriptionEndDate: string;
  monthlyFeeDzd: number;
  billingNotes?: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenantPublicSummary {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  city: string;
  wilaya: string;
  country: string;
  website?: string;
  accreditationNumber?: string;
  nif?: string;
  nis?: string;
  rc?: string;
  articleImposition?: string;
  tvaApplicable?: boolean;
  tvaRatePercent?: number;
  invoicePrefix?: string;
  supportHours: string;
  currency: 'DZD' | 'EUR' | 'USD';
  allowInstallments?: boolean;
  status: TenantStatus;
  subscriptionStatus: TenantSubscriptionStatus;
}

export interface TenantSubscription {
  id: string;
  tenantId: string;
  tenantName?: string;
  planCode: TenantPlanCode;
  billingCycle: 'MONTHLY' | 'ANNUAL';
  status: TenantSubscriptionStatus;
  amountDzd: number;
  maxStudents: number;
  maxTeachers: number;
  startDate: string;
  endDate: string;
  invoiceNumber: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuperAdminTenantSummary extends Tenant {
  studentsCount: number;
  teachersCount: number;
  coursesCount: number;
  collectedRevenueDzd: number;
  adminEmail?: string;
  adminName?: string;
  latestContract?: TenantSubscription | null;
}

export interface SuperAdminOverviewStats {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  mrrDzd: number;
  arrDzd: number;
  totalB2bBilledDzd: number;
  totalStudentsAcrossTenants: number;
  totalTeachersAcrossTenants: number;
  totalStudentRevenueAcrossTenantsDzd: number;
  expiringSoonCount: number;
}

export interface User {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  phone?: string;
  avatar?: string;
  preferredLanguage?: SupportedLanguage;
  createdAt: string;
  updatedAt: string;
  passwordHash?: string;
}

export interface StudentProfile {
  id: string;
  tenantId: string;
  userId: string;
  studentIdNumber: string; // Ex: ETU-2026-001
  city: string;
  wilaya: string; // Algérie: Alger, Oran, Constantine, etc.
  academicLevel: string;
  administrativeNotes?: string;
  currentClassId?: string;
}

export interface TeacherProfile {
  id: string;
  tenantId: string;
  userId: string;
  employeeId: string;
  specialty: string;
  bio?: string;
  zoomPersonalMeetingId?: string;
  assignedClassIds: string[];
}

export interface Course {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  code: string;
  description: string;
  coverImage: string;
  durationHours: number;
  priceDzd: number; // En Dinars Algériens (DZD)
  status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
  modulesCount?: number;
  createdAt: string;
}

export interface CourseModule {
  id: string;
  tenantId?: string;
  courseId: string;
  title: string;
  orderIndex: number;
  description: string;
  durationHours: number;
  lessons: LessonResource[];
}

export interface LessonResource {
  id: string;
  tenantId?: string;
  moduleId: string;
  title: string;
  type: 'VIDEO' | 'PDF' | 'EXERCISE' | 'CODE';
  durationMinutes?: number;
  url: string;
  isProtected: boolean;
  recordingUrl?: string;
}

export interface ClassEntity {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  courseId: string;
  teacherId: string;
  capacity: number;
  enrolledCount: number;
  startDate: string;
  endDate: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Enrollment {
  id: string;
  tenantId: string;
  studentId: string;
  classId: string;
  courseId: string;
  enrolledAt: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

export type SessionStatus = 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED';
export type VideoProvider = 'ZOOM' | 'JITSI' | 'CUSTOM';

export interface SessionEntity {
  id: string;
  tenantId: string;
  courseId: string;
  classId: string;
  teacherId: string;
  title: string;
  description?: string;
  scheduledAt: string; // ISO String (Africa/Algiers)
  durationMinutes: number;
  videoProvider: VideoProvider;
  videoMeetingId: string;
  videoJoinUrl: string;
  videoPasscode?: string;
  status: SessionStatus;
  recordingUrl?: string;
  notes?: string;
  createdAt: string;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  minutesLate?: number;
  teacherComment?: string;
  markedBy: string;
  markedAt: string;
  updatedAt: string;
}

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'PENDING';

export interface SubscriptionPlan {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  durationMonths: number;
  priceDzd: number;
  description: string;
  includesLiveSessions: boolean;
  includesRecordings: boolean;
}

export interface Subscription {
  id: string;
  tenantId: string;
  studentId: string;
  courseId: string;
  planId: string;
  startDate: string; // AAAA-MM-JJ
  endDate: string; // AAAA-MM-JJ
  status: SubscriptionStatus;
  paymentId?: string;
  notes?: string;
  createdAt: string;
}

export type PaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'BARIDIMOB_CCP'
  | 'CHEQUE'
  | 'ONLINE_CARD'
  | 'CHARGILY_EDAHABIA'
  | 'CHARGILY_CIB';
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REJECTED' | 'REFUNDED';

export interface Payment {
  id: string;
  tenantId: string;
  receiptNumber: string; // Ex: REC-2026-0042
  studentId: string;
  courseId: string;
  subscriptionId?: string;
  installmentItemId?: string;
  chargilyCheckoutId?: string;
  idempotencyKey?: string;
  amountDzd: number;
  currency: 'DZD' | 'EUR' | 'USD';
  paymentMethod: PaymentMethod;
  transactionReference: string; // Numéro chèque / bordereau CCP BaridiMob / réf virement / Chargily ID
  paymentDate: string;
  status: PaymentStatus;
  failureReason?: string;
  receiptAttachment?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  refundedAmountDzd?: number;
  refundReason?: string;
  refundedBy?: string;
  refundedAt?: string;
  administrativeNotes?: string;
  createdAt: string;
  invoiceId?: string;
  invoiceNumber?: string;
  tenant?: TenantPublicSummary | Tenant;
}

export type ChargilyCardMethod = 'edahabia' | 'cib';
export type ChargilyCheckoutStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'REFUNDED';

export interface ChargilyCheckout {
  id: string;
  tenantId: string;
  paymentId: string;
  studentId: string;
  courseId: string;
  installmentItemId?: string;
  amountDzd: number;
  currency: 'dzd';
  cardMethod: ChargilyCardMethod;
  mode: 'test' | 'live';
  status: ChargilyCheckoutStatus;
  checkoutUrl: string;
  isLiveApi?: boolean;
  idempotencyKey?: string;
  failureReason?: string;
  metadata: Record<string, any>;
  paidAt?: string;
  failedAt?: string;
  refundedAt?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export type InstallmentPlanStatus = 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED';
export type InstallmentItemStatus = 'PENDING' | 'OVERDUE' | 'PAID' | 'REFUNDED' | 'CANCELLED';

export interface InstallmentItem {
  id: string;
  tenantId: string;
  planId: string;
  studentId: string;
  courseId: string;
  installmentNumber: number;
  totalInstallments: number;
  amountDzd: number;
  dueDate: string;
  status: InstallmentItemStatus;
  paymentId?: string;
  paidAt?: string;
  reminderCount: number;
  lastReminderType?: string;
  lastReminderAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstallmentPlan {
  id: string;
  tenantId: string;
  studentId: string;
  studentName?: string;
  studentEmail?: string;
  courseId: string;
  courseTitle?: string;
  subscriptionId?: string;
  title: string;
  totalAmountDzd: number;
  paidAmountDzd: number;
  remainingAmountDzd: number;
  installmentsCount: number;
  intervalDays: number;
  status: InstallmentPlanStatus;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  items: InstallmentItem[];
}

export type PaymentReminderType =
  | 'UPCOMING_DUE'
  | 'DUE_TODAY'
  | 'OVERDUE_REMINDER'
  | 'OVERDUE_FINAL'
  | 'MANUAL_REMINDER';

export interface PaymentReminder {
  id: string;
  tenantId: string;
  studentId: string;
  studentName?: string;
  planId: string;
  installmentItemId: string;
  reminderType: PaymentReminderType;
  channel: string;
  amountDzd: number;
  dueDate: string;
  subject: string;
  message: string;
  triggeredBy: string;
  sentAt: string;
}

export interface InvoiceSellerSnapshot {
  name: string;
  shortName: string;
  address: string;
  city: string;
  wilaya: string;
  country: string;
  phone: string;
  email: string;
  website?: string;
  accreditationNumber?: string;
  nif?: string;
  nis?: string;
  rc?: string;
  articleImposition?: string;
  primaryColor?: string;
  logoUrl?: string;
}

export interface InvoiceBuyerSnapshot {
  id: string;
  name: string;
  email: string;
  phone?: string;
  studentIdNumber?: string;
  city?: string;
  wilaya?: string;
}

export interface InvoiceLineItem {
  description: string;
  courseCode?: string;
  quantity: number;
  unitPriceHtDzd: number;
  tvaRatePercent: number;
  tvaAmountDzd: number;
  totalTtcDzd: number;
}

export interface Invoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  sequenceNumber: number;
  fiscalYear: number;
  paymentId: string;
  studentId: string;
  courseId: string;
  installmentNumber?: number;
  totalInstallments?: number;
  status: 'PAID' | 'REFUNDED';
  creditNoteNumber?: string;
  currency: string;
  amountHtDzd: number;
  tvaApplicable: boolean;
  tvaRatePercent: number;
  tvaAmountDzd: number;
  amountTtcDzd: number;
  paymentMethod: PaymentMethod;
  transactionReference: string;
  sellerSnapshot: InvoiceSellerSnapshot;
  buyerSnapshot: InvoiceBuyerSnapshot;
  lineItems: InvoiceLineItem[];
  footerNote?: string;
  issuedAt: string;
  paidAt?: string;
  refundedAt?: string;
  refundReason?: string;
  createdAt: string;
}

export interface ActiveSession {
  id: string;
  tenantId: string;
  userId: string;
  token: string;
  csrfToken?: string;
  deviceName: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  rotatedAt?: string;
  expiresAt: string;
  absoluteExpiresAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  isCurrent?: boolean;
}

export type EmailTemplateType =
  | 'PASSWORD_RESET'
  | 'PAYMENT_CONFIRMATION'
  | 'SUBSCRIPTION_EXPIRING_7D'
  | 'SESSION_REMINDER'
  | 'ACCOUNT_CREATED';

export type NotificationCategory =
  | 'GENERAL'
  | 'SYSTEM'
  | 'PASSWORD_RESET'
  | 'PAYMENT_CONFIRMATION'
  | 'SUBSCRIPTION_EXPIRING_7D'
  | 'SESSION_REMINDER'
  | 'ACCOUNT_CREATED'
  | 'BILLING_REMINDER';

export interface NotificationEntity {
  id: string;
  tenantId: string;
  userId: string;
  category?: NotificationCategory;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT';
  link?: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

export interface UserNotificationPreferences {
  userId: string;
  tenantId: string;
  emailPasswordReset: boolean;
  emailPaymentConfirmation: boolean;
  inAppPaymentConfirmation: boolean;
  emailSubscriptionExpiring: boolean;
  inAppSubscriptionExpiring: boolean;
  emailSessionReminder: boolean;
  inAppSessionReminder: boolean;
  emailAccountCreated: boolean;
  inAppAccountCreated: boolean;
  emailInstallmentReminder: boolean;
  inAppInstallmentReminder: boolean;
  updatedAt: string;
}

export type EmailQueueStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'RETRY_SCHEDULED'
  | 'FAILED'
  | 'SKIPPED_PREFERENCE';

export interface EmailQueueItem {
  id: string;
  tenantId: string;
  userId?: string;
  recipientEmail: string;
  recipientName: string;
  templateType: EmailTemplateType;
  locale: 'fr' | 'ar';
  subject: string;
  htmlBody?: string;
  textBody?: string;
  templateVariables: Record<string, any>;
  dedupKey?: string;
  status: EmailQueueStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError?: string;
  smtpMessageId?: string;
  deliveryMode?: 'SMTP_LIVE' | 'SANDBOX_SIMULATED';
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailQueueStats {
  total: number;
  pendingCount: number;
  processingCount: number;
  sentCount: number;
  retryScheduledCount: number;
  failedCount: number;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  userRole: UserRole;
  action: string;
  entity: string;
  entityId?: string;
  details: string;
  ipAddress: string;
  timestamp: string;
}

export interface IntegrationSetting {
  id: string;
  tenantId: string;
  provider: 'ZOOM' | 'PAYMENT_GATEWAY' | 'EMAIL_SMTP';
  isEnabled: boolean;
  isTestMode: boolean;
  config: Record<string, any>;
  updatedAt: string;
}

export interface DashboardStats {
  totalStudents: number;
  activeStudents: number;
  newEnrollmentsThisMonth: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmountDzd: number;
  collectedRevenueDzd: number;
  totalTeachers: number;
  upcomingSessionsCount: number;
  overallAttendanceRate: number;
  monthlyRevenue: { month: string; amountDzd: number }[];
  monthlyEnrollments: { month: string; count: number }[];
}

export interface AutomatedTestCaseResult {
  id: number;
  name: string;
  description: string;
  passed: boolean;
  durationMs: number;
  details: string;
  logs?: string[];
}

export type UploadCategory = 'PAYMENT_RECEIPT' | 'COURSE_MATERIAL';

export interface UploadedFileMetadata {
  id: string;
  tenantId: string;
  ownerId: string;
  uploadedBy: string;
  category: UploadCategory;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  courseId?: string;
  paymentId?: string;
  createdAt: string;
  downloadUrl: string;
}
