/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import argon2 from 'argon2';
import { eq, and, lte, gte, desc, asc, count } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  DEFAULT_TENANT_ID,
  tenants,
  tenantSubscriptions,
  users,
  studentProfiles,
  teacherProfiles,
  courses,
  courseModules,
  lessonResources,
  classes,
  enrollments,
  sessions,
  attendanceRecords,
  subscriptionPlans,
  subscriptions,
  payments,
  activeSessions,
  notifications,
  auditLogs,
  integrationSettings,
  authRateLimits,
  passwordResetTokensTable,
  uploadedFiles,
  chargilyCheckouts,
  paymentWebhookEvents,
  installmentPlans,
  installmentItems,
  paymentReminders,
  invoices,
  userNotificationPreferences,
  emailQueue,
} from '../src/db/schema.ts';
import { getDemoSeedDataset, type DatabaseSchema } from './seedData.ts';
import {
  tdb,
  getCurrentTenantId,
  runWithTenantContext,
  DEFAULT_TENANT_SETTINGS,
} from './tenantContext.ts';
import {
  syncInstallmentOnPaymentConfirmedInTx,
  issueSequentialInvoiceInTx,
} from './billing.ts';
import {
  dispatchTransactionalNotification,
  getUserNotificationPreferences,
  checkChannelPreference,
} from './emailService.ts';
import type {
  User,
  UserRole,
  UserStatus,
  StudentProfile,
  TeacherProfile,
  Course,
  CourseModule,
  LessonResource,
  ClassEntity,
  Enrollment,
  SessionEntity,
  SessionStatus,
  VideoProvider,
  AttendanceRecord,
  AttendanceStatus,
  SubscriptionPlan,
  Subscription,
  SubscriptionStatus,
  Payment,
  PaymentMethod,
  PaymentStatus,
  ActiveSession,
  NotificationEntity,
  AuditLog,
  IntegrationSetting,
  UploadedFileMetadata,
  UploadCategory,
} from '../src/types/index.ts';

// =============================================================================
// CRYPTOGRAPHY HELPERS (Argon2id + Transparent Migration from Legacy PBKDF2/Scrypt)
// =============================================================================
const LEGACY_PBKDF2_SALT = 'najahlearn_dz_security_salt_2026';

export const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP recommended minimum for Argon2id)
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

/**
 * Generates a legacy PBKDF2-HMAC-SHA256 hash solely for testing transparent migration to Argon2id.
 */
export function hashLegacyPbkdf2(password: string): string {
  return crypto.pbkdf2Sync(password, LEGACY_PBKDF2_SALT, 10000, 64, 'sha256').toString('hex');
}

export function isArgon2idHash(storedHash?: string | null): boolean {
  return Boolean(storedHash && storedHash.startsWith('$argon2id$'));
}

export interface PasswordVerificationResult {
  valid: boolean;
  needsRehash: boolean;
  algorithm: 'argon2id' | 'argon2_other' | 'scrypt_legacy' | 'pbkdf2_legacy' | 'invalid';
}

export async function verifyPasswordWithMigrationInfo(
  password: string,
  storedHash: string
): Promise<PasswordVerificationResult> {
  if (!storedHash || typeof password !== 'string') {
    return { valid: false, needsRehash: false, algorithm: 'invalid' };
  }

  try {
    if (storedHash.startsWith('$argon2')) {
      const valid = await argon2.verify(storedHash, password);
      if (!valid) {
        return {
          valid: false,
          needsRehash: false,
          algorithm: storedHash.startsWith('$argon2id$') ? 'argon2id' : 'argon2_other',
        };
      }
      const needsRehash =
        !storedHash.startsWith('$argon2id$') || argon2.needsRehash(storedHash, ARGON2ID_OPTIONS);
      return {
        valid: true,
        needsRehash,
        algorithm: storedHash.startsWith('$argon2id$') ? 'argon2id' : 'argon2_other',
      };
    }

    if (storedHash.includes(':')) {
      const [salt, keyHex] = storedHash.split(':');
      if (!salt || !keyHex) {
        return { valid: false, needsRehash: false, algorithm: 'invalid' };
      }
      const expectedBuf = Buffer.from(keyHex, 'hex');
      const derivedBuf = crypto.scryptSync(password, salt, 64);
      const valid =
        expectedBuf.length === derivedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, derivedBuf);
      return { valid, needsRehash: valid, algorithm: 'scrypt_legacy' };
    }

    const legacyDerived = crypto.pbkdf2Sync(password, LEGACY_PBKDF2_SALT, 10000, 64, 'sha256');
    const expectedLegacy = Buffer.from(storedHash, 'hex');
    const valid =
      expectedLegacy.length === legacyDerived.length &&
      crypto.timingSafeEqual(expectedLegacy, legacyDerived);
    return { valid, needsRehash: valid, algorithm: 'pbkdf2_legacy' };
  } catch {
    return { valid: false, needsRehash: false, algorithm: 'invalid' };
  }
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const res = await verifyPasswordWithMigrationInfo(password, storedHash);
  return res.valid;
}

export function sanitizeUser(user: User): Omit<User, 'passwordHash'> {
  const { passwordHash: _ignored, ...safeUser } = user;
  return safeUser;
}

export function sanitizeSessionForClient(session: ActiveSession): ActiveSession {
  const { csrfToken: _csrf, ...rest } = session;
  return {
    ...rest,
    token: '[HTTPONLY_COOKIE]',
  };
}

// =============================================================================
// ROW -> DOMAIN ENTITY MAPPERS (WITH TENANT_ID)
// =============================================================================
export function mapUserRow(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    phone: row.phone ?? undefined,
    avatar: row.avatar ?? undefined,
    preferredLanguage: row.preferredLanguage === 'ar' ? 'ar' : 'fr',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    passwordHash: row.passwordHash ?? undefined,
  };
}

export function mapStudentProfileRow(row: typeof studentProfiles.$inferSelect): StudentProfile {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    studentIdNumber: row.studentIdNumber,
    city: row.city,
    wilaya: row.wilaya,
    academicLevel: row.academicLevel,
    administrativeNotes: row.administrativeNotes ?? undefined,
    currentClassId: row.currentClassId ?? undefined,
  };
}

export function mapTeacherProfileRow(row: typeof teacherProfiles.$inferSelect): TeacherProfile {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    employeeId: row.employeeId,
    specialty: row.specialty,
    bio: row.bio ?? undefined,
    zoomPersonalMeetingId: row.zoomPersonalMeetingId ?? undefined,
    assignedClassIds: Array.isArray(row.assignedClassIds) ? row.assignedClassIds : [],
  };
}

export function mapCourseRow(row: typeof courses.$inferSelect): Course {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    slug: row.slug,
    code: row.code,
    description: row.description,
    coverImage: row.coverImage,
    durationHours: row.durationHours,
    priceDzd: row.priceDzd,
    status: row.status as Course['status'],
    modulesCount: row.modulesCount ?? 0,
    createdAt: row.createdAt,
  };
}

export function mapLessonRow(row: typeof lessonResources.$inferSelect): LessonResource {
  return {
    id: row.id,
    tenantId: row.tenantId,
    moduleId: row.moduleId,
    title: row.title,
    type: row.type as LessonResource['type'],
    durationMinutes: row.durationMinutes ?? undefined,
    url: row.url,
    isProtected: row.isProtected,
    recordingUrl: row.recordingUrl ?? undefined,
  };
}

export function mapClassRow(row: typeof classes.$inferSelect): ClassEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    courseId: row.courseId,
    teacherId: row.teacherId,
    capacity: row.capacity,
    enrolledCount: row.enrolledCount,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as ClassEntity['status'],
  };
}

export function mapEnrollmentRow(row: typeof enrollments.$inferSelect): Enrollment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    classId: row.classId,
    courseId: row.courseId,
    enrolledAt: row.enrolledAt,
    status: row.status as Enrollment['status'],
  };
}

export function mapSessionRow(row: typeof sessions.$inferSelect): SessionEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    classId: row.classId,
    teacherId: row.teacherId,
    title: row.title,
    description: row.description ?? undefined,
    scheduledAt: row.scheduledAt,
    durationMinutes: row.durationMinutes,
    videoProvider: row.videoProvider as VideoProvider,
    videoMeetingId: row.videoMeetingId,
    videoJoinUrl: row.videoJoinUrl,
    videoPasscode: row.videoPasscode ?? undefined,
    status: row.status as SessionStatus,
    recordingUrl: row.recordingUrl ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}

export function mapAttendanceRow(row: typeof attendanceRecords.$inferSelect): AttendanceRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sessionId: row.sessionId,
    studentId: row.studentId,
    status: row.status as AttendanceStatus,
    minutesLate: row.minutesLate ?? undefined,
    teacherComment: row.teacherComment ?? undefined,
    markedBy: row.markedBy,
    markedAt: row.markedAt,
    updatedAt: row.updatedAt,
  };
}

export function mapPlanRow(row: typeof subscriptionPlans.$inferSelect): SubscriptionPlan {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    durationMonths: row.durationMonths,
    priceDzd: row.priceDzd,
    description: row.description,
    includesLiveSessions: row.includesLiveSessions,
    includesRecordings: row.includesRecordings,
  };
}

export function mapSubscriptionRow(row: typeof subscriptions.$inferSelect): Subscription {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    courseId: row.courseId,
    planId: row.planId,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as SubscriptionStatus,
    paymentId: row.paymentId ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
  };
}

export function mapPaymentRow(row: typeof payments.$inferSelect): Payment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    receiptNumber: row.receiptNumber,
    studentId: row.studentId,
    courseId: row.courseId,
    subscriptionId: row.subscriptionId ?? undefined,
    installmentItemId: row.installmentItemId ?? undefined,
    chargilyCheckoutId: row.chargilyCheckoutId ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    amountDzd: row.amountDzd,
    currency: (row.currency as Payment['currency']) || 'DZD',
    paymentMethod: row.paymentMethod as PaymentMethod,
    transactionReference: row.transactionReference,
    paymentDate: row.paymentDate,
    status: row.status as PaymentStatus,
    failureReason: row.failureReason ?? undefined,
    receiptAttachment: row.receiptAttachment ?? undefined,
    confirmedBy: row.confirmedBy ?? undefined,
    confirmedAt: row.confirmedAt ?? undefined,
    refundedAmountDzd: row.refundedAmountDzd ?? 0,
    refundReason: row.refundReason ?? undefined,
    refundedBy: row.refundedBy ?? undefined,
    refundedAt: row.refundedAt ?? undefined,
    administrativeNotes: row.administrativeNotes ?? undefined,
    createdAt: row.createdAt,
  };
}

export function mapActiveSessionRow(row: typeof activeSessions.$inferSelect): ActiveSession {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    token: row.token,
    csrfToken: row.csrfToken || undefined,
    deviceName: row.deviceName,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    rotatedAt: row.rotatedAt || undefined,
    expiresAt: row.expiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt || undefined,
    revokedAt: row.revokedAt ?? undefined,
    revokedReason: row.revokedReason ?? undefined,
  };
}

export function mapNotificationRow(row: typeof notifications.$inferSelect): NotificationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    category: (row.category as NotificationEntity['category']) || 'GENERAL',
    title: row.title,
    message: row.message,
    type: row.type as NotificationEntity['type'],
    link: row.link ?? undefined,
    read: row.read,
    readAt: row.readAt ?? undefined,
    createdAt: row.createdAt,
  };
}

export function mapAuditLogRow(row: typeof auditLogs.$inferSelect): AuditLog {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    userEmail: row.userEmail,
    userRole: row.userRole as UserRole,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId ?? undefined,
    details: row.details,
    ipAddress: row.ipAddress,
    timestamp: row.timestamp,
  };
}

export function mapIntegrationSettingRow(
  row: typeof integrationSettings.$inferSelect
): IntegrationSetting {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider as IntegrationSetting['provider'],
    isEnabled: row.isEnabled,
    isTestMode: row.isTestMode,
    config: (row.config as Record<string, any>) || {},
    updatedAt: row.updatedAt,
  };
}

export function mapUploadedFileRow(
  row: typeof uploadedFiles.$inferSelect
): UploadedFileMetadata {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ownerId: row.ownerId,
    uploadedBy: row.uploadedBy,
    category: row.category as UploadCategory,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256Hash: row.sha256Hash,
    courseId: row.courseId ?? undefined,
    paymentId: row.paymentId ?? undefined,
    createdAt: row.createdAt,
    downloadUrl: `/api/uploads/${row.id}/download`,
  };
}

// =============================================================================
// LAZY INITIALIZATION (ON-DEMAND ONLY — NO STARTUP PROBES)
// =============================================================================
let hasCheckedInitialSeed = false;

export async function ensureSeededIfEmpty(): Promise<void> {
  if (hasCheckedInitialSeed) return;
  try {
    const [{ value: userCount }] = await db.select({ value: count() }).from(users);
    const [{ value: superAdminCount }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, 'SUPER_ADMIN'));

    if (Number(userCount) === 0 || Number(superAdminCount) === 0) {
      const demoSeed = await getDemoSeedDataset();
      await importDatasetTransaction(demoSeed, { clearExisting: Number(userCount) === 0 });
    }
    hasCheckedInitialSeed = true;
  } catch (error) {
    console.error('Database on-demand check failed:', error);
    throw new Error('Base de données PostgreSQL temporairement indisponible.', { cause: error });
  }
}

// =============================================================================
// TENANT-SCOPED REAL POSTGRESQL ACID TRANSACTIONS
// =============================================================================

/**
 * Checks whether a student has an active subscription & enrollment for a course
 * strictly within the active establishment (`tenantId` via `tdb`).
 */
export async function verifyStudentAccess(
  studentId: string,
  courseId: string
): Promise<{
  hasAccess: boolean;
  reason?: string;
  subscription?: Subscription;
}> {
  try {
    const userRow = await tdb.findFirst(users, eq(users.id, studentId));
    if (!userRow) {
      return { hasAccess: false, reason: 'Utilisateur introuvable dans cet établissement.' };
    }

    if (userRow.status !== 'ACTIVE') {
      return {
        hasAccess: false,
        reason: `Compte étudiant ${userRow.status === 'SUSPENDED' ? 'suspendu' : 'archivé'}.`,
      };
    }

    const enrollmentRow = await tdb.findFirst(
      enrollments,
      and(
        eq(enrollments.studentId, studentId),
        eq(enrollments.courseId, courseId),
        eq(enrollments.status, 'ACTIVE')
      )
    );

    if (!enrollmentRow) {
      return {
        hasAccess: false,
        reason: 'L étudiant n est pas inscrit à cette formation ou classe.',
      };
    }

    const today = new Date().toISOString().split('T')[0];

    const activeSubRow = await tdb.findFirst(
      subscriptions,
      and(
        eq(subscriptions.studentId, studentId),
        eq(subscriptions.courseId, courseId),
        eq(subscriptions.status, 'ACTIVE'),
        lte(subscriptions.startDate, today),
        gte(subscriptions.endDate, today)
      )
    );

    if (!activeSubRow) {
      const subRows = await tdb.selectMany(subscriptions, {
        where: and(eq(subscriptions.studentId, studentId), eq(subscriptions.courseId, courseId)),
        orderBy: desc(subscriptions.createdAt),
        limit: 1,
      });
      const anySubRow = subRows[0];

      if (anySubRow && (anySubRow.endDate < today || anySubRow.status === 'EXPIRED')) {
        return {
          hasAccess: false,
          reason: `Abonnement expiré le ${anySubRow.endDate}. Veuillez renouveler votre formule.`,
        };
      }
      if (anySubRow && anySubRow.status === 'PENDING') {
        return {
          hasAccess: false,
          reason: 'Abonnement en attente de confirmation du paiement par l administration.',
        };
      }
      return { hasAccess: false, reason: 'Aucun abonnement valide actif pour cette formation.' };
    }

    return { hasAccess: true, subscription: mapSubscriptionRow(activeSubRow) };
  } catch (error) {
    console.error('verifyStudentAccess query failed:', error);
    throw new Error('Erreur lors de la vérification des droits d accès étudiant.', {
      cause: error,
    });
  }
}

/**
 * Confirms a payment and activates/extends the student's subscription inside
 * a REAL PostgreSQL ACID transaction (`BEGIN ... COMMIT / ROLLBACK`), automatically
 * scoped to the active `tenantId` via `tdb.forTx(tx)`.
 */
export async function confirmPaymentTransaction(
  paymentId: string,
  adminUserId: string,
  notes?: string,
  options?: { ipAddress?: string; _simulateFailureAfterPaymentUpdate?: boolean }
): Promise<Payment> {
  try {
    return await db.transaction(async (tx) => {
      const txDb = tdb.forTx(tx);
      const activeTenantId = getCurrentTenantId();

      const paymentRow = await txDb.findFirst(payments, eq(payments.id, paymentId));
      if (!paymentRow) {
        throw new Error('Paiement introuvable.');
      }

      if (paymentRow.status === 'CONFIRMED') {
        return { mappedResult: mapPaymentRow(paymentRow), emailPostCommit: null };
      }

      const adminRow = await txDb.findFirst(users, eq(users.id, adminUserId));

      const nowIso = new Date().toISOString();
      const todayStr = nowIso.split('T')[0];

      // Step 1: Mark payment as CONFIRMED (strictly scoped by tenant_id)
      const [updatedPayment] = await txDb.updateWhere(
        payments,
        {
          status: 'CONFIRMED',
          confirmedBy: adminRow ? adminUserId : null,
          confirmedAt: nowIso,
          administrativeNotes: notes ?? paymentRow.administrativeNotes,
        },
        eq(payments.id, paymentId)
      );

      // Deterministic rollback test hook for automated ACID verification
      if (options?._simulateFailureAfterPaymentUpdate) {
        throw new Error('SIMULATED_TRANSACTION_FAILURE_FOR_ROLLBACK_TEST');
      }

      // Step 1b: Synchronize linked installment schedule item if payment is part of an échéancier
      const installmentMeta = await syncInstallmentOnPaymentConfirmedInTx(tx, updatedPayment);
      const extensionDays = Math.max(15, installmentMeta.intervalDays || 30);

      // Step 2: Find or create the associated Subscription inside the SAME tenant
      let subRow: typeof subscriptions.$inferSelect | undefined;

      if (paymentRow.subscriptionId) {
        subRow = await txDb.findFirst(subscriptions, eq(subscriptions.id, paymentRow.subscriptionId));
      }

      if (!subRow) {
        const candidates = await txDb.selectMany(subscriptions, {
          where: and(
            eq(subscriptions.studentId, paymentRow.studentId),
            eq(subscriptions.courseId, paymentRow.courseId)
          ),
          orderBy: desc(subscriptions.createdAt),
          limit: 1,
        });
        subRow = candidates[0];
      }

      let activeSub: typeof subscriptions.$inferSelect;

      if (subRow) {
        let newStartDate = subRow.startDate;
        let newEndDate = subRow.endDate;

        if (
          subRow.endDate < todayStr ||
          subRow.status === 'PENDING' ||
          subRow.status === 'EXPIRED' ||
          subRow.status === 'SUSPENDED'
        ) {
          newStartDate = todayStr;
          const futureDate = new Date();
          futureDate.setDate(futureDate.getDate() + extensionDays);
          newEndDate = futureDate.toISOString().split('T')[0];
        } else if (
          installmentMeta.installmentNumber &&
          installmentMeta.installmentNumber > 1
        ) {
          const currentEnd = new Date(`${subRow.endDate}T00:00:00.000Z`);
          currentEnd.setUTCDate(currentEnd.getUTCDate() + extensionDays);
          newEndDate = currentEnd.toISOString().split('T')[0];
        }

        const [updatedSub] = await txDb.updateWhere(
          subscriptions,
          {
            status: 'ACTIVE',
            paymentId: paymentRow.id,
            startDate: newStartDate,
            endDate: newEndDate,
          },
          eq(subscriptions.id, subRow.id)
        );

        activeSub = updatedSub;

        if (updatedPayment.subscriptionId !== activeSub.id) {
          const [relinked] = await txDb.updateWhere(
            payments,
            { subscriptionId: activeSub.id },
            eq(payments.id, paymentRow.id)
          );
          Object.assign(updatedPayment, relinked);
        }
      } else {
        // Ensure a monthly plan exists for this tenant
        let defaultPlan = await txDb.findFirst(
          subscriptionPlans,
          eq(subscriptionPlans.code, 'PLAN-M-DZD')
        );

        if (!defaultPlan) {
          const planId =
            activeTenantId === DEFAULT_TENANT_ID
              ? 'plan_monthly'
              : `plan_m_${activeTenantId.replace(/[^a-zA-Z0-9_]/g, '')}`;
          defaultPlan = await txDb.insertOne(subscriptionPlans, {
            id: planId,
            name: 'Formule Mensuelle (Accès Standard)',
            code: 'PLAN-M-DZD',
            durationMonths: 1,
            priceDzd: 6500,
            description: 'Accès complet 30 jours.',
            includesLiveSessions: true,
            includesRecordings: true,
          });
        }

        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + extensionDays);
        const newSubId = `sub_${crypto.randomUUID()}`;

        activeSub = await txDb.insertOne(subscriptions, {
          id: newSubId,
          studentId: paymentRow.studentId,
          courseId: paymentRow.courseId,
          planId: defaultPlan.id,
          startDate: todayStr,
          endDate: futureDate.toISOString().split('T')[0],
          status: 'ACTIVE',
          paymentId: paymentRow.id,
          notes: `Généré automatiquement suite à validation du paiement ${paymentRow.receiptNumber}`,
          createdAt: nowIso,
        });

        const [relinked] = await txDb.updateWhere(
          payments,
          { subscriptionId: activeSub.id },
          eq(payments.id, paymentRow.id)
        );
        Object.assign(updatedPayment, relinked);
      }

      if (installmentMeta.planId) {
        await txDb.updateWhere(
          installmentPlans,
          { subscriptionId: activeSub.id },
          eq(installmentPlans.id, installmentMeta.planId)
        );
      }

      // Step 2b: Issue gap-free sequentially numbered fiscal invoice inside the same ACID transaction
      const issuedInvoice = await issueSequentialInvoiceInTx(tx, updatedPayment, installmentMeta);

      // Step 3: Immutable Audit Log inside the same tenant & transaction
      await txDb.insertOne(auditLogs, {
        id: `log_${crypto.randomUUID()}`,
        userId: adminUserId,
        userEmail: adminRow?.email || 'admin@najahlearn.dz',
        userRole: adminRow?.role || 'ADMIN',
        action: 'PAYMENT_CONFIRMED',
        entity: 'Payment',
        entityId: updatedPayment.id,
        details: `Paiement ${updatedPayment.receiptNumber} (${updatedPayment.amountDzd.toLocaleString('fr-DZ')} ${updatedPayment.currency}) confirmé par ${adminRow?.name || 'Admin'}. Abonnement ${activeSub.id} activé jusqu au ${activeSub.endDate}. Facture ${issuedInvoice.invoiceNumber}.`,
        ipAddress: options?.ipAddress || '127.0.0.1',
        timestamp: nowIso,
      });

      // Step 4: Student Notification inside the same tenant & transaction (respecting user preferences)
      const [studentRow, courseRow, studentPrefs] = await Promise.all([
        txDb.findFirst(users, eq(users.id, updatedPayment.studentId)),
        txDb.findFirst(courses, eq(courses.id, updatedPayment.courseId)),
        getUserNotificationPreferences(updatedPayment.studentId, activeTenantId),
      ]);

      if (checkChannelPreference(studentPrefs, 'PAYMENT_CONFIRMATION', 'inApp')) {
        await txDb.insertOne(notifications, {
          id: `notif_${crypto.randomUUID()}`,
          userId: updatedPayment.studentId,
          category: 'PAYMENT_CONFIRMATION',
          title: 'Paiement confirmé & Facture disponible !',
          message: `Votre paiement de ${updatedPayment.amountDzd.toLocaleString('fr-DZ')} ${updatedPayment.currency} (Facture N° ${issuedInvoice.invoiceNumber}) a été validé. Vos accès aux cours et aux séances en direct sont actifs jusqu au ${activeSub.endDate}.`,
          type: 'SUCCESS',
          link: '/student/subscriptions',
          read: false,
          readAt: null,
          createdAt: nowIso,
        });
      }

      const mappedResult: Payment = {
        ...mapPaymentRow(updatedPayment),
        invoiceId: issuedInvoice.id,
        invoiceNumber: issuedInvoice.invoiceNumber,
      };

      return {
        mappedResult,
        emailPostCommit: studentRow?.email
          ? {
              tenantId: activeTenantId,
              userId: studentRow.id,
              recipientEmail: studentRow.email,
              recipientName: studentRow.name,
              preferredLocale: (studentRow.preferredLanguage === 'ar' ? 'ar' : 'fr') as 'fr' | 'ar',
              variables: {
                paymentId: updatedPayment.id,
                amountDzd: updatedPayment.amountDzd,
                currency: updatedPayment.currency,
                courseTitle: courseRow?.title || 'Formation',
                receiptNumber: updatedPayment.receiptNumber,
                invoiceNumber: issuedInvoice.invoiceNumber,
                paymentMethod: updatedPayment.paymentMethod,
                subscriptionEndDate: activeSub.endDate,
                installmentLabel:
                  installmentMeta.installmentNumber && installmentMeta.totalInstallments
                    ? `${installmentMeta.installmentNumber}/${installmentMeta.totalInstallments}`
                    : undefined,
              },
            }
          : null,
      };
    }).then(async ({ mappedResult, emailPostCommit }) => {
      // Step 5 (Post-Commit): Enqueue localized FR/AR PAYMENT_CONFIRMATION email in persistent outbox queue
      if (emailPostCommit) {
        await dispatchTransactionalNotification({
          tenantId: emailPostCommit.tenantId,
          userId: emailPostCommit.userId,
          recipientEmail: emailPostCommit.recipientEmail,
          recipientName: emailPostCommit.recipientName,
          preferredLocale: emailPostCommit.preferredLocale,
          templateType: 'PAYMENT_CONFIRMATION',
          dedupKey: `pay_conf:${mappedResult.id}`,
          skipInAppNotification: true,
          variables: emailPostCommit.variables,
        }).catch((err) => {
          console.warn('[NajahLearn SMTP] Post-commit payment email enqueue warning:', err);
        });
      }
      return mappedResult;
    });
  } catch (error: any) {
    if (
      error?.message === 'Paiement introuvable.' ||
      error?.message === 'SIMULATED_TRANSACTION_FAILURE_FOR_ROLLBACK_TEST'
    ) {
      throw error;
    }
    console.error('confirmPaymentTransaction failed and rolled back:', error);
    throw new Error('La transaction de confirmation du paiement a échoué et a été annulée.', {
      cause: error,
    });
  }
}

/**
 * Imports a full multi-tenant dataset (from JSON migration or Demo Seed)
 * atomically inside a single PostgreSQL transaction in strict foreign-key dependency order.
 */
export async function importDatasetTransaction(
  dataset: DatabaseSchema,
  options: { clearExisting?: boolean } = {}
): Promise<{
  counts: Record<string, number>;
}> {
  try {
    return await db.transaction(async (tx) => {
      if (options.clearExisting) {
        await tx.delete(emailQueue);
        await tx.delete(userNotificationPreferences);
        await tx.delete(paymentReminders);
        await tx.delete(paymentWebhookEvents);
        await tx.delete(chargilyCheckouts);
        await tx.delete(invoices);
        await tx.delete(installmentItems);
        await tx.delete(installmentPlans);
        await tx.delete(uploadedFiles);
        await tx.delete(passwordResetTokensTable);
        await tx.delete(authRateLimits);
        await tx.delete(attendanceRecords);
        await tx.delete(payments);
        await tx.delete(subscriptions);
        await tx.delete(subscriptionPlans);
        await tx.delete(sessions);
        await tx.delete(enrollments);
        await tx.delete(classes);
        await tx.delete(lessonResources);
        await tx.delete(courseModules);
        await tx.delete(courses);
        await tx.delete(activeSessions);
        await tx.delete(notifications);
        await tx.delete(auditLogs);
        await tx.delete(integrationSettings);
        await tx.delete(studentProfiles);
        await tx.delete(teacherProfiles);
        await tx.delete(users);
        await tx.delete(tenantSubscriptions);
        await tx.delete(tenants);
      }

      const nowIso = new Date().toISOString();

      // 0. Ensure Default Tenant + Seed Tenants exist first
      const seedTenants =
        dataset.tenants && dataset.tenants.length > 0
          ? dataset.tenants
          : [
              {
                id: DEFAULT_TENANT_ID,
                slug: 'najahlearn-alger',
                name: 'Académie NajahLearn Alger',
                shortName: 'NL',
                tagline: 'Académie d Enseignement Supérieur & Formations Technologiques',
                logoUrl: '/src/assets/images/logo_najahlearn_alger_1793021536468.jpg',
                primaryColor: '#101B33',
                secondaryColor: '#2457C5',
                accentColor: '#16845B',
                contactEmail: 'contact@najahlearn.dz',
                contactPhone: '+213 23 45 67 89',
                address: '14 Boulevard Mohamed V, Hydra',
                city: 'Alger',
                wilaya: '16 - Alger',
                country: 'Algérie',
                website: 'https://najahlearn.dz',
                accreditationNumber: 'MESRS / FP-16-2024-089',
                taxId: 'NIF 002416098412300',
                nif: '002416098412300',
                nis: '099816010234567',
                rc: '16/00-0984123B24',
                articleImposition: '16120984123',
                tvaApplicable: false,
                tvaRatePercent: 0,
                invoicePrefix: 'FAC-NL',
                invoiceNextSequence: 1,
                settings: DEFAULT_TENANT_SETTINGS,
                subscriptionPlan: 'ENTERPRISE' as const,
                subscriptionStatus: 'ACTIVE' as const,
                subscriptionStartDate: '2026-01-01',
                subscriptionEndDate: '2027-01-01',
                monthlyFeeDzd: 45000,
                status: 'ACTIVE' as const,
                createdAt: nowIso,
                updatedAt: nowIso,
              },
            ];

      let tenantsCount = 0;
      for (const t of seedTenants) {
        await tx
          .insert(tenants)
          .values({
            id: t.id,
            slug: t.slug,
            name: t.name,
            shortName: t.shortName || 'NL',
            tagline: t.tagline,
            logoUrl: t.logoUrl ?? null,
            primaryColor: t.primaryColor,
            secondaryColor: t.secondaryColor,
            accentColor: t.accentColor,
            contactEmail: t.contactEmail,
            contactPhone: t.contactPhone,
            address: t.address,
            city: t.city,
            wilaya: t.wilaya,
            country: t.country || 'Algérie',
            website: t.website ?? null,
            accreditationNumber: t.accreditationNumber ?? null,
            taxId: t.taxId ?? null,
            nif: t.nif ?? null,
            nis: t.nis ?? null,
            rc: t.rc ?? null,
            articleImposition: t.articleImposition ?? null,
            tvaApplicable: Boolean(t.tvaApplicable),
            tvaRatePercent: Number(t.tvaRatePercent ?? 0),
            invoicePrefix: t.invoicePrefix || `FAC-${t.shortName || 'NL'}`,
            invoiceNextSequence: Number(t.invoiceNextSequence ?? 1),
            invoiceFooterNote: t.invoiceFooterNote ?? null,
            settings: { ...DEFAULT_TENANT_SETTINGS, ...(t.settings || {}) },
            subscriptionPlan: t.subscriptionPlan || 'ENTERPRISE',
            subscriptionStatus: t.subscriptionStatus || 'ACTIVE',
            subscriptionStartDate: t.subscriptionStartDate || '2026-01-01',
            subscriptionEndDate: t.subscriptionEndDate || '2027-01-01',
            monthlyFeeDzd: t.monthlyFeeDzd ?? 45000,
            billingNotes: t.billingNotes ?? null,
            status: t.status || 'ACTIVE',
            createdAt: t.createdAt || nowIso,
            updatedAt: t.updatedAt || nowIso,
          })
          .onConflictDoUpdate({
            target: tenants.id,
            set: {
              slug: t.slug,
              name: t.name,
              shortName: t.shortName || 'NL',
              tagline: t.tagline,
              logoUrl: t.logoUrl ?? null,
              primaryColor: t.primaryColor,
              secondaryColor: t.secondaryColor,
              accentColor: t.accentColor,
              contactEmail: t.contactEmail,
              contactPhone: t.contactPhone,
              address: t.address,
              city: t.city,
              wilaya: t.wilaya,
              country: t.country || 'Algérie',
              website: t.website ?? null,
              accreditationNumber: t.accreditationNumber ?? null,
              taxId: t.taxId ?? null,
              nif: t.nif ?? null,
              nis: t.nis ?? null,
              rc: t.rc ?? null,
              articleImposition: t.articleImposition ?? null,
              tvaApplicable: Boolean(t.tvaApplicable),
              tvaRatePercent: Number(t.tvaRatePercent ?? 0),
              invoicePrefix: t.invoicePrefix || `FAC-${t.shortName || 'NL'}`,
              invoiceFooterNote: t.invoiceFooterNote ?? null,
              settings: { ...DEFAULT_TENANT_SETTINGS, ...(t.settings || {}) },
              subscriptionPlan: t.subscriptionPlan || 'ENTERPRISE',
              subscriptionStatus: t.subscriptionStatus || 'ACTIVE',
              subscriptionStartDate: t.subscriptionStartDate || '2026-01-01',
              subscriptionEndDate: t.subscriptionEndDate || '2027-01-01',
              monthlyFeeDzd: t.monthlyFeeDzd ?? 45000,
              billingNotes: t.billingNotes ?? null,
              status: t.status || 'ACTIVE',
              updatedAt: t.updatedAt || nowIso,
            },
          });
        tenantsCount++;
      }

      let tenantSubsCount = 0;
      for (const ts of dataset.tenantSubscriptions || []) {
        await tx
          .insert(tenantSubscriptions)
          .values({
            id: ts.id,
            tenantId: ts.tenantId,
            planCode: ts.planCode,
            billingCycle: ts.billingCycle,
            status: ts.status,
            amountDzd: ts.amountDzd,
            maxStudents: ts.maxStudents,
            maxTeachers: ts.maxTeachers,
            startDate: ts.startDate,
            endDate: ts.endDate,
            invoiceNumber: ts.invoiceNumber,
            paymentMethod: ts.paymentMethod,
            notes: ts.notes ?? null,
            createdBy: ts.createdBy ?? null,
            createdAt: ts.createdAt || nowIso,
            updatedAt: ts.updatedAt || nowIso,
          })
          .onConflictDoUpdate({
            target: tenantSubscriptions.id,
            set: {
              planCode: ts.planCode,
              billingCycle: ts.billingCycle,
              status: ts.status,
              amountDzd: ts.amountDzd,
              maxStudents: ts.maxStudents,
              maxTeachers: ts.maxTeachers,
              startDate: ts.startDate,
              endDate: ts.endDate,
              updatedAt: ts.updatedAt || nowIso,
            },
          });
        tenantSubsCount++;
      }

      const userIds = new Set<string>();
      const courseIds = new Set<string>();
      const moduleIds = new Set<string>();
      const classIds = new Set<string>();
      const sessionIds = new Set<string>();
      const planIds = new Set<string>();
      const subscriptionIds = new Set<string>();

      // 1. Users
      for (const u of dataset.users || []) {
        const uid = (u as any).uid || u.id;
        const tId = u.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(users)
          .values({
            id: u.id,
            tenantId: tId,
            uid,
            name: u.name,
            email: u.email.toLowerCase(),
            role: u.role,
            status: u.status,
            phone: u.phone ?? null,
            avatar: u.avatar ?? null,
            passwordHash: u.passwordHash ?? null,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt || u.createdAt,
          })
          .onConflictDoUpdate({
            target: users.id,
            set: {
              tenantId: tId,
              name: u.name,
              email: u.email.toLowerCase(),
              role: u.role,
              status: u.status,
              phone: u.phone ?? null,
              avatar: u.avatar ?? null,
              passwordHash: u.passwordHash ?? null,
              updatedAt: u.updatedAt || u.createdAt,
            },
          });
        userIds.add(u.id);
      }

      // 2. Student Profiles
      let studentProfilesCount = 0;
      for (const sp of dataset.studentProfiles || []) {
        if (!userIds.has(sp.userId)) continue;
        const tId = sp.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(studentProfiles)
          .values({
            id: sp.id,
            tenantId: tId,
            userId: sp.userId,
            studentIdNumber: sp.studentIdNumber,
            city: sp.city,
            wilaya: sp.wilaya,
            academicLevel: sp.academicLevel,
            administrativeNotes: sp.administrativeNotes ?? null,
            currentClassId: sp.currentClassId ?? null,
          })
          .onConflictDoUpdate({
            target: studentProfiles.id,
            set: {
              tenantId: tId,
              studentIdNumber: sp.studentIdNumber,
              city: sp.city,
              wilaya: sp.wilaya,
              academicLevel: sp.academicLevel,
              administrativeNotes: sp.administrativeNotes ?? null,
              currentClassId: sp.currentClassId ?? null,
            },
          });
        studentProfilesCount++;
      }

      // 3. Teacher Profiles
      let teacherProfilesCount = 0;
      for (const tp of dataset.teacherProfiles || []) {
        if (!userIds.has(tp.userId)) continue;
        const tId = tp.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(teacherProfiles)
          .values({
            id: tp.id,
            tenantId: tId,
            userId: tp.userId,
            employeeId: tp.employeeId,
            specialty: tp.specialty,
            bio: tp.bio ?? null,
            zoomPersonalMeetingId: tp.zoomPersonalMeetingId ?? null,
            assignedClassIds: tp.assignedClassIds || [],
          })
          .onConflictDoUpdate({
            target: teacherProfiles.id,
            set: {
              tenantId: tId,
              employeeId: tp.employeeId,
              specialty: tp.specialty,
              bio: tp.bio ?? null,
              zoomPersonalMeetingId: tp.zoomPersonalMeetingId ?? null,
              assignedClassIds: tp.assignedClassIds || [],
            },
          });
        teacherProfilesCount++;
      }

      // 4. Courses
      for (const c of dataset.courses || []) {
        const tId = c.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(courses)
          .values({
            id: c.id,
            tenantId: tId,
            title: c.title,
            slug: c.slug,
            code: c.code,
            description: c.description,
            coverImage: c.coverImage,
            durationHours: c.durationHours,
            priceDzd: c.priceDzd,
            status: c.status,
            modulesCount: c.modulesCount ?? 0,
            createdAt: c.createdAt,
          })
          .onConflictDoUpdate({
            target: courses.id,
            set: {
              tenantId: tId,
              title: c.title,
              slug: c.slug,
              code: c.code,
              description: c.description,
              coverImage: c.coverImage,
              durationHours: c.durationHours,
              priceDzd: c.priceDzd,
              status: c.status,
              modulesCount: c.modulesCount ?? 0,
            },
          });
        courseIds.add(c.id);
      }

      // 5 & 6. Course Modules & Lesson Resources
      let lessonsCount = 0;
      for (const m of dataset.modules || []) {
        if (!courseIds.has(m.courseId)) continue;
        const tId = m.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(courseModules)
          .values({
            id: m.id,
            tenantId: tId,
            courseId: m.courseId,
            title: m.title,
            orderIndex: m.orderIndex ?? 1,
            description: m.description,
            durationHours: m.durationHours,
          })
          .onConflictDoUpdate({
            target: courseModules.id,
            set: {
              tenantId: tId,
              title: m.title,
              orderIndex: m.orderIndex ?? 1,
              description: m.description,
              durationHours: m.durationHours,
            },
          });
        moduleIds.add(m.id);

        const lessons = m.lessons || [];
        for (let idx = 0; idx < lessons.length; idx++) {
          const les = lessons[idx];
          await tx
            .insert(lessonResources)
            .values({
              id: les.id,
              tenantId: les.tenantId || tId,
              moduleId: m.id,
              title: les.title,
              type: les.type,
              durationMinutes: les.durationMinutes ?? null,
              url: les.url,
              isProtected: Boolean(les.isProtected),
              recordingUrl: les.recordingUrl ?? null,
              orderIndex: idx + 1,
            })
            .onConflictDoUpdate({
              target: lessonResources.id,
              set: {
                tenantId: les.tenantId || tId,
                title: les.title,
                type: les.type,
                durationMinutes: les.durationMinutes ?? null,
                url: les.url,
                isProtected: Boolean(les.isProtected),
                recordingUrl: les.recordingUrl ?? null,
                orderIndex: idx + 1,
              },
            });
          lessonsCount++;
        }
      }

      // 7. Classes
      for (const cls of dataset.classes || []) {
        if (!courseIds.has(cls.courseId) || !userIds.has(cls.teacherId)) continue;
        const tId = cls.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(classes)
          .values({
            id: cls.id,
            tenantId: tId,
            name: cls.name,
            code: cls.code,
            courseId: cls.courseId,
            teacherId: cls.teacherId,
            capacity: cls.capacity,
            enrolledCount: cls.enrolledCount ?? 0,
            startDate: cls.startDate,
            endDate: cls.endDate,
            status: cls.status,
          })
          .onConflictDoUpdate({
            target: classes.id,
            set: {
              tenantId: tId,
              name: cls.name,
              code: cls.code,
              teacherId: cls.teacherId,
              capacity: cls.capacity,
              enrolledCount: cls.enrolledCount ?? 0,
              startDate: cls.startDate,
              endDate: cls.endDate,
              status: cls.status,
            },
          });
        classIds.add(cls.id);
      }

      // 8. Enrollments
      let enrollmentsCount = 0;
      for (const enr of dataset.enrollments || []) {
        if (
          !userIds.has(enr.studentId) ||
          !classIds.has(enr.classId) ||
          !courseIds.has(enr.courseId)
        ) {
          continue;
        }
        const tId = enr.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(enrollments)
          .values({
            id: enr.id,
            tenantId: tId,
            studentId: enr.studentId,
            classId: enr.classId,
            courseId: enr.courseId,
            enrolledAt: enr.enrolledAt,
            status: enr.status,
          })
          .onConflictDoUpdate({
            target: enrollments.id,
            set: { tenantId: tId, status: enr.status, enrolledAt: enr.enrolledAt },
          });
        enrollmentsCount++;
      }

      // 9. Sessions
      for (const ses of dataset.sessions || []) {
        if (
          !courseIds.has(ses.courseId) ||
          !classIds.has(ses.classId) ||
          !userIds.has(ses.teacherId)
        ) {
          continue;
        }
        const tId = ses.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(sessions)
          .values({
            id: ses.id,
            tenantId: tId,
            courseId: ses.courseId,
            classId: ses.classId,
            teacherId: ses.teacherId,
            title: ses.title,
            description: ses.description ?? null,
            scheduledAt: ses.scheduledAt,
            durationMinutes: ses.durationMinutes,
            videoProvider: ses.videoProvider,
            videoMeetingId: ses.videoMeetingId,
            videoJoinUrl: ses.videoJoinUrl,
            videoPasscode: ses.videoPasscode ?? null,
            status: ses.status,
            recordingUrl: ses.recordingUrl ?? null,
            notes: ses.notes ?? null,
            createdAt: ses.createdAt,
          })
          .onConflictDoUpdate({
            target: sessions.id,
            set: {
              tenantId: tId,
              title: ses.title,
              description: ses.description ?? null,
              scheduledAt: ses.scheduledAt,
              durationMinutes: ses.durationMinutes,
              status: ses.status,
              recordingUrl: ses.recordingUrl ?? null,
              notes: ses.notes ?? null,
            },
          });
        sessionIds.add(ses.id);
      }

      // 10. Attendance Records
      let attendanceCount = 0;
      for (const att of dataset.attendanceRecords || []) {
        if (
          !sessionIds.has(att.sessionId) ||
          !userIds.has(att.studentId) ||
          !userIds.has(att.markedBy)
        ) {
          continue;
        }
        const tId = att.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(attendanceRecords)
          .values({
            id: att.id,
            tenantId: tId,
            sessionId: att.sessionId,
            studentId: att.studentId,
            status: att.status,
            minutesLate: att.minutesLate ?? null,
            teacherComment: att.teacherComment ?? null,
            markedBy: att.markedBy,
            markedAt: att.markedAt,
            updatedAt: att.updatedAt || att.markedAt,
          })
          .onConflictDoUpdate({
            target: [attendanceRecords.sessionId, attendanceRecords.studentId],
            set: {
              tenantId: tId,
              status: att.status,
              minutesLate: att.minutesLate ?? null,
              teacherComment: att.teacherComment ?? null,
              markedBy: att.markedBy,
              updatedAt: att.updatedAt || att.markedAt,
            },
          });
        attendanceCount++;
      }

      // 11. Subscription Plans
      for (const pl of dataset.subscriptionPlans || []) {
        const tId = pl.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(subscriptionPlans)
          .values({
            id: pl.id,
            tenantId: tId,
            name: pl.name,
            code: pl.code,
            durationMonths: pl.durationMonths,
            priceDzd: pl.priceDzd,
            description: pl.description,
            includesLiveSessions: Boolean(pl.includesLiveSessions),
            includesRecordings: Boolean(pl.includesRecordings),
          })
          .onConflictDoUpdate({
            target: subscriptionPlans.id,
            set: {
              tenantId: tId,
              name: pl.name,
              priceDzd: pl.priceDzd,
              description: pl.description,
            },
          });
        planIds.add(pl.id);
      }

      // 12. Subscriptions
      for (const sub of dataset.subscriptions || []) {
        if (
          !userIds.has(sub.studentId) ||
          !courseIds.has(sub.courseId) ||
          !planIds.has(sub.planId)
        ) {
          continue;
        }
        const tId = sub.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(subscriptions)
          .values({
            id: sub.id,
            tenantId: tId,
            studentId: sub.studentId,
            courseId: sub.courseId,
            planId: sub.planId,
            startDate: sub.startDate,
            endDate: sub.endDate,
            status: sub.status,
            paymentId: sub.paymentId ?? null,
            notes: sub.notes ?? null,
            createdAt: sub.createdAt,
          })
          .onConflictDoUpdate({
            target: subscriptions.id,
            set: {
              tenantId: tId,
              startDate: sub.startDate,
              endDate: sub.endDate,
              status: sub.status,
              paymentId: sub.paymentId ?? null,
              notes: sub.notes ?? null,
            },
          });
        subscriptionIds.add(sub.id);
      }

      // 13. Payments
      let paymentsCount = 0;
      for (const pay of dataset.payments || []) {
        if (!userIds.has(pay.studentId) || !courseIds.has(pay.courseId)) continue;
        const validSubId =
          pay.subscriptionId && subscriptionIds.has(pay.subscriptionId)
            ? pay.subscriptionId
            : null;
        const validConfirmedBy =
          pay.confirmedBy && userIds.has(pay.confirmedBy) ? pay.confirmedBy : null;
        const tId = pay.tenantId || DEFAULT_TENANT_ID;

        const [insertedSeedPay] = await tx
          .insert(payments)
          .values({
            id: pay.id,
            tenantId: tId,
            receiptNumber: pay.receiptNumber,
            studentId: pay.studentId,
            courseId: pay.courseId,
            subscriptionId: validSubId,
            amountDzd: pay.amountDzd,
            currency: pay.currency || 'DZD',
            paymentMethod: pay.paymentMethod,
            transactionReference: pay.transactionReference,
            paymentDate: pay.paymentDate,
            status: pay.status,
            receiptAttachment: pay.receiptAttachment ?? null,
            confirmedBy: validConfirmedBy,
            confirmedAt: pay.confirmedAt ?? null,
            administrativeNotes: pay.administrativeNotes ?? null,
            createdAt: pay.createdAt,
          })
          .onConflictDoUpdate({
            target: payments.id,
            set: {
              tenantId: tId,
              subscriptionId: validSubId,
              amountDzd: pay.amountDzd,
              status: pay.status,
              confirmedBy: validConfirmedBy,
              confirmedAt: pay.confirmedAt ?? null,
              administrativeNotes: pay.administrativeNotes ?? null,
            },
          })
          .returning();
        paymentsCount++;

        if (insertedSeedPay && insertedSeedPay.status === 'CONFIRMED') {
          await runWithTenantContext({ tenantId: tId }, () =>
            issueSequentialInvoiceInTx(tx, insertedSeedPay)
          );
        }
      }

      // 14. Active Sessions
      let activeSessionsCount = 0;
      for (const s of dataset.activeSessions || []) {
        if (!userIds.has(s.userId)) continue;
        const tId = s.tenantId || DEFAULT_TENANT_ID;
        const csrfTok = s.csrfToken || `csrf_${crypto.randomBytes(24).toString('hex')}`;
        const rotatedIso = s.rotatedAt || s.lastActiveAt || s.createdAt;
        const absExpiresIso = s.absoluteExpiresAt || s.expiresAt;
        await tx
          .insert(activeSessions)
          .values({
            id: s.id,
            tenantId: tId,
            userId: s.userId,
            token: s.token,
            csrfToken: csrfTok,
            deviceName: s.deviceName,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            createdAt: s.createdAt,
            lastActiveAt: s.lastActiveAt,
            rotatedAt: rotatedIso,
            expiresAt: s.expiresAt,
            absoluteExpiresAt: absExpiresIso,
            revokedAt: s.revokedAt ?? null,
            revokedReason: s.revokedReason ?? null,
          })
          .onConflictDoUpdate({
            target: activeSessions.id,
            set: {
              tenantId: tId,
              lastActiveAt: s.lastActiveAt,
              revokedAt: s.revokedAt ?? null,
              revokedReason: s.revokedReason ?? null,
            },
          });
        activeSessionsCount++;
      }

      // 15. Notifications
      let notificationsCount = 0;
      for (const n of dataset.notifications || []) {
        if (!userIds.has(n.userId)) continue;
        const tId = n.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(notifications)
          .values({
            id: n.id,
            tenantId: tId,
            userId: n.userId,
            title: n.title,
            message: n.message,
            type: n.type,
            link: n.link ?? null,
            read: Boolean(n.read),
            createdAt: n.createdAt,
          })
          .onConflictDoUpdate({
            target: notifications.id,
            set: { tenantId: tId, read: Boolean(n.read), message: n.message },
          });
        notificationsCount++;
      }

      // 16. Audit Logs
      let auditLogsCount = 0;
      for (const log of dataset.auditLogs || []) {
        const tId = log.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(auditLogs)
          .values({
            id: log.id,
            tenantId: tId,
            userId: log.userId,
            userEmail: log.userEmail,
            userRole: log.userRole,
            action: log.action,
            entity: log.entity,
            entityId: log.entityId ?? null,
            details: log.details,
            ipAddress: log.ipAddress,
            timestamp: log.timestamp,
          })
          .onConflictDoNothing();
        auditLogsCount++;
      }

      // 17. Integration Settings
      let integrationsCount = 0;
      for (const cfg of dataset.integrationSettings || []) {
        const tId = cfg.tenantId || DEFAULT_TENANT_ID;
        await tx
          .insert(integrationSettings)
          .values({
            id: cfg.id,
            tenantId: tId,
            provider: cfg.provider,
            isEnabled: Boolean(cfg.isEnabled),
            isTestMode: Boolean(cfg.isTestMode),
            config: cfg.config || {},
            updatedAt: cfg.updatedAt,
          })
          .onConflictDoUpdate({
            target: integrationSettings.id,
            set: {
              tenantId: tId,
              isEnabled: Boolean(cfg.isEnabled),
              isTestMode: Boolean(cfg.isTestMode),
              config: cfg.config || {},
              updatedAt: cfg.updatedAt,
            },
          });
        integrationsCount++;
      }

      return {
        counts: {
          tenants: tenantsCount,
          tenantSubscriptions: tenantSubsCount,
          users: userIds.size,
          studentProfiles: studentProfilesCount,
          teacherProfiles: teacherProfilesCount,
          courses: courseIds.size,
          courseModules: moduleIds.size,
          lessonResources: lessonsCount,
          classes: classIds.size,
          enrollments: enrollmentsCount,
          sessions: sessionIds.size,
          attendanceRecords: attendanceCount,
          subscriptionPlans: planIds.size,
          subscriptions: subscriptionIds.size,
          payments: paymentsCount,
          activeSessions: activeSessionsCount,
          notifications: notificationsCount,
          auditLogs: auditLogsCount,
          integrationSettings: integrationsCount,
        },
      };
    });
  } catch (error) {
    console.error('importDatasetTransaction failed and rolled back:', error);
    throw new Error('Échec de l importation transactionnelle des données vers PostgreSQL.', {
      cause: error,
    });
  }
}

export async function resetDatabaseToSeed(): Promise<void> {
  const demoSeed = await getDemoSeedDataset();
  await importDatasetTransaction(demoSeed, { clearExisting: true });
}

// =============================================================================
// REPOSITORY QUERY HELPERS (AUTOMATICALLY SCOPED BY TENANT CONTEXT `tdb`)
// =============================================================================

export async function getModulesWithLessonsForCourse(courseId?: string): Promise<CourseModule[]> {
  try {
    const modRows = await tdb.selectMany(courseModules, {
      where: courseId ? eq(courseModules.courseId, courseId) : undefined,
      orderBy: asc(courseModules.orderIndex),
    });

    const lessonRows = await tdb.selectMany(lessonResources, {
      orderBy: asc(lessonResources.orderIndex),
    });

    const lessonsByModule = new Map<string, LessonResource[]>();
    for (const row of lessonRows) {
      const list = lessonsByModule.get(row.moduleId) || [];
      list.push(mapLessonRow(row));
      lessonsByModule.set(row.moduleId, list);
    }

    return modRows.map((m) => ({
      id: m.id,
      tenantId: m.tenantId,
      courseId: m.courseId,
      title: m.title,
      orderIndex: m.orderIndex,
      description: m.description,
      durationHours: m.durationHours,
      lessons: lessonsByModule.get(m.id) || [],
    }));
  } catch (error) {
    console.error('getModulesWithLessonsForCourse failed:', error);
    throw new Error('Impossible de charger les modules pédagogiques.', { cause: error });
  }
}

export async function getIntegrationByProvider(
  provider: IntegrationSetting['provider']
): Promise<IntegrationSetting | null> {
  try {
    const row = await tdb.findFirst(
      integrationSettings,
      eq(integrationSettings.provider, provider)
    );
    return row ? mapIntegrationSettingRow(row) : null;
  } catch (error) {
    console.error('getIntegrationByProvider failed:', error);
    return null;
  }
}
