/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { relations } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const DEFAULT_TENANT_ID = 'tnt_najahlearn';

export interface TenantSettingsJson {
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

// =============================================================================
// 0. TENANTS (Établissements scolaires / Académies Multi-Tenant)
// =============================================================================
export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    shortName: text('short_name').notNull().default('NL'),
    tagline: text('tagline')
      .notNull()
      .default('Académie d Enseignement Supérieur & Formations Technologiques'),
    logoUrl: text('logo_url'),
    primaryColor: text('primary_color').notNull().default('#101B33'),
    secondaryColor: text('secondary_color').notNull().default('#2457C5'),
    accentColor: text('accent_color').notNull().default('#16845B'),
    contactEmail: text('contact_email').notNull(),
    contactPhone: text('contact_phone').notNull(),
    address: text('address').notNull(),
    city: text('city').notNull(),
    wilaya: text('wilaya').notNull(),
    country: text('country').notNull().default('Algérie'),
    website: text('website'),
    accreditationNumber: text('accreditation_number'),
    taxId: text('tax_id'),
    nif: text('nif'),
    nis: text('nis'),
    rc: text('rc'),
    articleImposition: text('article_imposition'),
    tvaApplicable: boolean('tva_applicable').notNull().default(false),
    tvaRatePercent: integer('tva_rate_percent').notNull().default(0),
    invoicePrefix: text('invoice_prefix').notNull().default('FAC-NL'),
    invoiceNextSequence: integer('invoice_next_sequence').notNull().default(1),
    invoiceFooterNote: text('invoice_footer_note'),
    settings: jsonb('settings')
      .$type<TenantSettingsJson>()
      .notNull()
      .default({
        currency: 'DZD',
        timezone: 'Africa/Algiers',
        locale: 'fr-DZ',
        receiptPrefix: 'REC-NL',
        receiptFooterNote:
          'Ce reçu fait office de justificatif officiel de règlement et d attestation d accès aux formations.',
        enforceSingleStudentSession: true,
        allowManualPayments: true,
        allowInstallments: true,
        autoRemindersEnabled: true,
        reminderDaysBeforeDue: 3,
        reminderDaysAfterOverdue: 1,
        reminderFinalDaysAfterOverdue: 7,
        maxStudents: 500,
        maxTeachers: 30,
        supportHours: 'Dimanche – Jeudi · 08h30 – 17h30',
      }),
    subscriptionPlan: text('subscription_plan').notNull().default('ENTERPRISE'), // STARTER | PRO | ENTERPRISE
    subscriptionStatus: text('subscription_status').notNull().default('ACTIVE'), // ACTIVE | TRIAL | PAST_DUE | SUSPENDED | EXPIRED
    subscriptionStartDate: text('subscription_start_date').notNull().default('2026-01-01'),
    subscriptionEndDate: text('subscription_end_date').notNull().default('2027-01-01'),
    monthlyFeeDzd: integer('monthly_fee_dzd').notNull().default(45000),
    billingNotes: text('billing_notes'),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUSPENDED | ARCHIVED
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_tenants_status').on(table.status),
    index('idx_tenants_subscription_status').on(table.subscriptionStatus),
  ]
);

// =============================================================================
// 0B. TENANT SUBSCRIPTIONS (SaaS Establishment Subscription Contracts & Billing)
// =============================================================================
export const tenantSubscriptions = pgTable(
  'tenant_subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planCode: text('plan_code').notNull(), // STARTER | PRO | ENTERPRISE
    billingCycle: text('billing_cycle').notNull().default('ANNUAL'), // MONTHLY | ANNUAL
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | TRIAL | PAST_DUE | SUSPENDED | EXPIRED
    amountDzd: integer('amount_dzd').notNull(),
    maxStudents: integer('max_students').notNull().default(500),
    maxTeachers: integer('max_teachers').notNull().default(30),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    paymentMethod: text('payment_method').notNull().default('BANK_TRANSFER'),
    notes: text('notes'),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_tenant_subscriptions_tenant_id').on(table.tenantId),
    index('idx_tenant_subscriptions_status').on(table.status),
  ]
);

// =============================================================================
// 1. USERS
// =============================================================================
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    uid: text('uid').notNull().unique(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    role: text('role').notNull().default('STUDENT'), // SUPER_ADMIN | ADMIN | MANAGER | TEACHER | STUDENT
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUSPENDED | ARCHIVED
    phone: text('phone'),
    avatar: text('avatar'),
    passwordHash: text('password_hash'),
    preferredLanguage: text('preferred_language').notNull().default('fr'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_users_tenant').on(table.tenantId),
    index('idx_users_role').on(table.role),
    index('idx_users_status').on(table.status),
    index('idx_users_tenant_role').on(table.tenantId, table.role),
  ]
);

// =============================================================================
// 2. STUDENT PROFILES
// =============================================================================
export const studentProfiles = pgTable(
  'student_profiles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    studentIdNumber: text('student_id_number').notNull(),
    city: text('city').notNull(),
    wilaya: text('wilaya').notNull(),
    academicLevel: text('academic_level').notNull(),
    administrativeNotes: text('administrative_notes'),
    currentClassId: text('current_class_id'),
  },
  (table) => [
    index('idx_student_profiles_tenant').on(table.tenantId),
    uniqueIndex('uq_student_profiles_tenant_num').on(table.tenantId, table.studentIdNumber),
    index('idx_student_profiles_wilaya').on(table.wilaya),
    index('idx_student_profiles_current_class').on(table.currentClassId),
  ]
);

// =============================================================================
// 3. TEACHER PROFILES
// =============================================================================
export const teacherProfiles = pgTable(
  'teacher_profiles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id').notNull(),
    specialty: text('specialty').notNull(),
    bio: text('bio'),
    zoomPersonalMeetingId: text('zoom_personal_meeting_id'),
    assignedClassIds: jsonb('assigned_class_ids').$type<string[]>().notNull().default([]),
  },
  (table) => [
    index('idx_teacher_profiles_tenant').on(table.tenantId),
    uniqueIndex('uq_teacher_profiles_tenant_emp').on(table.tenantId, table.employeeId),
    index('idx_teacher_profiles_specialty').on(table.specialty),
  ]
);

// =============================================================================
// 4. COURSES
// =============================================================================
export const courses = pgTable(
  'courses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    coverImage: text('cover_image').notNull(),
    durationHours: integer('duration_hours').notNull(),
    priceDzd: integer('price_dzd').notNull(),
    status: text('status').notNull().default('PUBLISHED'), // PUBLISHED | DRAFT | ARCHIVED
    modulesCount: integer('modules_count').default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_courses_tenant').on(table.tenantId),
    uniqueIndex('uq_courses_tenant_slug').on(table.tenantId, table.slug),
    uniqueIndex('uq_courses_tenant_code').on(table.tenantId, table.code),
    index('idx_courses_status').on(table.status),
  ]
);

// =============================================================================
// 5. COURSE MODULES
// =============================================================================
export const courseModules = pgTable(
  'course_modules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    orderIndex: integer('order_index').notNull(),
    description: text('description').notNull(),
    durationHours: integer('duration_hours').notNull(),
  },
  (table) => [
    index('idx_course_modules_tenant').on(table.tenantId),
    index('idx_course_modules_course_order').on(table.courseId, table.orderIndex),
  ]
);

// =============================================================================
// 6. LESSON RESOURCES
// =============================================================================
export const lessonResources = pgTable(
  'lesson_resources',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    moduleId: text('module_id')
      .notNull()
      .references(() => courseModules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type').notNull(), // VIDEO | PDF | EXERCISE | CODE
    durationMinutes: integer('duration_minutes'),
    url: text('url').notNull(),
    isProtected: boolean('is_protected').notNull().default(true),
    recordingUrl: text('recording_url'),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (table) => [
    index('idx_lesson_resources_tenant').on(table.tenantId),
    index('idx_lesson_resources_module_order').on(table.moduleId, table.orderIndex),
  ]
);

// =============================================================================
// 7. CLASSES
// =============================================================================
export const classes = pgTable(
  'classes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    capacity: integer('capacity').notNull().default(25),
    enrolledCount: integer('enrolled_count').notNull().default(0),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | ARCHIVED
  },
  (table) => [
    index('idx_classes_tenant').on(table.tenantId),
    uniqueIndex('uq_classes_tenant_code').on(table.tenantId, table.code),
    index('idx_classes_course_id').on(table.courseId),
    index('idx_classes_teacher_id').on(table.teacherId),
    index('idx_classes_status').on(table.status),
  ]
);

// =============================================================================
// 8. ENROLLMENTS
// =============================================================================
export const enrollments = pgTable(
  'enrollments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    enrolledAt: text('enrolled_at').notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | COMPLETED | CANCELLED
  },
  (table) => [
    index('idx_enrollments_tenant').on(table.tenantId),
    index('idx_enrollments_student_course_status').on(table.studentId, table.courseId, table.status),
    index('idx_enrollments_class_status').on(table.classId, table.status),
  ]
);

// =============================================================================
// 9. SESSIONS (Live Videoconference Classes)
// =============================================================================
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    scheduledAt: text('scheduled_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    videoProvider: text('video_provider').notNull(), // ZOOM | JITSI | CUSTOM
    videoMeetingId: text('video_meeting_id').notNull(),
    videoJoinUrl: text('video_join_url').notNull(),
    videoPasscode: text('video_passcode'),
    status: text('status').notNull().default('SCHEDULED'), // SCHEDULED | LIVE | COMPLETED | CANCELLED | POSTPONED
    recordingUrl: text('recording_url'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_sessions_tenant').on(table.tenantId),
    index('idx_sessions_class_id').on(table.classId),
    index('idx_sessions_teacher_id').on(table.teacherId),
    index('idx_sessions_course_id').on(table.courseId),
    index('idx_sessions_status_scheduled').on(table.status, table.scheduledAt),
  ]
);

// =============================================================================
// 10. ATTENDANCE RECORDS
// =============================================================================
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // PRESENT | ABSENT | LATE | EXCUSED
    minutesLate: integer('minutes_late'),
    teacherComment: text('teacher_comment'),
    markedBy: text('marked_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    markedAt: text('marked_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_attendance_records_tenant').on(table.tenantId),
    uniqueIndex('uq_attendance_session_student').on(table.sessionId, table.studentId),
    index('idx_attendance_student_id').on(table.studentId),
  ]
);

// =============================================================================
// 11. SUBSCRIPTION PLANS
// =============================================================================
export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    durationMonths: integer('duration_months').notNull(),
    priceDzd: integer('price_dzd').notNull(),
    description: text('description').notNull(),
    includesLiveSessions: boolean('includes_live_sessions').notNull().default(true),
    includesRecordings: boolean('includes_recordings').notNull().default(true),
  },
  (table) => [
    index('idx_subscription_plans_tenant').on(table.tenantId),
    uniqueIndex('uq_sub_plans_tenant_code').on(table.tenantId, table.code),
  ]
);

// =============================================================================
// 12. SUBSCRIPTIONS
// =============================================================================
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    status: text('status').notNull(), // ACTIVE | EXPIRED | SUSPENDED | PENDING
    paymentId: text('payment_id'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_subscriptions_tenant').on(table.tenantId),
    index('idx_subscriptions_student_course_status').on(table.studentId, table.courseId, table.status),
    index('idx_subscriptions_status_dates').on(table.status, table.startDate, table.endDate),
  ]
);

// =============================================================================
// 13. PAYMENTS
// =============================================================================
export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    receiptNumber: text('receipt_number').notNull(),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    subscriptionId: text('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    installmentItemId: text('installment_item_id'),
    chargilyCheckoutId: text('chargily_checkout_id'),
    idempotencyKey: text('idempotency_key'),
    amountDzd: integer('amount_dzd').notNull(),
    currency: text('currency').notNull().default('DZD'),
    paymentMethod: text('payment_method').notNull(), // CASH | BANK_TRANSFER | BARIDIMOB_CCP | CHEQUE | ONLINE_CARD | CHARGILY_EDAHABIA | CHARGILY_CIB
    transactionReference: text('transaction_reference').notNull(),
    paymentDate: text('payment_date').notNull(),
    status: text('status').notNull(), // PENDING | CONFIRMED | FAILED | REJECTED | REFUNDED
    failureReason: text('failure_reason'),
    receiptAttachment: text('receipt_attachment'),
    confirmedBy: text('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: text('confirmed_at'),
    refundedAmountDzd: integer('refunded_amount_dzd').notNull().default(0),
    refundReason: text('refund_reason'),
    refundedBy: text('refunded_by').references(() => users.id, { onDelete: 'set null' }),
    refundedAt: text('refunded_at'),
    administrativeNotes: text('administrative_notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_payments_tenant').on(table.tenantId),
    uniqueIndex('uq_payments_tenant_receipt').on(table.tenantId, table.receiptNumber),
    index('idx_payments_student_id').on(table.studentId),
    index('idx_payments_course_id').on(table.courseId),
    index('idx_payments_status').on(table.status),
    index('idx_payments_payment_date').on(table.paymentDate),
    index('idx_payments_chargily_checkout').on(table.chargilyCheckoutId),
    index('idx_payments_installment_item').on(table.installmentItemId),
  ]
);

// =============================================================================
// 14. ACTIVE SESSIONS
// =============================================================================
export const activeSessions = pgTable(
  'active_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    csrfToken: text('csrf_token').notNull().default(''),
    deviceName: text('device_name').notNull(),
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent').notNull(),
    createdAt: text('created_at').notNull(),
    lastActiveAt: text('last_active_at').notNull(),
    rotatedAt: text('rotated_at').notNull().default(''),
    expiresAt: text('expires_at').notNull(),
    absoluteExpiresAt: text('absolute_expires_at').notNull().default(''),
    previousTokenHash: text('previous_token_hash'),
    revokedAt: text('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    index('idx_active_sessions_tenant').on(table.tenantId),
    index('idx_active_sessions_user_id').on(table.userId),
    index('idx_active_sessions_expires_at').on(table.expiresAt),
    index('idx_active_sessions_previous_token_hash').on(table.previousTokenHash),
  ]
);

// =============================================================================
// 15. NOTIFICATIONS
// =============================================================================
export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull().default('SYSTEM'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    type: text('type').notNull(), // INFO | SUCCESS | WARNING | ALERT
    link: text('link'),
    read: boolean('read').notNull().default(false),
    readAt: text('read_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_notifications_tenant').on(table.tenantId),
    index('idx_notifications_user_read').on(table.userId, table.read, table.createdAt),
    index('idx_notifications_category').on(table.tenantId, table.category),
  ]
);

// =============================================================================
// 16. AUDIT LOGS (Immutable Security & Financial Trail)
// =============================================================================
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    userEmail: text('user_email').notNull(),
    userRole: text('user_role').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    details: text('details').notNull(),
    ipAddress: text('ip_address').notNull(),
    timestamp: text('timestamp').notNull(),
  },
  (table) => [
    index('idx_audit_logs_tenant').on(table.tenantId),
    index('idx_audit_logs_timestamp').on(table.timestamp),
    index('idx_audit_logs_user_id').on(table.userId),
    index('idx_audit_logs_action').on(table.action),
  ]
);

// =============================================================================
// 17. INTEGRATION SETTINGS
// =============================================================================
export const integrationSettings = pgTable(
  'integration_settings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // ZOOM | PAYMENT_GATEWAY | EMAIL_SMTP
    isEnabled: boolean('is_enabled').notNull().default(false),
    isTestMode: boolean('is_test_mode').notNull().default(true),
    config: jsonb('config').$type<Record<string, any>>().notNull().default({}),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_integration_settings_tenant').on(table.tenantId),
    uniqueIndex('uq_integration_tenant_provider').on(table.tenantId, table.provider),
  ]
);

// =============================================================================
// 18. AUTH RATE LIMITS (Persistent IP & Account Brute-Force Protection)
// =============================================================================
export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    key: text('key').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(), // ACCOUNT | IP | RESET_IP
    identifier: text('identifier').notNull(),
    attempts: integer('attempts').notNull().default(0),
    windowStartAt: text('window_start_at').notNull(),
    lastAttemptAt: text('last_attempt_at').notNull(),
    lockedUntil: text('locked_until'),
  },
  (table) => [
    index('idx_auth_rate_limits_tenant').on(table.tenantId),
    index('idx_auth_rate_limits_scope_identifier').on(table.scope, table.identifier),
    index('idx_auth_rate_limits_locked_until').on(table.lockedUntil),
  ]
);

// =============================================================================
// 19. PASSWORD RESET TOKENS (Persistent Single-Use Hashed Reset Tokens)
// =============================================================================
export const passwordResetTokensTable = pgTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_password_reset_tokens_tenant').on(table.tenantId),
    index('idx_password_reset_tokens_user_id').on(table.userId),
  ]
);

// =============================================================================
// 20. UPLOADED FILES (Private Storage Metadata & Ownership Enforcement)
// =============================================================================
export const uploadedFiles = pgTable(
  'uploaded_files',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(), // PAYMENT_RECEIPT | COURSE_MATERIAL
    originalName: text('original_name').notNull(),
    storedFilename: text('stored_filename').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_uploaded_files_tenant').on(table.tenantId),
    index('idx_uploaded_files_owner_id').on(table.ownerId),
    index('idx_uploaded_files_course_id').on(table.courseId),
    index('idx_uploaded_files_payment_id').on(table.paymentId),
  ]
);

// =============================================================================
// 21. CHARGILY PAY V2 CHECKOUTS (CIB & Edahabia Online Payments)
// =============================================================================
export const chargilyCheckouts = pgTable(
  'chargily_checkouts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    paymentId: text('payment_id')
      .notNull()
      .unique()
      .references(() => payments.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    installmentItemId: text('installment_item_id'),
    amountDzd: integer('amount_dzd').notNull(),
    currency: text('currency').notNull().default('dzd'),
    cardMethod: text('card_method').notNull().default('edahabia'), // edahabia | cib
    mode: text('mode').notNull().default('test'), // test | live
    status: text('status').notNull().default('PENDING'), // PENDING | PAID | FAILED | CANCELED | EXPIRED | REFUNDED
    checkoutUrl: text('checkout_url').notNull(),
    idempotencyKey: text('idempotency_key'),
    failureReason: text('failure_reason'),
    metadata: jsonb('metadata').$type<Record<string, any>>().notNull().default({}),
    paidAt: text('paid_at'),
    failedAt: text('failed_at'),
    refundedAt: text('refunded_at'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_chargily_checkouts_tenant').on(table.tenantId),
    index('idx_chargily_checkouts_student').on(table.studentId),
    index('idx_chargily_checkouts_status').on(table.status),
    index('idx_chargily_checkouts_idempotency').on(table.tenantId, table.idempotencyKey),
  ]
);

// =============================================================================
// 22. PAYMENT WEBHOOK EVENTS (Signature Audit & Duplicate Event Prevention)
// =============================================================================
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('CHARGILY_PAY'),
    eventId: text('event_id').notNull().unique(),
    eventType: text('event_type').notNull(), // checkout.paid | checkout.failed | checkout.canceled | checkout.expired | checkout.refunded
    checkoutId: text('checkout_id').notNull(),
    paymentId: text('payment_id'),
    signatureValid: boolean('signature_valid').notNull().default(true),
    payloadHash: text('payload_hash').notNull(),
    processingStatus: text('processing_status').notNull(), // PROCESSED | DUPLICATE_IGNORED | FAILED
    rawPayload: jsonb('raw_payload').$type<Record<string, any>>().notNull().default({}),
    processedAt: text('processed_at').notNull(),
  },
  (table) => [
    index('idx_webhook_events_tenant').on(table.tenantId),
    index('idx_webhook_events_checkout').on(table.checkoutId),
    index('idx_webhook_events_type').on(table.eventType),
  ]
);

// =============================================================================
// 23. INSTALLMENT PLANS (Échéanciers de paiement en plusieurs fois)
// =============================================================================
export const installmentPlans = pgTable(
  'installment_plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    subscriptionId: text('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    totalAmountDzd: integer('total_amount_dzd').notNull(),
    paidAmountDzd: integer('paid_amount_dzd').notNull().default(0),
    installmentsCount: integer('installments_count').notNull(),
    intervalDays: integer('interval_days').notNull().default(30),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | COMPLETED | OVERDUE | CANCELLED
    notes: text('notes'),
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_installment_plans_tenant').on(table.tenantId),
    index('idx_installment_plans_student').on(table.studentId),
    index('idx_installment_plans_status').on(table.status),
  ]
);

// =============================================================================
// 24. INSTALLMENT ITEMS (Échéances individuelles d'un échéancier)
// =============================================================================
export const installmentItems = pgTable(
  'installment_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => installmentPlans.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    installmentNumber: integer('installment_number').notNull(),
    totalInstallments: integer('total_installments').notNull(),
    amountDzd: integer('amount_dzd').notNull(),
    dueDate: text('due_date').notNull(), // YYYY-MM-DD
    status: text('status').notNull().default('PENDING'), // PENDING | OVERDUE | PAID | REFUNDED | CANCELLED
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    paidAt: text('paid_at'),
    reminderCount: integer('reminder_count').notNull().default(0),
    lastReminderType: text('last_reminder_type'),
    lastReminderAt: text('last_reminder_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_installment_items_tenant').on(table.tenantId),
    index('idx_installment_items_plan').on(table.planId, table.installmentNumber),
    index('idx_installment_items_student').on(table.studentId),
    index('idx_installment_items_status_due').on(table.status, table.dueDate),
  ]
);

// =============================================================================
// 25. PAYMENT REMINDERS (Historique des relances automatiques et manuelles)
// =============================================================================
export const paymentReminders = pgTable(
  'payment_reminders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => installmentPlans.id, { onDelete: 'cascade' }),
    installmentItemId: text('installment_item_id')
      .notNull()
      .references(() => installmentItems.id, { onDelete: 'cascade' }),
    reminderType: text('reminder_type').notNull(), // UPCOMING_DUE | DUE_TODAY | OVERDUE_REMINDER | OVERDUE_FINAL | MANUAL_REMINDER
    channel: text('channel').notNull().default('IN_APP_EMAIL'),
    amountDzd: integer('amount_dzd').notNull(),
    dueDate: text('due_date').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    triggeredBy: text('triggered_by').notNull().default('AUTO_SCHEDULER'),
    sentAt: text('sent_at').notNull(),
  },
  (table) => [
    index('idx_payment_reminders_tenant').on(table.tenantId),
    index('idx_payment_reminders_item').on(table.installmentItemId),
    index('idx_payment_reminders_student').on(table.studentId),
  ]
);

// =============================================================================
// 26. INVOICES (Factures fiscales séquentielles avec NIF, NIS, RC et TVA)
// =============================================================================
export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceNumber: text('invoice_number').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    paymentId: text('payment_id')
      .notNull()
      .unique()
      .references(() => payments.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    installmentNumber: integer('installment_number'),
    totalInstallments: integer('total_installments'),
    status: text('status').notNull().default('PAID'), // PAID | REFUNDED
    creditNoteNumber: text('credit_note_number'),
    currency: text('currency').notNull().default('DZD'),
    amountHtDzd: integer('amount_ht_dzd').notNull(),
    tvaApplicable: boolean('tva_applicable').notNull().default(false),
    tvaRatePercent: integer('tva_rate_percent').notNull().default(0),
    tvaAmountDzd: integer('tva_amount_dzd').notNull().default(0),
    amountTtcDzd: integer('amount_ttc_dzd').notNull(),
    paymentMethod: text('payment_method').notNull(),
    transactionReference: text('transaction_reference').notNull(),
    sellerSnapshot: jsonb('seller_snapshot').$type<InvoiceSellerSnapshot>().notNull(),
    buyerSnapshot: jsonb('buyer_snapshot').$type<InvoiceBuyerSnapshot>().notNull(),
    lineItems: jsonb('line_items').$type<InvoiceLineItem[]>().notNull(),
    footerNote: text('footer_note'),
    issuedAt: text('issued_at').notNull(),
    paidAt: text('paid_at'),
    refundedAt: text('refunded_at'),
    refundReason: text('refund_reason'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_invoices_tenant').on(table.tenantId),
    uniqueIndex('uq_invoices_tenant_number').on(table.tenantId, table.invoiceNumber),
    uniqueIndex('uq_invoices_tenant_year_seq').on(
      table.tenantId,
      table.fiscalYear,
      table.sequenceNumber
    ),
    index('idx_invoices_student').on(table.studentId),
    index('idx_invoices_issued_at').on(table.issuedAt),
  ]
);

// =============================================================================
// 27. USER NOTIFICATION PREFERENCES (Per-User Email & In-App Channel Matrix)
// =============================================================================
export const userNotificationPreferences = pgTable(
  'user_notification_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    emailPasswordReset: boolean('email_password_reset').notNull().default(true),
    emailPaymentConfirmation: boolean('email_payment_confirmation').notNull().default(true),
    inAppPaymentConfirmation: boolean('in_app_payment_confirmation').notNull().default(true),
    emailSubscriptionExpiring: boolean('email_subscription_expiring').notNull().default(true),
    inAppSubscriptionExpiring: boolean('in_app_subscription_expiring').notNull().default(true),
    emailSessionReminder: boolean('email_session_reminder').notNull().default(true),
    inAppSessionReminder: boolean('in_app_session_reminder').notNull().default(true),
    emailAccountCreated: boolean('email_account_created').notNull().default(true),
    inAppAccountCreated: boolean('in_app_account_created').notNull().default(true),
    emailInstallmentReminder: boolean('email_installment_reminder').notNull().default(true),
    inAppInstallmentReminder: boolean('in_app_installment_reminder').notNull().default(true),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_user_notif_prefs_tenant').on(table.tenantId)]
);

// =============================================================================
// 28. TRANSACTIONAL EMAIL OUTBOX QUEUE (SMTP Delivery + Exponential Retry)
// =============================================================================
export const emailQueue = pgTable(
  'email_queue',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .default(DEFAULT_TENANT_ID)
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    recipientEmail: text('recipient_email').notNull(),
    recipientName: text('recipient_name').notNull(),
    templateType: text('template_type').notNull(), // PASSWORD_RESET | PAYMENT_CONFIRMATION | SUBSCRIPTION_EXPIRING_7D | SESSION_REMINDER | ACCOUNT_CREATED
    locale: text('locale').notNull().default('fr'), // fr | ar
    subject: text('subject').notNull(),
    htmlBody: text('html_body').notNull(),
    textBody: text('text_body').notNull(),
    templateVariables: jsonb('template_variables').$type<Record<string, any>>().notNull().default({}),
    dedupKey: text('dedup_key'),
    status: text('status').notNull().default('PENDING'), // PENDING | PROCESSING | SENT | RETRY_SCHEDULED | FAILED | SKIPPED_PREFERENCE
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(4),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lastError: text('last_error'),
    smtpMessageId: text('smtp_message_id'),
    deliveryMode: text('delivery_mode'), // SMTP_LIVE | SANDBOX_SIMULATED
    lockedAt: text('locked_at'),
    sentAt: text('sent_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_email_queue_tenant_status_next').on(table.tenantId, table.status, table.nextAttemptAt),
    index('idx_email_queue_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_email_queue_user').on(table.userId),
    index('idx_email_queue_dedup').on(table.tenantId, table.dedupKey),
  ]
);

// =============================================================================
// DRIZZLE RELATIONS
// =============================================================================
export const tenantsRelations = relations(tenants, ({ many }) => ({
  tenantSubscriptions: many(tenantSubscriptions),
  users: many(users),
  courses: many(courses),
  classes: many(classes),
  sessions: many(sessions),
  payments: many(payments),
}));

export const tenantSubscriptionsRelations = relations(tenantSubscriptions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSubscriptions.tenantId],
    references: [tenants.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  studentProfile: one(studentProfiles, {
    fields: [users.id],
    references: [studentProfiles.userId],
  }),
  teacherProfile: one(teacherProfiles, {
    fields: [users.id],
    references: [teacherProfiles.userId],
  }),
  taughtClasses: many(classes),
  enrollments: many(enrollments),
  taughtSessions: many(sessions),
  attendanceRecords: many(attendanceRecords, { relationName: 'studentAttendance' }),
  markedAttendances: many(attendanceRecords, { relationName: 'markerAttendance' }),
  subscriptions: many(subscriptions),
  payments: many(payments, { relationName: 'studentPayments' }),
  confirmedPayments: many(payments, { relationName: 'confirmerPayments' }),
  activeSessions: many(activeSessions),
  notifications: many(notifications),
}));

export const studentProfilesRelations = relations(studentProfiles, ({ one }) => ({
  tenant: one(tenants, {
    fields: [studentProfiles.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [studentProfiles.userId],
    references: [users.id],
  }),
}));

export const teacherProfilesRelations = relations(teacherProfiles, ({ one }) => ({
  tenant: one(tenants, {
    fields: [teacherProfiles.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [teacherProfiles.userId],
    references: [users.id],
  }),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [courses.tenantId],
    references: [tenants.id],
  }),
  modules: many(courseModules),
  classes: many(classes),
  enrollments: many(enrollments),
  sessions: many(sessions),
  subscriptions: many(subscriptions),
  payments: many(payments),
}));

export const courseModulesRelations = relations(courseModules, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [courseModules.tenantId],
    references: [tenants.id],
  }),
  course: one(courses, {
    fields: [courseModules.courseId],
    references: [courses.id],
  }),
  lessons: many(lessonResources),
}));

export const lessonResourcesRelations = relations(lessonResources, ({ one }) => ({
  tenant: one(tenants, {
    fields: [lessonResources.tenantId],
    references: [tenants.id],
  }),
  module: one(courseModules, {
    fields: [lessonResources.moduleId],
    references: [courseModules.id],
  }),
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [classes.tenantId],
    references: [tenants.id],
  }),
  course: one(courses, {
    fields: [classes.courseId],
    references: [courses.id],
  }),
  teacher: one(users, {
    fields: [classes.teacherId],
    references: [users.id],
  }),
  enrollments: many(enrollments),
  sessions: many(sessions),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [enrollments.tenantId],
    references: [tenants.id],
  }),
  student: one(users, {
    fields: [enrollments.studentId],
    references: [users.id],
  }),
  classEntity: one(classes, {
    fields: [enrollments.classId],
    references: [classes.id],
  }),
  course: one(courses, {
    fields: [enrollments.courseId],
    references: [courses.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [sessions.tenantId],
    references: [tenants.id],
  }),
  course: one(courses, {
    fields: [sessions.courseId],
    references: [courses.id],
  }),
  classEntity: one(classes, {
    fields: [sessions.classId],
    references: [classes.id],
  }),
  teacher: one(users, {
    fields: [sessions.teacherId],
    references: [users.id],
  }),
  attendanceRecords: many(attendanceRecords),
}));

export const attendanceRecordsRelations = relations(attendanceRecords, ({ one }) => ({
  tenant: one(tenants, {
    fields: [attendanceRecords.tenantId],
    references: [tenants.id],
  }),
  session: one(sessions, {
    fields: [attendanceRecords.sessionId],
    references: [sessions.id],
  }),
  student: one(users, {
    fields: [attendanceRecords.studentId],
    references: [users.id],
    relationName: 'studentAttendance',
  }),
  marker: one(users, {
    fields: [attendanceRecords.markedBy],
    references: [users.id],
    relationName: 'markerAttendance',
  }),
}));

export const subscriptionPlansRelations = relations(subscriptionPlans, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [subscriptionPlans.tenantId],
    references: [tenants.id],
  }),
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [subscriptions.tenantId],
    references: [tenants.id],
  }),
  student: one(users, {
    fields: [subscriptions.studentId],
    references: [users.id],
  }),
  course: one(courses, {
    fields: [subscriptions.courseId],
    references: [courses.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [subscriptions.planId],
    references: [subscriptionPlans.id],
  }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [payments.tenantId],
    references: [tenants.id],
  }),
  student: one(users, {
    fields: [payments.studentId],
    references: [users.id],
    relationName: 'studentPayments',
  }),
  course: one(courses, {
    fields: [payments.courseId],
    references: [courses.id],
  }),
  subscription: one(subscriptions, {
    fields: [payments.subscriptionId],
    references: [subscriptions.id],
  }),
  confirmer: one(users, {
    fields: [payments.confirmedBy],
    references: [users.id],
    relationName: 'confirmerPayments',
  }),
}));

export const activeSessionsRelations = relations(activeSessions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [activeSessions.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [activeSessions.userId],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  tenant: one(tenants, {
    fields: [notifications.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const userNotificationPreferencesRelations = relations(
  userNotificationPreferences,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [userNotificationPreferences.tenantId],
      references: [tenants.id],
    }),
    user: one(users, {
      fields: [userNotificationPreferences.userId],
      references: [users.id],
    }),
  })
);

export const emailQueueRelations = relations(emailQueue, ({ one }) => ({
  tenant: one(tenants, {
    fields: [emailQueue.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [emailQueue.userId],
    references: [users.id],
  }),
}));
