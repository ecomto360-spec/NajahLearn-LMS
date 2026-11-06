/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { eq, and, desc, asc, isNull, lte, gte, inArray, ne } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
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
  passwordResetTokensTable,
  uploadedFiles,
  installmentItems,
  invoices,
  emailQueue,
  type TenantSettingsJson,
} from '../src/db/schema.ts';
import {
  verifyPasswordWithMigrationInfo,
  hashPassword,
  sanitizeUser,
  sanitizeSessionForClient,
  verifyStudentAccess,
  confirmPaymentTransaction,
  resetDatabaseToSeed,
  ensureSeededIfEmpty,
  getModulesWithLessonsForCourse,
  mapUserRow,
  mapStudentProfileRow,
  mapTeacherProfileRow,
  mapCourseRow,
  mapClassRow,
  mapSessionRow,
  mapAttendanceRow,
  mapSubscriptionRow,
  mapPaymentRow,
  mapActiveSessionRow,
  mapNotificationRow,
  mapAuditLogRow,
  mapIntegrationSettingRow,
  mapUploadedFileRow,
} from './db.ts';
import {
  tdb,
  getCurrentTenantId,
  getCurrentTenant,
  getTenantById,
  getTenantBySlug,
  mapTenantRow,
  toTenantPublicSummary,
  mapTenantSubscriptionRow,
  checkTenantOperationalAccess,
  resolvePublicTenantContext,
  runWithTenantContext,
  DEFAULT_TENANT_SETTINGS,
} from './tenantContext.ts';
import {
  createSession,
  rotateSession,
  authenticateToken,
  requireRole,
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  consumeIpEndpointRateLimit,
  extractClientIp,
  hashTokenSha256,
  setSessionCookies,
  clearSessionCookies,
  issuePreAuthCsrfToken,
  type AuthenticatedRequest,
} from './auth.ts';
import {
  validatePasswordPolicy,
  generateCompliantTemporaryPassword,
} from './passwordPolicy.ts';
import {
  validateRequest,
  validateParamsAndQuery,
  idParamSchema,
  sessionIdParamSchema,
  providerParamSchema,
  courseLessonParamSchema,
  checkoutIdParamSchema,
  webhookTenantSlugParamSchema,
  loginBodySchema,
  firebaseLoginBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  changePasswordBodySchema,
  demoSwitchBodySchema,
  updateLanguagePreferenceBodySchema,
  studentsQuerySchema,
  createStudentBodySchema,
  updateStudentStatusBodySchema,
  importCsvBodySchema,
  createClassBodySchema,
  sessionsQuerySchema,
  createSessionBodySchema,
  updateSessionBodySchema,
  saveAttendanceBodySchema,
  createPaymentBodySchema,
  confirmPaymentBodySchema,
  refundPaymentBodySchema,
  createChargilyCheckoutBodySchema,
  simulateChargilySandboxBodySchema,
  chargilyWebhookBodySchema,
  installmentsQuerySchema,
  createInstallmentPlanBodySchema,
  runRemindersBodySchema,
  invoicesQuerySchema,
  subscriptionsQuerySchema,
  auditLogsQuerySchema,
  updateIntegrationBodySchema,
  uploadMetadataBodySchema,
  uploadsListQuerySchema,
  publicTenantQuerySchema,
  updateTenantBrandingBodySchema,
  createTenantBodySchema,
  updateSuperAdminTenantBodySchema,
  createTenantSubscriptionBodySchema,
  notificationsQuerySchema,
  updateNotificationPreferencesBodySchema,
  emailQueueQuerySchema,
  processEmailQueueBodySchema,
  runEmailSweepsBodySchema,
  sendTestEmailBodySchema,
} from './validation.ts';
import {
  escapeCsvCell,
  parseCsvLine,
  sanitizeCsvImportCell,
  csvStudentRowZodSchema,
} from './csvSecurity.ts';
import {
  validateMultipartUpload,
  persistValidatedFileToPrivateStorage,
  resolveSafePrivateFilePath,
} from './uploads.ts';
import { adminAuth } from '../src/lib/firebase-admin.ts';
import { getOrCreateUser } from '../src/db/users.ts';
import { scheduleMeeting } from './zoom.ts';
import { runAutomatedTestSuite } from './testRunner.ts';
import {
  maskIntegrationConfigForClient,
  createChargilyCheckout,
  processChargilyWebhook,
  simulateChargilySandboxEvent,
  refundPaymentTransaction,
  createInstallmentPlan,
  listInstallmentPlansScoped,
  runAutomatedPaymentRemindersForTenant,
  listPaymentRemindersScoped,
  listInvoicesScoped,
  getInvoiceByIdScoped,
} from './billing.ts';
import {
  dispatchTransactionalNotification,
  getUserNotificationPreferences,
  upsertUserNotificationPreferences,
  ensureSmtpIntegrationRow,
  getSmtpResolvedConfig,
  processEmailQueueBatch,
  retryEmailQueueItem,
  listEmailQueueScoped,
  mapEmailQueueRow,
  runExpiringSubscriptionsSweepForTenant,
  runSessionRemindersSweepForTenant,
} from './emailService.ts';
import { generateInvoicePdfBuffer } from './invoicePdf.ts';
import type {
  AttendanceStatus,
  CourseModule,
  EmailTemplateType,
  NotificationCategory,
  SuperAdminOverviewStats,
  SuperAdminTenantSummary,
  Tenant,
  UserRole,
} from '../src/types/index.ts';

export const apiRouter = Router();

function extractRequestOrigin(req: Request): string {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('host');
  return (host ? `${proto}://${host}` : process.env.APP_URL || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );
}

const ALL_AUTHENTICATED_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'TEACHER',
  'STUDENT',
];

// Lazy on-demand initialization middleware (executes once when first HTTP request arrives if DB is empty)
apiRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureSeededIfEmpty();
    next();
  } catch (error: any) {
    console.error('Database initialization error on request:', error);
    res.status(503).json({
      error: 'DATABASE_UNAVAILABLE',
      message: error.message || 'Service de base de données temporairement indisponible.',
    });
  }
});

/**
 * Logs blocked IDOR / cross-ownership attempts into the immutable PostgreSQL audit trail
 * automatically scoped to the active tenant via `tdb`.
 */
async function logBlockedOwnershipAttempt(
  req: AuthenticatedRequest,
  entity: string,
  entityId: string | undefined,
  details: string
): Promise<void> {
  if (!req.user) return;
  try {
    await tdb.insertOne(auditLogs, {
      id: `log_${crypto.randomUUID()}`,
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'SECURITY_IDOR_BLOCKED',
      entity,
      entityId: entityId ?? null,
      details,
      ipAddress: extractClientIp(req),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to record SECURITY_IDOR_BLOCKED audit log:', err);
  }
}

/**
 * Redacts protected URLs on public syllabus endpoints so raw protected links are never leaked
 * without passing through authenticated ownership & subscription checks.
 */
function redactProtectedLessonsForPublicView(modules: CourseModule[]): CourseModule[] {
  return modules.map((mod) => ({
    ...mod,
    lessons: (mod.lessons || []).map((les) => ({
      ...les,
      url: les.isProtected ? '[PROTECTED_RESOURCE]' : les.url,
      recordingUrl: les.isProtected ? undefined : les.recordingUrl,
    })),
  }));
}

/**
 * Builds receipt-ready establishment branding metadata for printable official receipts.
 */
function buildReceiptTenantMetadata(tenant: Tenant | null) {
  if (!tenant) return undefined;
  return {
    ...toTenantPublicSummary(tenant),
    taxId: tenant.taxId || (tenant.nif ? `NIF ${tenant.nif}` : undefined),
    nif: tenant.nif,
    nis: tenant.nis,
    rc: tenant.rc,
    articleImposition: tenant.articleImposition,
    tvaApplicable: tenant.tvaApplicable,
    tvaRatePercent: tenant.tvaRatePercent,
    invoicePrefix: tenant.invoicePrefix,
    receiptPrefix: tenant.settings.receiptPrefix,
    receiptFooterNote: tenant.settings.receiptFooterNote,
  };
}

// =============================================================================
// PUBLIC MULTI-TENANT DISCOVERY & ESTABLISHMENT PORTAL ENDPOINTS
// =============================================================================

apiRouter.get('/tenants/public', validateRequest(), async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(tenants)
      .where(ne(tenants.status, 'ARCHIVED'))
      .orderBy(asc(tenants.createdAt));

    return res.json({
      tenants: rows.map((r) => toTenantPublicSummary(mapTenantRow(r))),
    });
  } catch (error: any) {
    console.error('GET /tenants/public error:', error);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Impossible de charger la liste des établissements.',
    });
  }
});

apiRouter.get(
  '/tenants/current',
  validateRequest({ query: publicTenantQuerySchema }),
  resolvePublicTenantContext,
  async (_req: Request, res: Response) => {
    try {
      const tenant = await getCurrentTenant();
      if (!tenant) {
        return res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: 'Établissement introuvable.',
        });
      }
      return res.json({ tenant: toTenantPublicSummary(tenant) });
    } catch (error: any) {
      console.error('GET /tenants/current error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de résoudre l identité de l établissement.',
      });
    }
  }
);

// =============================================================================
// AUTHENTICATION, SESSIONS, CSRF & PASSWORD LIFECYCLE
// =============================================================================

apiRouter.get('/auth/csrf', validateRequest(), (req: Request, res: Response) => {
  const csrfToken = issuePreAuthCsrfToken(req, res);
  return res.json({ csrfToken });
});

apiRouter.post(
  '/auth/login',
  validateRequest({ body: loginBodySchema }),
  async (req: Request, res: Response) => {
    try {
      const { email: normalizedEmail, password, expectedRole } = req.body as {
        email: string;
        password: string;
        expectedRole?: 'SUPER_ADMIN' | 'ADMIN' | 'TEACHER' | 'STUDENT';
      };
      const ipAddress = extractClientIp(req);

      // Persistent rate limiting by IP and by Account (PostgreSQL)
      const rateCheck = await checkLoginRateLimit(normalizedEmail, ipAddress);
      if (rateCheck.isLocked) {
        const retrySec = rateCheck.remainingLockoutSeconds || 900;
        res.setHeader('Retry-After', String(retrySec));
        return res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          lockedBy: rateCheck.lockedBy,
          retryAfterSeconds: retrySec,
          message:
            rateCheck.lockedBy === 'IP'
              ? `Trop de tentatives depuis cette adresse IP. Réessayez dans ${retrySec} secondes.`
              : `Trop de tentatives échouées sur ce compte. Verrouillage temporaire de ${retrySec} secondes par sécurité.`,
        });
      }

      const [userRow] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      const pwdVerification =
        userRow && userRow.passwordHash
          ? await verifyPasswordWithMigrationInfo(password, userRow.passwordHash)
          : { valid: false, needsRehash: false, algorithm: 'invalid' as const };

      if (!userRow || !pwdVerification.valid) {
        await recordLoginFailure(normalizedEmail, ipAddress);
        return res.status(401).json({
          error: 'INVALID_CREDENTIALS',
          message: 'Adresse e-mail ou mot de passe incorrect.',
        });
      }

      const user = mapUserRow(userRow);

      if (user.status !== 'ACTIVE') {
        return res.status(403).json({
          error: 'ACCOUNT_SUSPENDED',
          message: `Votre compte a été ${user.status === 'SUSPENDED' ? 'suspendu' : 'archivé'} par l'administration de l'école.`,
        });
      }

      const userTenant = await getTenantById(user.tenantId);

      // Enforce Establishment & SaaS Subscription Operational Access (except SUPER_ADMIN)
      if (user.role !== 'SUPER_ADMIN') {
        const tenantCheck = checkTenantOperationalAccess(userTenant);
        if (!tenantCheck.allowed) {
          return res.status(403).json({
            error: tenantCheck.errorCode || 'TENANT_SUSPENDED',
            message:
              tenantCheck.message ||
              "L'accès à cet établissement est temporairement suspendu.",
          });
        }
      }

      if (expectedRole) {
        let matches = false;
        if (expectedRole === 'SUPER_ADMIN' && user.role === 'SUPER_ADMIN') {
          matches = true;
        } else if (
          expectedRole === 'ADMIN' &&
          (user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'SUPER_ADMIN')
        ) {
          matches = true;
        } else if (expectedRole === 'TEACHER' && user.role === 'TEACHER') {
          matches = true;
        } else if (expectedRole === 'STUDENT' && user.role === 'STUDENT') {
          matches = true;
        }

        if (!matches) {
          let actualRoleLabel = 'Étudiant';
          if (user.role === 'SUPER_ADMIN') actualRoleLabel = 'Super Administrateur SaaS';
          else if (user.role === 'ADMIN' || user.role === 'MANAGER')
            actualRoleLabel = 'Administrateur';
          else if (user.role === 'TEACHER') actualRoleLabel = 'Enseignant';

          let expectedLabel = 'Espace Administration';
          if (expectedRole === 'SUPER_ADMIN') expectedLabel = 'Console Super Admin SaaS';
          else if (expectedRole === 'TEACHER') expectedLabel = 'Espace Enseignant';
          else if (expectedRole === 'STUDENT') expectedLabel = 'Espace Étudiant';

          return res.status(403).json({
            error: 'ROLE_MISMATCH',
            message: `Accès refusé : vous essayez de vous connecter à l'${expectedLabel} avec un compte configuré comme "${actualRoleLabel}". Veuillez sélectionner l'onglet correspondant à votre profil.`,
          });
        }
      }

      // Transparent migration from legacy PBKDF2 / scrypt / weaker Argon2 to Argon2id
      if (pwdVerification.needsRehash) {
        const upgradedHash = await hashPassword(password);
        const nowIso = new Date().toISOString();
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({ passwordHash: upgradedHash, updatedAt: nowIso })
            .where(and(eq(users.id, user.id), eq(users.tenantId, user.tenantId)));

          await tx.insert(auditLogs).values({
            id: `log_${crypto.randomUUID()}`,
            tenantId: user.tenantId,
            userId: user.id,
            userEmail: user.email,
            userRole: user.role,
            action: 'PASSWORD_HASH_MIGRATED_ARGON2ID',
            entity: 'User',
            entityId: user.id,
            details: `Migration transparente du hachage historique (${pwdVerification.algorithm}) vers Argon2id à la connexion.`,
            ipAddress,
            timestamp: nowIso,
          });
        });
      }

      await recordLoginSuccess(normalizedEmail);
      const { token, csrfToken, session } = await createSession(user, req);
      setSessionCookies(req, res, token, csrfToken, session.expiresAt);
      res.setHeader('X-Tenant-Id', user.tenantId);

      const { studentProfile, teacherProfile } = await runWithTenantContext(
        { tenantId: user.tenantId, userId: user.id, userRole: user.role },
        async () => {
          let sp = null;
          let tp = null;
          if (user.role === 'STUDENT') {
            const row = await tdb.findFirst(studentProfiles, eq(studentProfiles.userId, user.id));
            sp = row ? mapStudentProfileRow(row) : null;
          } else if (user.role === 'TEACHER') {
            const row = await tdb.findFirst(teacherProfiles, eq(teacherProfiles.userId, user.id));
            tp = row ? mapTeacherProfileRow(row) : null;
          }
          return { studentProfile: sp, teacherProfile: tp };
        }
      );

      return res.json({
        user: sanitizeUser(user),
        tenant: userTenant ? toTenantPublicSummary(userTenant) : undefined,
        fullTenant:
          user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? userTenant : undefined,
        csrfToken,
        session: sanitizeSessionForClient(session),
        studentProfile,
        teacherProfile,
      });
    } catch (error: any) {
      console.error('Login error:', error);
      return res
        .status(500)
        .json({ error: 'LOGIN_ERROR', message: error.message || 'Erreur lors de la connexion.' });
    }
  }
);

// Firebase Google Sign-In synchronization endpoint
apiRouter.post(
  '/auth/firebase-login',
  validateRequest({ body: firebaseLoginBodySchema }),
  resolvePublicTenantContext,
  async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers['authorization'];
      const idToken =
        (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null) ||
        req.body?.idToken;

      if (!idToken) {
        return res.status(401).json({
          error: 'MISSING_ID_TOKEN',
          message: 'Jeton Google / Firebase manquant.',
        });
      }

      const decoded = await adminAuth.verifyIdToken(idToken);
      if (!decoded.email) {
        return res.status(400).json({
          error: 'EMAIL_REQUIRED',
          message: 'Une adresse e-mail vérifiée est requise pour se connecter.',
        });
      }

      const syncedRow = await getOrCreateUser(
        decoded.uid,
        decoded.email,
        decoded.name,
        decoded.picture
      );
      const user = mapUserRow(syncedRow);

      if (user.status !== 'ACTIVE') {
        return res.status(403).json({
          error: 'ACCOUNT_SUSPENDED',
          message: 'Votre compte a été suspendu ou archivé par l administration.',
        });
      }

      const userTenant = await getTenantById(user.tenantId);
      if (user.role !== 'SUPER_ADMIN') {
        const tenantCheck = checkTenantOperationalAccess(userTenant);
        if (!tenantCheck.allowed) {
          return res.status(403).json({
            error: tenantCheck.errorCode || 'TENANT_SUSPENDED',
            message:
              tenantCheck.message || 'Établissement suspendu ou abonnement expiré.',
          });
        }
      }

      const { token, csrfToken, session } = await createSession(user, req);
      setSessionCookies(req, res, token, csrfToken, session.expiresAt);
      res.setHeader('X-Tenant-Id', user.tenantId);

      const { studentProfile, teacherProfile } = await runWithTenantContext(
        { tenantId: user.tenantId, userId: user.id, userRole: user.role },
        async () => {
          let sp = null;
          let tp = null;
          if (user.role === 'STUDENT') {
            const row = await tdb.findFirst(studentProfiles, eq(studentProfiles.userId, user.id));
            sp = row ? mapStudentProfileRow(row) : null;
          } else if (user.role === 'TEACHER') {
            const row = await tdb.findFirst(teacherProfiles, eq(teacherProfiles.userId, user.id));
            tp = row ? mapTeacherProfileRow(row) : null;
          }
          return { studentProfile: sp, teacherProfile: tp };
        }
      );

      return res.json({
        user: sanitizeUser(user),
        tenant: userTenant ? toTenantPublicSummary(userTenant) : undefined,
        fullTenant:
          user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? userTenant : undefined,
        csrfToken,
        session: sanitizeSessionForClient(session),
        studentProfile,
        teacherProfile,
      });
    } catch (error: any) {
      console.error('Firebase login error:', error);
      return res.status(401).json({
        error: 'FIREBASE_AUTH_FAILED',
        message: 'Échec de l authentification Google.',
      });
    }
  }
);

apiRouter.post(
  '/auth/forgot-password',
  validateRequest({ body: forgotPasswordBodySchema }),
  async (req: Request, res: Response) => {
    try {
      const ipAddress = extractClientIp(req);
      const ipRate = await consumeIpEndpointRateLimit(ipAddress);
      if (!ipRate.allowed) {
        res.setHeader('Retry-After', String(ipRate.remainingLockoutSeconds));
        return res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          retryAfterSeconds: ipRate.remainingLockoutSeconds,
          message:
            'Trop de demandes de réinitialisation depuis cette adresse IP. Veuillez patienter.',
        });
      }

      const { email: normalizedEmail } = req.body as { email: string };
      const [userRow] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      let isEmailConfigured = Boolean(process.env.SMTP_HOST || process.env.EMAIL_API_KEY);
      let resetToken: string | undefined = undefined;

      if (userRow && userRow.status === 'ACTIVE') {
        const smtpCfg = await getSmtpResolvedConfig(userRow.tenantId);
        if (smtpCfg.hasLiveSmtpTransport && smtpCfg.isEnabled) {
          isEmailConfigured = true;
        }

        resetToken = `rst_${crypto.randomBytes(32).toString('hex')}`;
        const tokenHash = hashTokenSha256(resetToken);
        const nowIso = new Date().toISOString();
        const expiresAtIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        await db.transaction(async (tx) => {
          await tx.insert(passwordResetTokensTable).values({
            id: `prt_${crypto.randomUUID()}`,
            tenantId: userRow.tenantId,
            userId: userRow.id,
            tokenHash,
            expiresAt: expiresAtIso,
            createdAt: nowIso,
          });

          await tx.insert(auditLogs).values({
            id: `log_${crypto.randomUUID()}`,
            tenantId: userRow.tenantId,
            userId: userRow.id,
            userEmail: userRow.email,
            userRole: userRow.role,
            action: 'PASSWORD_RESET_REQUESTED',
            entity: 'User',
            entityId: userRow.id,
            details: `Demande de réinitialisation de mot de passe initiée pour ${userRow.email}.`,
            ipAddress,
            timestamp: nowIso,
          });
        });

        await dispatchTransactionalNotification({
          tenantId: userRow.tenantId,
          userId: userRow.id,
          recipientEmail: userRow.email,
          recipientName: userRow.name,
          preferredLocale: userRow.preferredLanguage === 'ar' ? 'ar' : 'fr',
          templateType: 'PASSWORD_RESET',
          appOrigin: extractRequestOrigin(req),
          variables: {
            resetToken,
            expiresMinutes: 60,
          },
        }).catch((err) => {
          console.warn('[NajahLearn SMTP] Password reset email enqueue warning:', err);
        });
      }

      return res.json({
        success: true,
        message:
          'Si cette adresse e-mail correspond à un compte actif, la procédure de réinitialisation a été enclenchée.',
        isEmailConfigured,
        notice: !isEmailConfigured
          ? "Le serveur d'envoi d'e-mails (SMTP) est en mode Sandbox/Test. L'e-mail HTML a été enregistré dans la file d'attente transactionnelle et vous pouvez utiliser le jeton sécurisé ci-dessous."
          : 'Un lien de réinitialisation sécurisé à usage unique vous a été envoyé par messagerie.',
        testToken: !isEmailConfigured ? resetToken : undefined,
      });
    } catch (error: any) {
      console.error('Forgot password error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur interne.' });
    }
  }
);

apiRouter.post(
  '/auth/reset-password',
  validateRequest({ body: resetPasswordBodySchema }),
  async (req: Request, res: Response) => {
    try {
      const ipAddress = extractClientIp(req);
      const ipRate = await consumeIpEndpointRateLimit(ipAddress);
      if (!ipRate.allowed) {
        res.setHeader('Retry-After', String(ipRate.remainingLockoutSeconds));
        return res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          retryAfterSeconds: ipRate.remainingLockoutSeconds,
          message: 'Trop de tentatives de réinitialisation depuis cette adresse IP.',
        });
      }

      const { token, newPassword } = req.body as { token: string; newPassword: string };

      const tokenHash = hashTokenSha256(token.trim());
      const [record] = await db
        .select()
        .from(passwordResetTokensTable)
        .where(eq(passwordResetTokensTable.tokenHash, tokenHash))
        .limit(1);

      if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= Date.now()) {
        return res.status(400).json({
          error: 'INVALID_OR_EXPIRED_TOKEN',
          message: 'Ce lien de réinitialisation est invalide ou a expiré.',
        });
      }

      const [userRow] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, record.userId), eq(users.tenantId, record.tenantId)))
        .limit(1);

      if (!userRow) {
        return res
          .status(404)
          .json({ error: 'USER_NOT_FOUND', message: 'Compte utilisateur introuvable.' });
      }

      const policy = validatePasswordPolicy(newPassword, {
        email: userRow.email,
        name: userRow.name,
      });
      if (!policy.valid) {
        return res.status(400).json({
          error: 'WEAK_PASSWORD',
          errors: policy.errors,
          message: policy.errors.join(' '),
        });
      }

      const now = new Date().toISOString();
      const newHash = await hashPassword(newPassword);

      await db.transaction(async (tx) => {
        await tx
          .update(passwordResetTokensTable)
          .set({ usedAt: now })
          .where(eq(passwordResetTokensTable.id, record.id));

        await tx
          .update(users)
          .set({ passwordHash: newHash, updatedAt: now })
          .where(and(eq(users.id, userRow.id), eq(users.tenantId, userRow.tenantId)));

        await tx
          .update(activeSessions)
          .set({
            revokedAt: now,
            revokedReason: 'MOT_DE_PASSE_REINITIALISE',
          })
          .where(
            and(
              eq(activeSessions.tenantId, userRow.tenantId),
              eq(activeSessions.userId, userRow.id),
              isNull(activeSessions.revokedAt)
            )
          );

        await tx.insert(auditLogs).values({
          id: `log_${crypto.randomUUID()}`,
          tenantId: userRow.tenantId,
          userId: userRow.id,
          userEmail: userRow.email,
          userRole: userRow.role,
          action: 'PASSWORD_RESET_COMPLETED',
          entity: 'User',
          entityId: userRow.id,
          details:
            'Réinitialisation de mot de passe (Argon2id) réussie. Toutes les sessions actives ont été révoquées.',
          ipAddress,
          timestamp: now,
        });
      });

      clearSessionCookies(req, res);

      return res.json({
        success: true,
        message:
          'Votre mot de passe a été réinitialisé avec succès. Toutes vos anciennes sessions ont été révoquées par sécurité. Vous pouvez maintenant vous connecter.',
      });
    } catch (error: any) {
      console.error('Reset password error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur interne.' });
    }
  }
);

apiRouter.post(
  '/auth/change-password',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ body: changePasswordBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };

      const userRow = await tdb.findFirst(users, eq(users.id, req.user!.id));

      if (!userRow || !userRow.passwordHash) {
        return res.status(400).json({
          error: 'PASSWORD_CHANGE_UNSUPPORTED',
          message: 'Ce compte utilise exclusivement l authentification externe.',
        });
      }

      const currentValid = await verifyPasswordWithMigrationInfo(
        currentPassword,
        userRow.passwordHash
      );
      if (!currentValid.valid) {
        return res.status(401).json({
          error: 'INVALID_CURRENT_PASSWORD',
          message: 'Le mot de passe actuel est incorrect.',
        });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({
          error: 'WEAK_PASSWORD',
          errors: ['Le nouveau mot de passe doit être différent de l ancien mot de passe.'],
          message: 'Le nouveau mot de passe doit être différent de l ancien mot de passe.',
        });
      }

      const policy = validatePasswordPolicy(newPassword, {
        email: userRow.email,
        name: userRow.name,
      });
      if (!policy.valid) {
        return res.status(400).json({
          error: 'WEAK_PASSWORD',
          errors: policy.errors,
          message: policy.errors.join(' '),
        });
      }

      const nowIso = new Date().toISOString();
      const newHash = await hashPassword(newPassword);

      await db.transaction(async (tx) => {
        const txDb = tdb.forTx(tx);
        await txDb.updateWhere(users, { passwordHash: newHash, updatedAt: nowIso }, eq(users.id, userRow.id));

        if (req.sessionRecord) {
          await txDb.updateWhere(
            activeSessions,
            {
              revokedAt: nowIso,
              revokedReason: 'MOT_DE_PASSE_MODIFIE',
            },
            and(
              eq(activeSessions.userId, userRow.id),
              ne(activeSessions.id, req.sessionRecord.id),
              isNull(activeSessions.revokedAt)
            )!
          );
        }
      });

      let rotatedCsrf: string | undefined = req.csrfToken;
      if (req.sessionRecord) {
        const rotated = await rotateSession(req.sessionRecord.id, req, res, {
          auditReason: 'Rotation de session après changement de mot de passe.',
        });
        rotatedCsrf = rotated.csrfToken;
      }

      return res.json({
        success: true,
        csrfToken: rotatedCsrf,
        message: 'Mot de passe mis à jour avec Argon2id et session régénérée avec succès.',
      });
    } catch (error: any) {
      console.error('Change password error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur interne.' });
    }
  }
);

apiRouter.post(
  '/auth/rotate-session',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.sessionRecord) {
        return res.status(400).json({
          error: 'NO_MANAGED_SESSION',
          message: 'Aucune session gérée à faire tourner.',
        });
      }

      const rotated = await rotateSession(req.sessionRecord.id, req, res, {
        auditReason: 'Rotation explicite du jeton de session.',
      });

      return res.json({
        success: true,
        csrfToken: rotated.csrfToken,
        session: sanitizeSessionForClient(rotated.session),
      });
    } catch (error: any) {
      console.error('Rotate session error:', error);
      return res
        .status(500)
        .json({ error: 'ROTATION_FAILED', message: 'Impossible de régénérer la session.' });
    }
  }
);

apiRouter.post(
  '/auth/logout',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.sessionRecord) {
        await db
          .update(activeSessions)
          .set({
            revokedAt: new Date().toISOString(),
            revokedReason: 'DECONNEXION_UTILISATEUR',
          })
          .where(eq(activeSessions.id, req.sessionRecord.id));
      }
      clearSessionCookies(req, res);
      return res.json({ success: true, message: 'Déconnexion effectuée avec succès.' });
    } catch (error: any) {
      console.error('Logout error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Erreur lors de la déconnexion.' });
    }
  }
);

apiRouter.get(
  '/auth/me',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const activeTenant = req.tenant || (await getCurrentTenant());
      let studentProfile = null;
      let teacherProfile = null;
      let activeSubscription = null;

      if (user.role === 'STUDENT') {
        const sp = await tdb.findFirst(studentProfiles, eq(studentProfiles.userId, user.id));
        studentProfile = sp ? mapStudentProfileRow(sp) : null;

        const today = new Date().toISOString().split('T')[0];
        const sub = await tdb.findFirst(
          subscriptions,
          and(
            eq(subscriptions.studentId, user.id),
            eq(subscriptions.status, 'ACTIVE'),
            lte(subscriptions.startDate, today),
            gte(subscriptions.endDate, today)
          )
        );
        activeSubscription = sub ? mapSubscriptionRow(sub) : null;
      } else if (user.role === 'TEACHER') {
        const tp = await tdb.findFirst(teacherProfiles, eq(teacherProfiles.userId, user.id));
        teacherProfile = tp ? mapTeacherProfileRow(tp) : null;
      }

      return res.json({
        user: sanitizeUser(user),
        tenant: activeTenant ? toTenantPublicSummary(activeTenant) : undefined,
        fullTenant:
          user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? activeTenant : undefined,
        csrfToken: req.csrfToken,
        studentProfile,
        teacherProfile,
        activeSubscription,
        currentSession: req.sessionRecord ? sanitizeSessionForClient(req.sessionRecord) : undefined,
      });
    } catch (error: any) {
      console.error('GET /auth/me error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur chargement profil.' });
    }
  }
);

apiRouter.patch(
  '/auth/preferences',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ body: updateLanguagePreferenceBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { preferredLanguage } = req.body as { preferredLanguage: 'fr' | 'ar' };
      const now = new Date().toISOString();

      const [updated] = await db
        .update(users)
        .set({
          preferredLanguage,
          updatedAt: now,
        })
        .where(eq(users.id, req.user!.id))
        .returning();

      if (!updated) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Utilisateur introuvable.',
        });
      }

      const mappedUser = mapUserRow(updated);
      req.user = mappedUser;

      return res.json({
        success: true,
        preferredLanguage: mappedUser.preferredLanguage || preferredLanguage,
        user: sanitizeUser(mappedUser),
      });
    } catch (error: any) {
      console.error('PATCH /auth/preferences error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Erreur lors de la mise à jour des préférences linguistiques.',
      });
    }
  }
);

apiRouter.get(
  '/auth/sessions',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rows = await tdb.selectMany(activeSessions, {
        where: eq(activeSessions.userId, req.user!.id),
        orderBy: desc(activeSessions.createdAt),
      });

      const userSessions = rows.map((s) => ({
        ...sanitizeSessionForClient(mapActiveSessionRow(s)),
        isCurrent: s.token === req.sessionToken,
      }));
      return res.json({ sessions: userSessions });
    } catch (error: any) {
      console.error('GET /auth/sessions error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur chargement sessions.' });
    }
  }
);

apiRouter.post(
  '/auth/sessions/:id/revoke',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const sessionRow = await tdb.findFirst(activeSessions, eq(activeSessions.id, req.params.id));

      if (!sessionRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Session introuvable.' });
      }

      // Anti-IDOR: Only the owner of the session (or school ADMIN / SUPER_ADMIN) may revoke it
      if (
        sessionRow.userId !== req.user!.id &&
        req.user!.role !== 'ADMIN' &&
        req.user!.role !== 'SUPER_ADMIN'
      ) {
        await logBlockedOwnershipAttempt(
          req,
          'ActiveSession',
          sessionRow.id,
          `Tentative IDOR de révocation d une session appartenant à ${sessionRow.userId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : cette session appartient à un autre utilisateur.',
        });
      }

      await tdb.updateWhere(
        activeSessions,
        {
          revokedAt: new Date().toISOString(),
          revokedReason: 'REVOCATION_MANUELLE_PAR_UTILISATEUR',
        },
        eq(activeSessions.id, sessionRow.id)
      );

      if (sessionRow.token === req.sessionToken) {
        clearSessionCookies(req, res);
      }

      return res.json({ success: true, message: 'La session a été révoquée.' });
    } catch (error: any) {
      console.error('Revoke session error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur révocation session.' });
    }
  }
);

apiRouter.post(
  '/auth/demo-switch',
  validateRequest({ body: demoSwitchBodySchema }),
  async (req: Request, res: Response) => {
    try {
      if (process.env.DISABLE_DEMO_SWITCH === 'true' || process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          error: 'DEMO_SWITCH_DISABLED',
          message: 'La bascule rapide de démonstration est désactivée.',
        });
      }

      const { targetRole, userId, tenantId } = req.body as {
        targetRole?: string;
        userId?: string;
        tenantId?: string;
      };
      let userRow: typeof users.$inferSelect | undefined;

      if (userId) {
        const [found] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        userRow = found;
      } else if (targetRole) {
        const conditions = [eq(users.role, targetRole), eq(users.status, 'ACTIVE')];
        if (tenantId) {
          conditions.push(eq(users.tenantId, tenantId));
        }
        const [found] = await db
          .select()
          .from(users)
          .where(and(...conditions))
          .orderBy(asc(users.createdAt))
          .limit(1);
        userRow = found;
      }

      if (!userRow) {
        return res
          .status(404)
          .json({ error: 'USER_NOT_FOUND', message: 'Utilisateur de démonstration non trouvé.' });
      }

      const user = mapUserRow(userRow);
      const userTenant = await getTenantById(user.tenantId);

      if (user.role !== 'SUPER_ADMIN') {
        const tenantCheck = checkTenantOperationalAccess(userTenant);
        if (!tenantCheck.allowed) {
          return res.status(403).json({
            error: tenantCheck.errorCode || 'TENANT_SUSPENDED',
            message:
              tenantCheck.message || 'Établissement suspendu ou abonnement expiré.',
          });
        }
      }

      const { token, csrfToken, session } = await createSession(user, req);
      setSessionCookies(req, res, token, csrfToken, session.expiresAt);
      res.setHeader('X-Tenant-Id', user.tenantId);

      const { studentProfile, teacherProfile } = await runWithTenantContext(
        { tenantId: user.tenantId, userId: user.id, userRole: user.role },
        async () => {
          let sp = null;
          let tp = null;
          if (user.role === 'STUDENT') {
            const row = await tdb.findFirst(studentProfiles, eq(studentProfiles.userId, user.id));
            sp = row ? mapStudentProfileRow(row) : null;
          } else if (user.role === 'TEACHER') {
            const row = await tdb.findFirst(teacherProfiles, eq(teacherProfiles.userId, user.id));
            tp = row ? mapTeacherProfileRow(row) : null;
          }
          return { studentProfile: sp, teacherProfile: tp };
        }
      );

      return res.json({
        user: sanitizeUser(user),
        tenant: userTenant ? toTenantPublicSummary(userTenant) : undefined,
        fullTenant:
          user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? userTenant : undefined,
        csrfToken,
        session: sanitizeSessionForClient(session),
        studentProfile,
        teacherProfile,
      });
    } catch (error: any) {
      console.error('Demo switch error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur bascule démo.' });
    }
  }
);

// =============================================================================
// SCHOOL BRANDING & ESTABLISHMENT SETTINGS (TENANT ADMIN)
// =============================================================================

apiRouter.get(
  '/tenant/settings',
  authenticateToken,
  requireRole(['ADMIN']),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenant = req.tenant || (await getCurrentTenant());
      if (!tenant) {
        return res
          .status(404)
          .json({ error: 'TENANT_NOT_FOUND', message: 'Établissement introuvable.' });
      }

      const [studentsCount, teachersCount, coursesCount, contractRows] = await Promise.all([
        tdb.count(users, eq(users.role, 'STUDENT')),
        tdb.count(users, eq(users.role, 'TEACHER')),
        tdb.count(courses),
        tdb.selectMany(tenantSubscriptions, { orderBy: desc(tenantSubscriptions.createdAt) }),
      ]);

      return res.json({
        tenant,
        usage: {
          studentsCount,
          maxStudents: tenant.settings.maxStudents,
          teachersCount,
          maxTeachers: tenant.settings.maxTeachers,
          coursesCount,
        },
        contracts: contractRows.map(mapTenantSubscriptionRow),
      });
    } catch (error: any) {
      console.error('GET /tenant/settings error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger les paramètres de l établissement.',
      });
    }
  }
);

apiRouter.put(
  '/tenant/settings',
  authenticateToken,
  requireRole(['ADMIN']),
  validateRequest({ body: updateTenantBrandingBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activeTenantId = getCurrentTenantId();
      const current = await getTenantById(activeTenantId);
      if (!current) {
        return res
          .status(404)
          .json({ error: 'TENANT_NOT_FOUND', message: 'Établissement introuvable.' });
      }

      const body = req.body as {
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
        settings?: Partial<
          Pick<
            TenantSettingsJson,
            | 'receiptPrefix'
            | 'receiptFooterNote'
            | 'supportHours'
            | 'enforceSingleStudentSession'
            | 'allowManualPayments'
            | 'allowInstallments'
            | 'autoRemindersEnabled'
            | 'reminderDaysBeforeDue'
            | 'reminderDaysAfterOverdue'
            | 'reminderFinalDaysAfterOverdue'
          >
        >;
      };

      const mergedSettings: TenantSettingsJson = {
        ...current.settings,
        ...(body.settings?.receiptPrefix !== undefined
          ? { receiptPrefix: body.settings.receiptPrefix }
          : {}),
        ...(body.settings?.receiptFooterNote !== undefined
          ? { receiptFooterNote: body.settings.receiptFooterNote }
          : {}),
        ...(body.settings?.supportHours !== undefined
          ? { supportHours: body.settings.supportHours }
          : {}),
        ...(body.settings?.enforceSingleStudentSession !== undefined
          ? { enforceSingleStudentSession: body.settings.enforceSingleStudentSession }
          : {}),
        ...(body.settings?.allowManualPayments !== undefined
          ? { allowManualPayments: body.settings.allowManualPayments }
          : {}),
        ...(body.settings?.allowInstallments !== undefined
          ? { allowInstallments: body.settings.allowInstallments }
          : {}),
        ...(body.settings?.autoRemindersEnabled !== undefined
          ? { autoRemindersEnabled: body.settings.autoRemindersEnabled }
          : {}),
        ...(body.settings?.reminderDaysBeforeDue !== undefined
          ? { reminderDaysBeforeDue: body.settings.reminderDaysBeforeDue }
          : {}),
        ...(body.settings?.reminderDaysAfterOverdue !== undefined
          ? { reminderDaysAfterOverdue: body.settings.reminderDaysAfterOverdue }
          : {}),
        ...(body.settings?.reminderFinalDaysAfterOverdue !== undefined
          ? { reminderFinalDaysAfterOverdue: body.settings.reminderFinalDaysAfterOverdue }
          : {}),
      };

      const nowIso = new Date().toISOString();

      const updatedRow = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(tenants)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.shortName !== undefined ? { shortName: body.shortName } : {}),
            ...(body.tagline !== undefined ? { tagline: body.tagline } : {}),
            ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl || null } : {}),
            ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
            ...(body.secondaryColor !== undefined ? { secondaryColor: body.secondaryColor } : {}),
            ...(body.accentColor !== undefined ? { accentColor: body.accentColor } : {}),
            ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
            ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
            ...(body.address !== undefined ? { address: body.address } : {}),
            ...(body.city !== undefined ? { city: body.city } : {}),
            ...(body.wilaya !== undefined ? { wilaya: body.wilaya } : {}),
            ...(body.website !== undefined ? { website: body.website || null } : {}),
            ...(body.accreditationNumber !== undefined
              ? { accreditationNumber: body.accreditationNumber || null }
              : {}),
            ...(body.taxId !== undefined ? { taxId: body.taxId || null } : {}),
            ...(body.nif !== undefined ? { nif: body.nif || null } : {}),
            ...(body.nis !== undefined ? { nis: body.nis || null } : {}),
            ...(body.rc !== undefined ? { rc: body.rc || null } : {}),
            ...(body.articleImposition !== undefined
              ? { articleImposition: body.articleImposition || null }
              : {}),
            ...(body.tvaApplicable !== undefined ? { tvaApplicable: body.tvaApplicable } : {}),
            ...(body.tvaRatePercent !== undefined ? { tvaRatePercent: body.tvaRatePercent } : {}),
            ...(body.invoicePrefix !== undefined ? { invoicePrefix: body.invoicePrefix } : {}),
            ...(body.invoiceFooterNote !== undefined
              ? { invoiceFooterNote: body.invoiceFooterNote || null }
              : {}),
            settings: mergedSettings,
            updatedAt: nowIso,
          })
          .where(eq(tenants.id, activeTenantId))
          .returning();

        const txDb = tdb.forTx(tx);
        await txDb.insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'TENANT_BRANDING_UPDATED',
          entity: 'Tenant',
          entityId: activeTenantId,
          details: `Identité visuelle, paramètres fiscaux (NIF/NIS/RC/TVA) et facturation (${row.invoicePrefix}) mis à jour pour "${row.name}".`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });

        return row;
      });

      const mapped = mapTenantRow(updatedRow);
      return res.json({
        success: true,
        tenant: mapped,
        publicSummary: toTenantPublicSummary(mapped),
        message: 'Identité visuelle et paramètres de l établissement enregistrés avec succès.',
      });
    } catch (error: any) {
      console.error('PUT /tenant/settings error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de mettre à jour les paramètres de l établissement.',
      });
    }
  }
);

// =============================================================================
// SUPER_ADMIN SAAS GOVERNANCE (ESTABLISHMENTS, QUOTAS & B2B SUBSCRIPTIONS)
// =============================================================================

apiRouter.get(
  '/super-admin/overview',
  authenticateToken,
  requireRole(['SUPER_ADMIN']),
  validateRequest(),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const [tenantRows, contractRows, allUsers, allCourses, allPayments] = await Promise.all([
        db.select().from(tenants).orderBy(asc(tenants.createdAt)),
        db
          .select()
          .from(tenantSubscriptions)
          .orderBy(desc(tenantSubscriptions.createdAt)),
        db.select().from(users),
        db.select().from(courses),
        db.select().from(payments),
      ]);

      const todayStr = new Date().toISOString().split('T')[0];
      const in30DaysStr = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

      const tenantNameMap = new Map<string, string>();
      const enrichedTenants: SuperAdminTenantSummary[] = tenantRows.map((row) => {
        const mapped = mapTenantRow(row);
        tenantNameMap.set(mapped.id, mapped.name);

        const tenantUsers = allUsers.filter((u) => u.tenantId === mapped.id);
        const studentsCount = tenantUsers.filter((u) => u.role === 'STUDENT').length;
        const teachersCount = tenantUsers.filter((u) => u.role === 'TEACHER').length;
        const adminUser = tenantUsers.find((u) => u.role === 'ADMIN');
        const coursesCount = allCourses.filter((c) => c.tenantId === mapped.id).length;
        const collectedRevenueDzd = allPayments
          .filter((p) => p.tenantId === mapped.id && p.status === 'CONFIRMED')
          .reduce((sum, p) => sum + p.amountDzd, 0);

        const latestContractRow = contractRows.find((c) => c.tenantId === mapped.id);

        return {
          ...mapped,
          studentsCount,
          teachersCount,
          coursesCount,
          collectedRevenueDzd,
          adminEmail: adminUser?.email,
          adminName: adminUser?.name,
          latestContract: latestContractRow ? mapTenantSubscriptionRow(latestContractRow) : null,
        };
      });

      const activeTenantsList = enrichedTenants.filter(
        (t) =>
          t.status === 'ACTIVE' &&
          (t.subscriptionStatus === 'ACTIVE' || t.subscriptionStatus === 'TRIAL')
      );
      const mrrDzd = activeTenantsList.reduce((acc, t) => acc + t.monthlyFeeDzd, 0);
      const totalB2bBilledDzd = contractRows
        .filter((c) => c.status === 'ACTIVE' || c.status === 'EXPIRED')
        .reduce((acc, c) => acc + c.amountDzd, 0);

      const stats: SuperAdminOverviewStats = {
        totalTenants: enrichedTenants.length,
        activeTenants: enrichedTenants.filter((t) => t.status === 'ACTIVE').length,
        suspendedTenants: enrichedTenants.filter((t) => t.status === 'SUSPENDED').length,
        mrrDzd,
        arrDzd: mrrDzd * 12,
        totalB2bBilledDzd,
        totalStudentsAcrossTenants: allUsers.filter((u) => u.role === 'STUDENT').length,
        totalTeachersAcrossTenants: allUsers.filter((u) => u.role === 'TEACHER').length,
        totalStudentRevenueAcrossTenantsDzd: allPayments
          .filter((p) => p.status === 'CONFIRMED')
          .reduce((acc, p) => acc + p.amountDzd, 0),
        expiringSoonCount: enrichedTenants.filter(
          (t) =>
            t.status === 'ACTIVE' &&
            t.subscriptionEndDate >= todayStr &&
            t.subscriptionEndDate <= in30DaysStr
        ).length,
      };

      const enrichedContracts = contractRows.map((c) => ({
        ...mapTenantSubscriptionRow(c),
        tenantName: tenantNameMap.get(c.tenantId) || c.tenantId,
      }));

      return res.json({
        stats,
        tenants: enrichedTenants,
        contracts: enrichedContracts,
      });
    } catch (error: any) {
      console.error('GET /super-admin/overview error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger la console Super Admin SaaS.',
      });
    }
  }
);

apiRouter.post(
  '/super-admin/tenants',
  authenticateToken,
  requireRole(['SUPER_ADMIN']),
  validateRequest({ body: createTenantBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body as {
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
        subscriptionPlan: 'STARTER' | 'PRO' | 'ENTERPRISE';
        billingCycle: 'MONTHLY' | 'ANNUAL';
        monthlyFeeDzd?: number;
        maxStudents?: number;
        maxTeachers?: number;
        subscriptionEndDate?: string;
        adminName: string;
        adminEmail: string;
        adminPassword: string;
      };

      const pwdPolicy = validatePasswordPolicy(body.adminPassword, {
        email: body.adminEmail,
        name: body.adminName,
      });
      if (!pwdPolicy.valid) {
        return res.status(400).json({
          error: 'WEAK_PASSWORD',
          errors: pwdPolicy.errors,
          message: pwdPolicy.errors.join(' '),
        });
      }

      const [existingSlug, existingEmail] = await Promise.all([
        getTenantBySlug(body.slug),
        db.select({ id: users.id }).from(users).where(eq(users.email, body.adminEmail)).limit(1),
      ]);

      if (existingSlug) {
        return res.status(409).json({
          error: 'TENANT_SLUG_EXISTS',
          message: `Le slug "${body.slug}" est déjà attribué à un autre établissement.`,
        });
      }
      if (existingEmail.length > 0) {
        return res.status(409).json({
          error: 'EMAIL_ALREADY_EXISTS',
          message: `L'adresse e-mail "${body.adminEmail}" est déjà utilisée sur la plateforme.`,
        });
      }

      const planDefaults: Record<
        'STARTER' | 'PRO' | 'ENTERPRISE',
        { monthlyFeeDzd: number; maxStudents: number; maxTeachers: number }
      > = {
        STARTER: { monthlyFeeDzd: 14_000, maxStudents: 80, maxTeachers: 6 },
        PRO: { monthlyFeeDzd: 28_000, maxStudents: 250, maxTeachers: 20 },
        ENTERPRISE: { monthlyFeeDzd: 45_000, maxStudents: 1_000, maxTeachers: 60 },
      };
      const defaults = planDefaults[body.subscriptionPlan];
      const monthlyFeeDzd = body.monthlyFeeDzd ?? defaults.monthlyFeeDzd;
      const maxStudents = body.maxStudents ?? defaults.maxStudents;
      const maxTeachers = body.maxTeachers ?? defaults.maxTeachers;

      const now = new Date();
      const nowIso = now.toISOString();
      const startDate = nowIso.split('T')[0];
      const endDate =
        body.subscriptionEndDate ||
        new Date(
          now.getTime() + (body.billingCycle === 'ANNUAL' ? 365 : 30) * 86_400_000
        )
          .toISOString()
          .split('T')[0];

      const contractAmountDzd =
        body.billingCycle === 'ANNUAL' ? monthlyFeeDzd * 12 : monthlyFeeDzd;

      const newTenantId = `tnt_${body.slug.replace(/-/g, '_')}_${crypto.randomBytes(2).toString('hex')}`;
      const receiptPrefix =
        body.receiptPrefix ||
        `REC-${body.shortName.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'SCH'}`;

      const settings: TenantSettingsJson = {
        ...DEFAULT_TENANT_SETTINGS,
        receiptPrefix,
        receiptFooterNote: `Ce reçu fait office de justificatif officiel de règlement auprès de ${body.name}.`,
        maxStudents,
        maxTeachers,
      };

      const adminPasswordHash = await hashPassword(body.adminPassword);
      const adminUserId = `usr_adm_${crypto.randomUUID()}`;
      const contractId = `tsub_${crypto.randomUUID()}`;
      const invoiceNumber = `FAC-SAAS-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      const result = await db.transaction(async (tx) => {
        const [createdTenant] = await tx
          .insert(tenants)
          .values({
            id: newTenantId,
            slug: body.slug,
            name: body.name,
            shortName: body.shortName.toUpperCase(),
            tagline:
              body.tagline ||
              'Établissement d Enseignement & Formation Professionnelle Agréé',
            logoUrl: body.logoUrl || null,
            primaryColor: body.primaryColor,
            secondaryColor: body.secondaryColor,
            accentColor: body.accentColor,
            contactEmail: body.contactEmail,
            contactPhone: body.contactPhone,
            address: body.address,
            city: body.city,
            wilaya: body.wilaya,
            country: 'Algérie',
            website: body.website || null,
            accreditationNumber: body.accreditationNumber || null,
            taxId: body.taxId || null,
            settings,
            subscriptionPlan: body.subscriptionPlan,
            subscriptionStatus: 'ACTIVE',
            subscriptionStartDate: startDate,
            subscriptionEndDate: endDate,
            monthlyFeeDzd,
            billingNotes: `Contrat initial ${body.subscriptionPlan} (${body.billingCycle})`,
            status: 'ACTIVE',
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        const [createdContract] = await tx
          .insert(tenantSubscriptions)
          .values({
            id: contractId,
            tenantId: newTenantId,
            planCode: body.subscriptionPlan,
            billingCycle: body.billingCycle,
            status: 'ACTIVE',
            amountDzd: contractAmountDzd,
            maxStudents,
            maxTeachers,
            startDate,
            endDate,
            invoiceNumber,
            paymentMethod: 'BANK_TRANSFER',
            notes: `Ouverture de compte établissement ${body.name}`,
            createdBy: req.user!.id,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        // Provision isolated default SubscriptionPlans for the new establishment
        await tx.insert(subscriptionPlans).values([
          {
            id: `plan_${newTenantId}_m`,
            tenantId: newTenantId,
            name: 'Formule Mensuelle Standard',
            code: 'PLAN-M-DZD',
            durationMonths: 1,
            priceDzd: 6_500,
            description: 'Accès mensuel aux cours en direct et supports pédagogiques.',
            includesLiveSessions: true,
            includesRecordings: true,
          },
          {
            id: `plan_${newTenantId}_q`,
            tenantId: newTenantId,
            name: 'Formule Trimestrielle Intensif',
            code: 'PLAN-Q-DZD',
            durationMonths: 3,
            priceDzd: 17_500,
            description: 'Accès complet 90 jours aux formations certifiantes.',
            includesLiveSessions: true,
            includesRecordings: true,
          },
        ]);

        // Provision isolated default IntegrationSettings for the new establishment
        await tx.insert(integrationSettings).values([
          {
            id: `int_${newTenantId}_zoom`,
            tenantId: newTenantId,
            provider: 'ZOOM',
            isEnabled: true,
            isTestMode: true,
            config: { defaultTimezone: 'Africa/Algiers', fallbackProvider: 'JITSI' },
            updatedAt: nowIso,
          },
          {
            id: `int_${newTenantId}_pay`,
            tenantId: newTenantId,
            provider: 'PAYMENT_GATEWAY',
            isEnabled: false,
            isTestMode: true,
            config: { currency: 'DZD', acceptedManualMethods: ['BARIDIMOB_CCP', 'BANK_TRANSFER', 'CASH'] },
            updatedAt: nowIso,
          },
          {
            id: `int_${newTenantId}_smtp`,
            tenantId: newTenantId,
            provider: 'EMAIL_SMTP',
            isEnabled: true,
            isTestMode: true,
            config: {
              host: process.env.SMTP_HOST || 'smtp.najahlearn.dz',
              port: Number(process.env.SMTP_PORT) || 587,
              secure: false,
              fromName: body.name,
              fromEmail: body.contactEmail,
              replyTo: body.contactEmail,
            },
            updatedAt: nowIso,
          },
        ]);

        // Provision initial Establishment ADMIN account
        const [createdAdmin] = await tx
          .insert(users)
          .values({
            id: adminUserId,
            tenantId: newTenantId,
            uid: adminUserId,
            name: body.adminName,
            email: body.adminEmail,
            role: 'ADMIN',
            status: 'ACTIVE',
            phone: body.contactPhone,
            passwordHash: adminPasswordHash,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        await tx.insert(auditLogs).values({
          id: `log_${crypto.randomUUID()}`,
          tenantId: newTenantId,
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'SAAS_TENANT_ONBOARDED',
          entity: 'Tenant',
          entityId: newTenantId,
          details: `Création de l établissement "${body.name}" (${body.subscriptionPlan}), contrat ${invoiceNumber} et administrateur initial ${body.adminEmail}.`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });

        return {
          tenant: mapTenantRow(createdTenant),
          contract: mapTenantSubscriptionRow(createdContract),
          adminUser: sanitizeUser(mapUserRow(createdAdmin)),
        };
      });

      await dispatchTransactionalNotification({
        tenantId: newTenantId,
        userId: result.adminUser.id,
        recipientEmail: result.adminUser.email,
        recipientName: result.adminUser.name,
        templateType: 'ACCOUNT_CREATED',
        appOrigin: extractRequestOrigin(req),
        variables: {
          role: 'ADMIN',
          studentIdNumber: 'ADM-DIRECTION',
        },
      }).catch((err) => {
        console.warn('[NajahLearn SMTP] Tenant admin welcome email warning:', err);
      });

      return res.status(201).json({
        success: true,
        ...result,
        message: `Établissement "${body.name}" et compte administrateur provisionnés avec isolation complète.`,
      });
    } catch (error: any) {
      console.error('POST /super-admin/tenants error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: error.message || 'Impossible de provisionner le nouvel établissement.',
      });
    }
  }
);

apiRouter.put(
  '/super-admin/tenants/:id',
  authenticateToken,
  requireRole(['SUPER_ADMIN']),
  validateRequest({ params: idParamSchema, body: updateSuperAdminTenantBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetId = req.params.id;
      const existing = await getTenantById(targetId);
      if (!existing) {
        return res
          .status(404)
          .json({ error: 'TENANT_NOT_FOUND', message: 'Établissement introuvable.' });
      }

      const body = req.body as {
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
        subscriptionPlan?: 'STARTER' | 'PRO' | 'ENTERPRISE';
        subscriptionStatus?: 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED';
        subscriptionEndDate?: string;
        monthlyFeeDzd?: number;
        billingNotes?: string;
        status?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
        maxStudents?: number;
        maxTeachers?: number;
      };

      const mergedSettings: TenantSettingsJson = {
        ...existing.settings,
        ...(body.maxStudents !== undefined ? { maxStudents: body.maxStudents } : {}),
        ...(body.maxTeachers !== undefined ? { maxTeachers: body.maxTeachers } : {}),
      };

      const nowIso = new Date().toISOString();

      const updatedTenant = await db.transaction(async (tx) => {
        const [updatedRow] = await tx
          .update(tenants)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.shortName !== undefined ? { shortName: body.shortName.toUpperCase() } : {}),
            ...(body.tagline !== undefined ? { tagline: body.tagline } : {}),
            ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl || null } : {}),
            ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
            ...(body.secondaryColor !== undefined ? { secondaryColor: body.secondaryColor } : {}),
            ...(body.accentColor !== undefined ? { accentColor: body.accentColor } : {}),
            ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
            ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
            ...(body.address !== undefined ? { address: body.address } : {}),
            ...(body.city !== undefined ? { city: body.city } : {}),
            ...(body.wilaya !== undefined ? { wilaya: body.wilaya } : {}),
            ...(body.accreditationNumber !== undefined
              ? { accreditationNumber: body.accreditationNumber || null }
              : {}),
            ...(body.taxId !== undefined ? { taxId: body.taxId || null } : {}),
            ...(body.subscriptionPlan !== undefined
              ? { subscriptionPlan: body.subscriptionPlan }
              : {}),
            ...(body.subscriptionStatus !== undefined
              ? { subscriptionStatus: body.subscriptionStatus }
              : {}),
            ...(body.subscriptionEndDate !== undefined
              ? { subscriptionEndDate: body.subscriptionEndDate }
              : {}),
            ...(body.monthlyFeeDzd !== undefined ? { monthlyFeeDzd: body.monthlyFeeDzd } : {}),
            ...(body.billingNotes !== undefined
              ? { billingNotes: body.billingNotes || null }
              : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            settings: mergedSettings,
            updatedAt: nowIso,
          })
          .where(eq(tenants.id, targetId))
          .returning();

        const nextStatus = body.status ?? existing.status;
        const nextSubStatus = body.subscriptionStatus ?? existing.subscriptionStatus;

        // Immediately revoke active sessions of the establishment if suspended/expired
        if (
          nextStatus !== 'ACTIVE' ||
          nextSubStatus === 'SUSPENDED' ||
          nextSubStatus === 'EXPIRED'
        ) {
          await tx
            .update(activeSessions)
            .set({
              revokedAt: nowIso,
              revokedReason: 'ETABLISSEMENT_SUSPENDU_SAAS',
            })
            .where(
              and(eq(activeSessions.tenantId, targetId), isNull(activeSessions.revokedAt))
            );
        }

        await tx.insert(auditLogs).values({
          id: `log_${crypto.randomUUID()}`,
          tenantId: targetId,
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'SAAS_TENANT_UPDATED',
          entity: 'Tenant',
          entityId: targetId,
          details: `Mise à jour SaaS de "${updatedRow.name}" (statut=${updatedRow.status}, abonnement=${updatedRow.subscriptionStatus}, plan=${updatedRow.subscriptionPlan}).`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });

        return mapTenantRow(updatedRow);
      });

      return res.json({
        success: true,
        tenant: updatedTenant,
        message: `Établissement "${updatedTenant.name}" mis à jour avec succès.`,
      });
    } catch (error: any) {
      console.error('PUT /super-admin/tenants/:id error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de mettre à jour cet établissement.',
      });
    }
  }
);

apiRouter.post(
  '/super-admin/tenants/:id/subscriptions',
  authenticateToken,
  requireRole(['SUPER_ADMIN']),
  validateRequest({ params: idParamSchema, body: createTenantSubscriptionBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetId = req.params.id;
      const existing = await getTenantById(targetId);
      if (!existing) {
        return res
          .status(404)
          .json({ error: 'TENANT_NOT_FOUND', message: 'Établissement introuvable.' });
      }

      const body = req.body as {
        planCode: 'STARTER' | 'PRO' | 'ENTERPRISE';
        billingCycle: 'MONTHLY' | 'ANNUAL';
        amountDzd: number;
        maxStudents?: number;
        maxTeachers?: number;
        startDate?: string;
        endDate: string;
        paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'BARIDIMOB_CCP' | 'CHEQUE' | 'ONLINE_CARD';
        notes?: string;
      };

      const nowIso = new Date().toISOString();
      const startDate = body.startDate || nowIso.split('T')[0];
      const maxStudents = body.maxStudents ?? existing.settings.maxStudents;
      const maxTeachers = body.maxTeachers ?? existing.settings.maxTeachers;
      const monthlyEquivalent =
        body.billingCycle === 'ANNUAL'
          ? Math.round(body.amountDzd / 12)
          : body.amountDzd;
      const invoiceNumber = `FAC-SAAS-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      const result = await db.transaction(async (tx) => {
        const [contractRow] = await tx
          .insert(tenantSubscriptions)
          .values({
            id: `tsub_${crypto.randomUUID()}`,
            tenantId: targetId,
            planCode: body.planCode,
            billingCycle: body.billingCycle,
            status: 'ACTIVE',
            amountDzd: body.amountDzd,
            maxStudents,
            maxTeachers,
            startDate,
            endDate: body.endDate,
            invoiceNumber,
            paymentMethod: body.paymentMethod,
            notes: body.notes || `Renouvellement SaaS ${body.planCode}`,
            createdBy: req.user!.id,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        const [updatedTenantRow] = await tx
          .update(tenants)
          .set({
            subscriptionPlan: body.planCode,
            subscriptionStatus: 'ACTIVE',
            subscriptionStartDate: startDate,
            subscriptionEndDate: body.endDate,
            monthlyFeeDzd: monthlyEquivalent,
            status: 'ACTIVE',
            settings: {
              ...existing.settings,
              maxStudents,
              maxTeachers,
            },
            updatedAt: nowIso,
          })
          .where(eq(tenants.id, targetId))
          .returning();

        await tx.insert(auditLogs).values({
          id: `log_${crypto.randomUUID()}`,
          tenantId: targetId,
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'SAAS_SUBSCRIPTION_RENEWED',
          entity: 'TenantSubscription',
          entityId: contractRow.id,
          details: `Facture B2B ${invoiceNumber} (${body.amountDzd.toLocaleString('fr-DZ')} DZD) enregistrée et abonnement prolongé jusqu au ${body.endDate}.`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });

        return {
          contract: mapTenantSubscriptionRow(contractRow),
          tenant: mapTenantRow(updatedTenantRow),
        };
      });

      return res.status(201).json({
        success: true,
        ...result,
        message: `Abonnement SaaS renouvelé (${result.contract.invoiceNumber}) jusqu'au ${body.endDate}.`,
      });
    } catch (error: any) {
      console.error('POST /super-admin/tenants/:id/subscriptions error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible d enregistrer le renouvellement d abonnement.',
      });
    }
  }
);

// =============================================================================
// STUDENTS MANAGEMENT (TENANT-ISOLATED VIA `tdb` + RBAC + OWNERSHIP + CSV)
// =============================================================================

apiRouter.get(
  '/students',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'TEACHER']),
  validateRequest({ query: studentsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { query, classId, status, wilaya } = req.query as {
        query?: string;
        classId?: string;
        status?: string;
        wilaya?: string;
      };

      const [studentRows, profileRows, enrollmentRows, classRows, courseRows, subRows] =
        await Promise.all([
          tdb.selectMany(users, {
            where: eq(users.role, 'STUDENT'),
            orderBy: desc(users.createdAt),
          }),
          tdb.selectMany(studentProfiles),
          tdb.selectMany(enrollments, { where: eq(enrollments.status, 'ACTIVE') }),
          tdb.selectMany(classes),
          tdb.selectMany(courses),
          tdb.selectMany(subscriptions),
        ]);

      // Anti-IDOR for TEACHER: can only view students enrolled in their OWN assigned classes
      const isTeacher = req.user!.role === 'TEACHER';
      let allowedStudentIdsForTeacher: Set<string> | null = null;
      if (isTeacher) {
        const teacherClassIds = new Set(
          classRows.filter((c) => c.teacherId === req.user!.id).map((c) => c.id)
        );
        if (classId && classId !== 'ALL' && !teacherClassIds.has(classId)) {
          await logBlockedOwnershipAttempt(
            req,
            'Class',
            classId,
            `Enseignant ${req.user!.email} a tenté de lister les étudiants d une classe non assignée (${classId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit : vous n êtes pas affecté à cette classe.',
          });
        }
        allowedStudentIdsForTeacher = new Set(
          enrollmentRows
            .filter((e) => teacherClassIds.has(e.classId))
            .map((e) => e.studentId)
        );
      }

      let studentList = studentRows.map(mapUserRow);
      if (allowedStudentIdsForTeacher) {
        studentList = studentList.filter((s) => allowedStudentIdsForTeacher!.has(s.id));
      }

      if (query) {
        const q = query.toLowerCase();
        studentList = studentList.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.email.toLowerCase().includes(q) ||
            (s.phone && s.phone.includes(q))
        );
      }

      if (status && status !== 'ALL') {
        studentList = studentList.filter((s) => s.status === status);
      }

      const today = new Date().toISOString().split('T')[0];

      let enriched = studentList.map((s) => {
        const profRow = profileRows.find((p) => p.userId === s.id);
        const profile = profRow ? mapStudentProfileRow(profRow) : undefined;
        const enrRow = enrollmentRows.find((e) => e.studentId === s.id);
        const clsRow = enrRow ? classRows.find((c) => c.id === enrRow.classId) : undefined;
        const crsRow = clsRow ? courseRows.find((c) => c.id === clsRow.courseId) : undefined;

        const activeSub = subRows.find(
          (sub) =>
            sub.studentId === s.id &&
            sub.status === 'ACTIVE' &&
            sub.startDate <= today &&
            sub.endDate >= today
        );
        const fallbackSub = subRows.find((sub) => sub.studentId === s.id);
        const chosenSub = activeSub || fallbackSub;

        return {
          ...sanitizeUser(s),
          profile,
          class: clsRow ? mapClassRow(clsRow) : null,
          course: crsRow ? mapCourseRow(crsRow) : null,
          subscription: !isTeacher && chosenSub ? mapSubscriptionRow(chosenSub) : undefined,
          hasActiveSubscription: Boolean(activeSub),
        };
      });

      if (classId && classId !== 'ALL') {
        enriched = enriched.filter(
          (s) => s.class?.id === classId || s.profile?.currentClassId === classId
        );
      }
      if (wilaya && wilaya !== 'ALL') {
        enriched = enriched.filter((s) => s.profile?.wilaya === wilaya);
      }

      return res.json({ students: enriched });
    } catch (error: any) {
      console.error('GET /students error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les étudiants.' });
    }
  }
);

// CSV Export MUST be declared before `/students/:id` so `export-csv` is never captured as `:id`
apiRouter.get(
  '/students/export-csv',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activeTenant = req.tenant || (await getCurrentTenant());
      const [studentRows, profileRows] = await Promise.all([
        tdb.selectMany(users, {
          where: eq(users.role, 'STUDENT'),
          orderBy: asc(users.createdAt),
        }),
        tdb.selectMany(studentProfiles),
      ]);

      const headers = [
        'Etablissement',
        'Identifiant',
        'Nom Complet',
        'Email',
        'Telephone',
        'Wilaya',
        'Ville',
        'Statut Compte',
        'Date Inscription',
      ];
      const rows = studentRows.map((s) => {
        const profile = profileRows.find((p) => p.userId === s.id);
        return [
          escapeCsvCell(activeTenant?.name || s.tenantId),
          escapeCsvCell(profile?.studentIdNumber || s.id),
          escapeCsvCell(s.name),
          escapeCsvCell(s.email),
          escapeCsvCell(s.phone || ''),
          escapeCsvCell(profile?.wilaya || ''),
          escapeCsvCell(profile?.city || ''),
          escapeCsvCell(s.status),
          escapeCsvCell(s.createdAt.split('T')[0]),
        ].join(',');
      });

      const slug = activeTenant?.slug || 'etablissement';
      const csv = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="etudiants_${slug}.csv"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send('\uFEFF' + csv);
    } catch (error: any) {
      console.error('Export students CSV error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur export CSV.' });
    }
  }
);

apiRouter.get(
  '/students/:id',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetId = req.params.id;
      const requester = req.user!;

      // Anti-IDOR: STUDENT can only inspect their own dossier
      if (requester.role === 'STUDENT' && requester.id !== targetId) {
        await logBlockedOwnershipAttempt(
          req,
          'Student',
          targetId,
          `Étudiant ${requester.email} a tenté d accéder au dossier étudiant ${targetId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez consulter que votre propre dossier.',
        });
      }

      // `tdb` automatically enforces `tenant_id = getCurrentTenantId()`, returning 404 for other establishments!
      const userRow = await tdb.findFirst(
        users,
        and(eq(users.id, targetId), eq(users.role, 'STUDENT'))
      );

      if (!userRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Dossier étudiant introuvable.' });
      }

      // Anti-IDOR: TEACHER can only inspect a student enrolled in one of their classes
      if (requester.role === 'TEACHER') {
        const teacherClasses = await tdb.selectMany(classes, {
          where: eq(classes.teacherId, requester.id),
        });
        const teacherClassIds = teacherClasses.map((c) => c.id);

        const activeEnr =
          teacherClassIds.length > 0
            ? await tdb.findFirst(
                enrollments,
                and(
                  eq(enrollments.studentId, targetId),
                  inArray(enrollments.classId, teacherClassIds),
                  eq(enrollments.status, 'ACTIVE')
                )
              )
            : undefined;

        if (!activeEnr) {
          await logBlockedOwnershipAttempt(
            req,
            'Student',
            targetId,
            `Enseignant ${requester.email} a tenté d accéder au dossier d un étudiant hors de ses classes (${targetId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit : cet étudiant n est inscrit dans aucune de vos classes.',
          });
        }
      }

      const profRow = await tdb.findFirst(studentProfiles, eq(studentProfiles.userId, targetId));

      return res.json({
        student: sanitizeUser(mapUserRow(userRow)),
        profile: profRow ? mapStudentProfileRow(profRow) : null,
      });
    } catch (error: any) {
      console.error('GET /students/:id error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger le dossier étudiant.' });
    }
  }
);

apiRouter.post(
  '/students',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ body: createStudentBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        name: trimmedName,
        email: normalizedEmail,
        password,
        phone,
        city,
        wilaya,
        academicLevel,
        classId,
        courseId,
        createPendingPayment,
      } = req.body as {
        name: string;
        email: string;
        password?: string;
        phone?: string;
        city?: string;
        wilaya?: string;
        academicLevel?: string;
        classId?: string;
        courseId?: string;
        createPendingPayment?: boolean;
      };

      const activeTenant = req.tenant || (await getCurrentTenant());
      const maxStudents = activeTenant?.settings.maxStudents ?? 500;
      const currentStudentCount = await tdb.count(users, eq(users.role, 'STUDENT'));
      if (currentStudentCount >= maxStudents) {
        return res.status(403).json({
          error: 'TENANT_QUOTA_EXCEEDED',
          message: `Quota atteint (${currentStudentCount}/${maxStudents} étudiants) pour votre abonnement SaaS. Contactez l'administration SaaS pour augmenter votre capacité.`,
        });
      }

      let initialPassword = generateCompliantTemporaryPassword();
      if (password !== undefined && password.length > 0) {
        const policy = validatePasswordPolicy(password, {
          email: normalizedEmail,
          name: trimmedName,
        });
        if (!policy.valid) {
          return res.status(400).json({
            error: 'WEAK_PASSWORD',
            errors: policy.errors,
            message: policy.errors.join(' '),
          });
        }
        initialPassword = password;
      }

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existing) {
        return res.status(409).json({
          error: 'EMAIL_ALREADY_EXISTS',
          message: 'Cette adresse e-mail est déjà utilisée par un autre compte.',
        });
      }

      const nowIso = new Date().toISOString();
      const studentId = `usr_stu_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      const passwordHash = await hashPassword(initialPassword);
      const receiptPrefix = activeTenant?.settings.receiptPrefix || 'REC-NL';

      const result = await db.transaction(async (tx) => {
        const txDb = tdb.forTx(tx);
        const existingProfiles = await txDb.selectMany(studentProfiles);
        const usedNumbers = new Set(existingProfiles.map((p) => p.studentIdNumber));
        let nextIndex = existingProfiles.length + 1;
        let studentNum = `ETU-2026-${String(nextIndex).padStart(3, '0')}`;
        while (usedNumbers.has(studentNum)) {
          nextIndex++;
          studentNum = `ETU-2026-${String(nextIndex).padStart(3, '0')}`;
        }

        const createdUser = await txDb.insertOne(users, {
          id: studentId,
          uid: studentId,
          name: trimmedName,
          email: normalizedEmail,
          role: 'STUDENT',
          status: 'ACTIVE',
          phone: phone || '',
          passwordHash,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const createdProfile = await txDb.insertOne(studentProfiles, {
          id: `prf_stu_${crypto.randomUUID()}`,
          userId: studentId,
          studentIdNumber: studentNum,
          city: city || activeTenant?.city || 'Alger',
          wilaya: wilaya || activeTenant?.wilaya || '16 - Alger',
          academicLevel: academicLevel || 'Formation Continue',
          currentClassId: classId || '',
        });

        let resolvedCourseId = courseId;
        if (!resolvedCourseId) {
          const defaultCourse = await txDb.findFirst(courses);
          resolvedCourseId = defaultCourse?.id;
        }

        if (classId) {
          const clsRow = await txDb.findFirst(classes, eq(classes.id, classId));
          if (clsRow) {
            resolvedCourseId = clsRow.courseId;
            await txDb.insertOne(enrollments, {
              id: `enr_${crypto.randomUUID()}`,
              studentId,
              classId,
              courseId: clsRow.courseId,
              enrolledAt: nowIso,
              status: 'ACTIVE',
            });

            await txDb.updateWhere(
              classes,
              { enrolledCount: (clsRow.enrolledCount || 0) + 1 },
              eq(classes.id, classId)
            );
          }
        }

        if (createPendingPayment && resolvedCourseId) {
          const defaultPlan = await txDb.findFirst(subscriptionPlans);
          if (defaultPlan) {
            const payId = `pay_${crypto.randomUUID()}`;
            const subId = `sub_${crypto.randomUUID()}`;
            const today = nowIso.split('T')[0];
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + (defaultPlan.durationMonths || 1) * 30);

            const existingPaymentsCount = await txDb.count(payments);

            await txDb.insertOne(subscriptions, {
              id: subId,
              studentId,
              courseId: resolvedCourseId,
              planId: defaultPlan.id,
              startDate: today,
              endDate: futureDate.toISOString().split('T')[0],
              status: 'PENDING',
              paymentId: payId,
              notes: 'Paiement en attente de versement manuel',
              createdAt: nowIso,
            });

            await txDb.insertOne(payments, {
              id: payId,
              receiptNumber: `${receiptPrefix}-2026-${String(existingPaymentsCount + 1).padStart(4, '0')}_${crypto.randomBytes(1).toString('hex').toUpperCase()}`,
              studentId,
              courseId: resolvedCourseId,
              subscriptionId: subId,
              amountDzd: defaultPlan.priceDzd || 6500,
              currency: activeTenant?.settings.currency || 'DZD',
              paymentMethod: 'BARIDIMOB_CCP',
              transactionReference: 'EN-ATTENTE',
              paymentDate: today,
              status: 'PENDING',
              createdAt: nowIso,
            });
          }
        }

        const selectedCourseRow = resolvedCourseId
          ? await txDb.findFirst(courses, eq(courses.id, resolvedCourseId))
          : undefined;

        await txDb.insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'STUDENT_CREATED',
          entity: 'Student',
          entityId: studentId,
          details: `Création de l étudiant ${trimmedName} (${normalizedEmail}) - N° ${studentNum}.`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });

        return {
          student: sanitizeUser(mapUserRow(createdUser)),
          profile: mapStudentProfileRow(createdProfile),
          courseTitle: selectedCourseRow?.title,
        };
      });

      await dispatchTransactionalNotification({
        userId: result.student.id,
        recipientEmail: result.student.email,
        recipientName: result.student.name,
        templateType: 'ACCOUNT_CREATED',
        appOrigin: extractRequestOrigin(req),
        variables: {
          role: 'STUDENT',
          studentIdNumber: result.profile.studentIdNumber,
          courseTitle: result.courseTitle,
          temporaryPassword: password ? undefined : initialPassword,
        },
      }).catch((err) => {
        console.warn('[NajahLearn SMTP] Student welcome email enqueue warning:', err);
      });

      return res.status(201).json({
        success: true,
        student: result.student,
        profile: result.profile,
      });
    } catch (error: any) {
      console.error('POST /students error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de créer le dossier étudiant.' });
    }
  }
);

apiRouter.patch(
  '/students/:id/status',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ params: idParamSchema, body: updateStudentStatusBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status, administrativeNotes } = req.body as {
        status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
        administrativeNotes?: string;
      };
      const userRow = await tdb.findFirst(
        users,
        and(eq(users.id, req.params.id), eq(users.role, 'STUDENT'))
      );

      if (!userRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Étudiant introuvable.' });
      }

      const nowIso = new Date().toISOString();

      const updated = await db.transaction(async (tx) => {
        const txDb = tdb.forTx(tx);
        const [uRow] = await txDb.updateWhere(
          users,
          { status, updatedAt: nowIso },
          eq(users.id, userRow.id)
        );

        if (administrativeNotes !== undefined) {
          await txDb.updateWhere(
            studentProfiles,
            { administrativeNotes },
            eq(studentProfiles.userId, userRow.id)
          );
        }

        if (status !== 'ACTIVE') {
          await txDb.updateWhere(
            activeSessions,
            {
              revokedAt: nowIso,
              revokedReason: `COMPTE_${status}`,
            },
            and(eq(activeSessions.userId, userRow.id), isNull(activeSessions.revokedAt))!
          );
        }

        await txDb.insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'STUDENT_STATUS_CHANGE',
          entity: 'Student',
          entityId: userRow.id,
          details: `Statut de ${userRow.name} modifié en ${status}.`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });

        return sanitizeUser(mapUserRow(uRow));
      });

      return res.json({ success: true, user: updated });
    } catch (error: any) {
      console.error('PATCH /students/:id/status error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de modifier le statut.' });
    }
  }
);

apiRouter.post(
  '/students/import-csv',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ body: importCsvBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { csvText, dryRun } = req.body as { csvText: string; dryRun: boolean };

      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        return res.status(400).json({
          error: 'EMPTY_CSV',
          message: 'Le fichier CSV doit contenir un en-tête et au moins une ligne de données.',
        });
      }

      if (lines.length > 2001) {
        return res.status(400).json({
          error: 'CSV_TOO_MANY_ROWS',
          message: 'Maximum 2 000 lignes autorisées par importation CSV.',
        });
      }

      const activeTenant = req.tenant || (await getCurrentTenant());
      const maxStudents = activeTenant?.settings.maxStudents ?? 500;

      const [allGlobalUsers, tenantProfiles] = await Promise.all([
        db.select({ email: users.email }).from(users),
        tdb.selectMany(studentProfiles),
      ]);
      const existingEmailSet = new Set(allGlobalUsers.map((u) => u.email.toLowerCase()));
      const usedStudentNumbers = new Set(tenantProfiles.map((p) => p.studentIdNumber));
      let studentCounter = tenantProfiles.length;

      const rows = lines.slice(1);
      const preview: Array<{
        name: string;
        email: string;
        phone: string;
        city: string;
        wilaya: string;
      }> = [];
      const errors: string[] = [];
      let duplicatesCount = 0;
      let formulaNeutralizedCount = 0;
      const validStudentsToCreate: Array<{
        name: string;
        email: string;
        phone: string;
        city: string;
        wilaya: string;
      }> = [];

      for (let i = 0; i < rows.length; i++) {
        const line = rows[i];
        const parts = parseCsvLine(line);
        if (parts.length < 2) {
          errors.push(`Ligne ${i + 2}: Nombre de colonnes insuffisant.`);
          continue;
        }

        const [
          rawName = '',
          rawEmail = '',
          rawPhone = '',
          rawCity = activeTenant?.city || 'Alger',
          rawWilaya = activeTenant?.wilaya || '16 - Alger',
        ] = parts;

        const sanName = sanitizeCsvImportCell(rawName);
        const sanEmail = sanitizeCsvImportCell(rawEmail);
        const sanPhone = sanitizeCsvImportCell(rawPhone, { allowInternationalPhone: true });
        const sanCity = sanitizeCsvImportCell(rawCity || activeTenant?.city || 'Alger');
        const sanWilaya = sanitizeCsvImportCell(rawWilaya || activeTenant?.wilaya || '16 - Alger');

        if (
          sanName.formulaNeutralized ||
          sanEmail.formulaNeutralized ||
          sanPhone.formulaNeutralized ||
          sanCity.formulaNeutralized ||
          sanWilaya.formulaNeutralized
        ) {
          formulaNeutralizedCount++;
        }

        if (
          sanName.dangerousFormulaBlocked ||
          sanEmail.dangerousFormulaBlocked ||
          sanPhone.dangerousFormulaBlocked ||
          sanCity.dangerousFormulaBlocked ||
          sanWilaya.dangerousFormulaBlocked
        ) {
          errors.push(
            `Ligne ${i + 2}: Injection de formule / macro tableur neutralisée et bloquée par sécurité.`
          );
          continue;
        }

        const parsedRow = csvStudentRowZodSchema.safeParse({
          name: sanName.value,
          email: sanEmail.value,
          phone: sanPhone.value,
          city: sanCity.value || activeTenant?.city || 'Alger',
          wilaya: sanWilaya.value || activeTenant?.wilaya || '16 - Alger',
        });

        if (!parsedRow.success) {
          const reason = parsedRow.error.issues[0]?.message || 'Données invalides';
          errors.push(`Ligne ${i + 2}: ${reason}.`);
          continue;
        }

        const item = parsedRow.data;
        if (existingEmailSet.has(item.email)) {
          duplicatesCount++;
          errors.push(
            `Ligne ${i + 2}: Doublon détecté. L adresse "${item.email}" existe déjà en base.`
          );
          continue;
        }

        existingEmailSet.add(item.email);
        preview.push(item);
        validStudentsToCreate.push(item);
      }

      const currentStudentCount = await tdb.count(users, eq(users.role, 'STUDENT'));
      if (currentStudentCount + validStudentsToCreate.length > maxStudents) {
        return res.status(403).json({
          error: 'TENANT_QUOTA_EXCEEDED',
          message: `Import refusé : le quota maximum de votre établissement (${maxStudents} étudiants) serait dépassé.`,
        });
      }

      if (dryRun) {
        return res.json({
          dryRun: true,
          totalRows: rows.length,
          validCount: validStudentsToCreate.length,
          duplicatesCount,
          formulaNeutralizedCount,
          errors,
          preview: preview.slice(0, 5),
        });
      }

      const nowIso = new Date().toISOString();
      let createdCount = 0;

      const preparedStudents = await Promise.all(
        validStudentsToCreate.map(async (s) => {
          const temporaryPassword = generateCompliantTemporaryPassword();
          return {
            ...s,
            temporaryPassword,
            passwordHash: await hashPassword(temporaryPassword),
          };
        })
      );

      const importedAccountsForWelcome: Array<{
        userId: string;
        name: string;
        email: string;
        studentIdNumber: string;
        temporaryPassword: string;
      }> = [];

      await db.transaction(async (tx) => {
        const txDb = tdb.forTx(tx);
        for (const s of preparedStudents) {
          studentCounter++;
          let studentNum = `ETU-2026-${String(studentCounter).padStart(3, '0')}`;
          while (usedStudentNumbers.has(studentNum)) {
            studentCounter++;
            studentNum = `ETU-2026-${String(studentCounter).padStart(3, '0')}`;
          }
          usedStudentNumbers.add(studentNum);

          const studentId = `usr_stu_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

          await txDb.insertOne(users, {
            id: studentId,
            uid: studentId,
            name: s.name,
            email: s.email,
            role: 'STUDENT',
            status: 'ACTIVE',
            phone: s.phone,
            passwordHash: s.passwordHash,
            createdAt: nowIso,
            updatedAt: nowIso,
          });

          await txDb.insertOne(studentProfiles, {
            id: `prf_stu_${crypto.randomUUID()}`,
            userId: studentId,
            studentIdNumber: studentNum,
            city: s.city,
            wilaya: s.wilaya,
            academicLevel: 'Import CSV',
          });

          importedAccountsForWelcome.push({
            userId: studentId,
            name: s.name,
            email: s.email,
            studentIdNumber: studentNum,
            temporaryPassword: s.temporaryPassword,
          });
          createdCount++;
        }

        await txDb.insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'CSV_IMPORT_STUDENTS',
          entity: 'Student',
          details: `Import CSV exécuté : ${createdCount} étudiants créés, ${duplicatesCount} doublons ignorés, ${formulaNeutralizedCount} cellule(s) à préfixe formule neutralisée(s).`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });
      });

      const appOrigin = extractRequestOrigin(req);
      const currentTenantIdForBatch = getCurrentTenantId();
      for (const acc of importedAccountsForWelcome) {
        await dispatchTransactionalNotification({
          tenantId: currentTenantIdForBatch,
          userId: acc.userId,
          recipientEmail: acc.email,
          recipientName: acc.name,
          templateType: 'ACCOUNT_CREATED',
          appOrigin,
          skipImmediateProcess: true,
          variables: {
            role: 'STUDENT',
            studentIdNumber: acc.studentIdNumber,
            temporaryPassword: acc.temporaryPassword,
          },
        }).catch(() => {});
      }
      if (importedAccountsForWelcome.length > 0) {
        setImmediate(() => {
          processEmailQueueBatch({ tenantId: currentTenantIdForBatch, limit: 30 }).catch(() => {});
        });
      }

      return res.json({
        success: true,
        createdCount,
        duplicatesCount,
        formulaNeutralizedCount,
        errors,
      });
    } catch (error: any) {
      console.error('CSV import error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Erreur lors de l importation CSV.' });
    }
  }
);

// =============================================================================
// CLASSES & ENROLLMENTS (TENANT-ISOLATED VIA `tdb` + RBAC + OWNERSHIP)
// =============================================================================

apiRouter.get(
  '/classes',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requester = req.user!;
      const [classRows, courseRows, userRows, teacherProfRows, enrollmentRows] = await Promise.all([
        tdb.selectMany(classes),
        tdb.selectMany(courses),
        tdb.selectMany(users),
        tdb.selectMany(teacherProfiles),
        tdb.selectMany(enrollments, { where: eq(enrollments.status, 'ACTIVE') }),
      ]);

      let scopedClassRows = classRows;
      if (requester.role === 'TEACHER') {
        scopedClassRows = classRows.filter((c) => c.teacherId === requester.id);
      } else if (requester.role === 'STUDENT') {
        const myClassIds = new Set(
          enrollmentRows.filter((e) => e.studentId === requester.id).map((e) => e.classId)
        );
        scopedClassRows = classRows.filter((c) => myClassIds.has(c.id));
      }

      const canViewRoster = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEACHER'].includes(requester.role);

      const enriched = scopedClassRows.map((c) => {
        const courseRow = courseRows.find((crs) => crs.id === c.courseId);
        const teacherRow = userRows.find((u) => u.id === c.teacherId);
        const teacherProf = teacherProfRows.find((p) => p.userId === c.teacherId);
        const enrolledStudents = canViewRoster
          ? enrollmentRows
              .filter((e) => e.classId === c.id)
              .map((e) => userRows.find((u) => u.id === e.studentId))
              .filter((u): u is typeof users.$inferSelect => Boolean(u))
              .map((u) => sanitizeUser(mapUserRow(u)))
          : [];

        return {
          ...mapClassRow(c),
          course: courseRow ? mapCourseRow(courseRow) : undefined,
          teacher: teacherRow
            ? {
                id: teacherRow.id,
                name: teacherRow.name,
                email: teacherRow.email,
                specialty: teacherProf?.specialty,
              }
            : null,
          enrolledStudents,
        };
      });

      return res.json({ classes: enriched });
    } catch (error: any) {
      console.error('GET /classes error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les classes.' });
    }
  }
);

apiRouter.post(
  '/classes',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ body: createClassBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, code, courseId, teacherId, capacity, startDate, endDate } = req.body as {
        name: string;
        code: string;
        courseId: string;
        teacherId: string;
        capacity: number;
        startDate?: string;
        endDate?: string;
      };

      const [courseRow, teacherRow] = await Promise.all([
        tdb.findFirst(courses, eq(courses.id, courseId)),
        tdb.findFirst(users, and(eq(users.id, teacherId), eq(users.role, 'TEACHER'))),
      ]);

      if (!courseRow) {
        return res.status(404).json({ error: 'COURSE_NOT_FOUND', message: 'Formation introuvable.' });
      }
      if (!teacherRow) {
        return res
          .status(404)
          .json({ error: 'TEACHER_NOT_FOUND', message: 'Enseignant introuvable.' });
      }

      const newClassId = `cls_${crypto.randomUUID()}`;

      const created = await db.transaction(async (tx) => {
        const txDb = tdb.forTx(tx);
        const clsRow = await txDb.insertOne(classes, {
          id: newClassId,
          name,
          code,
          courseId,
          teacherId,
          capacity: Number(capacity) || 25,
          enrolledCount: 0,
          startDate: startDate || new Date().toISOString().split('T')[0],
          endDate:
            endDate || new Date(Date.now() + 120 * 86400000).toISOString().split('T')[0],
          status: 'ACTIVE',
        });

        const tp = await txDb.findFirst(teacherProfiles, eq(teacherProfiles.userId, teacherId));

        if (tp) {
          const currentIds = Array.isArray(tp.assignedClassIds) ? tp.assignedClassIds : [];
          if (!currentIds.includes(newClassId)) {
            await txDb.updateWhere(
              teacherProfiles,
              { assignedClassIds: [...currentIds, newClassId] },
              eq(teacherProfiles.id, tp.id)
            );
          }
        }

        return mapClassRow(clsRow);
      });

      return res.status(201).json({ success: true, class: created });
    } catch (error: any) {
      console.error('POST /classes error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de créer la classe.' });
    }
  }
);

// =============================================================================
// SESSIONS & VIDEOCONFERENCE (TENANT-ISOLATED VIA `tdb` + PROTECTED JOIN)
// =============================================================================

apiRouter.get(
  '/sessions',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ query: sessionsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { classId, teacherId } = req.query as { classId?: string; teacherId?: string };
      const requester = req.user!;

      const [sessionRows, courseRows, classRows, userRows] = await Promise.all([
        tdb.selectMany(sessions, { orderBy: asc(sessions.scheduledAt) }),
        tdb.selectMany(courses),
        tdb.selectMany(classes),
        tdb.selectMany(users),
      ]);

      let list = sessionRows.map(mapSessionRow);

      // Anti-IDOR for TEACHER: can only view sessions of their own classes / teacherId
      if (requester.role === 'TEACHER') {
        if (teacherId && teacherId !== requester.id) {
          await logBlockedOwnershipAttempt(
            req,
            'Session',
            teacherId,
            `Enseignant ${requester.email} a tenté de consulter les séances d un autre enseignant (${teacherId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit : vous ne pouvez consulter que vos propres séances.',
          });
        }
        const myClassIds = new Set(
          classRows.filter((c) => c.teacherId === requester.id).map((c) => c.id)
        );
        if (classId && !myClassIds.has(classId)) {
          await logBlockedOwnershipAttempt(
            req,
            'Class',
            classId,
            `Enseignant ${requester.email} a tenté de filtrer les séances d une classe non assignée (${classId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit : cette classe ne vous est pas affectée.',
          });
        }
        list = list.filter((s) => s.teacherId === requester.id || myClassIds.has(s.classId));
      }

      // Anti-IDOR for STUDENT: can only view sessions of classes in which they are actively enrolled
      if (requester.role === 'STUDENT') {
        if (teacherId) {
          await logBlockedOwnershipAttempt(
            req,
            'Session',
            teacherId,
            `Étudiant ${requester.email} a tenté d énumérer les séances par teacherId (${teacherId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit : filtre enseignant non autorisé pour un compte étudiant.',
          });
        }

        const studentEnrollments = await tdb.selectMany(enrollments, {
          where: and(eq(enrollments.studentId, requester.id), eq(enrollments.status, 'ACTIVE')),
        });
        const enrolledClassIds = new Set(studentEnrollments.map((e) => e.classId));

        if (classId && !enrolledClassIds.has(classId)) {
          await logBlockedOwnershipAttempt(
            req,
            'Class',
            classId,
            `Étudiant ${requester.email} a tenté de lister les séances d une classe non inscrite (${classId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit : vous n êtes pas inscrit dans cette classe.',
          });
        }

        list = list.filter((s) => enrolledClassIds.has(s.classId));
      }

      if (classId) {
        list = list.filter((s) => s.classId === classId);
      }
      if (teacherId) {
        list = list.filter((s) => s.teacherId === teacherId);
      }

      const isAdminOrManager = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(requester.role);

      const enriched = list.map((s) => {
        const course = courseRows.find((c) => c.id === s.courseId);
        const classEntity = classRows.find((c) => c.id === s.classId);
        const teacher = userRows.find((u) => u.id === s.teacherId);
        const canSeeDirectJoinUrl =
          isAdminOrManager || (requester.role === 'TEACHER' && s.teacherId === requester.id);

        return {
          ...s,
          courseTitle: course?.title || '',
          className: classEntity?.name || '',
          teacherName: teacher?.name || '',
          videoJoinUrl: canSeeDirectJoinUrl ? s.videoJoinUrl : undefined,
        };
      });

      return res.json({ sessions: enriched });
    } catch (error: any) {
      console.error('GET /sessions error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les séances.' });
    }
  }
);

apiRouter.post(
  '/sessions',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'TEACHER']),
  validateRequest({ body: createSessionBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { courseId, classId, teacherId, title, description, scheduledAt, durationMinutes } =
        req.body as {
          courseId: string;
          classId: string;
          teacherId?: string;
          title: string;
          description?: string;
          scheduledAt: string;
          durationMinutes: number;
        };

      const classRow = await tdb.findFirst(classes, eq(classes.id, classId));
      if (!classRow) {
        return res.status(404).json({ error: 'CLASS_NOT_FOUND', message: 'Classe introuvable.' });
      }

      if (classRow.courseId !== courseId) {
        return res.status(400).json({
          error: 'COURSE_CLASS_MISMATCH',
          message: 'La classe sélectionnée n appartient pas à la formation indiquée.',
        });
      }

      // Anti-IDOR: TEACHER can only schedule sessions in their own assigned classes and for themselves
      if (req.user!.role === 'TEACHER') {
        if (classRow.teacherId !== req.user!.id || (teacherId && teacherId !== req.user!.id)) {
          await logBlockedOwnershipAttempt(
            req,
            'Class',
            classId,
            `Enseignant ${req.user!.email} a tenté de planifier une séance sur une classe non assignée (${classId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message:
              'Accès interdit : vous ne pouvez planifier des séances que pour vos propres classes.',
          });
        }
      }

      const finalTeacherId = teacherId || classRow.teacherId || req.user!.id;

      const meeting = await scheduleMeeting({
        topic: title,
        startTime: scheduledAt,
        durationMinutes: Number(durationMinutes) || 90,
        timezone: req.tenant?.settings.timezone || 'Africa/Algiers',
      });

      const nowIso = new Date().toISOString();
      const newSessionId = `ses_${crypto.randomUUID()}`;

      const { createdSession, enrolledStudents, courseRow, teacherRow } = await db.transaction(
        async (tx) => {
          const txDb = tdb.forTx(tx);
          const sesRow = await txDb.insertOne(sessions, {
            id: newSessionId,
            courseId,
            classId,
            teacherId: finalTeacherId,
            title,
            description: description || '',
            scheduledAt,
            durationMinutes: Number(durationMinutes) || 90,
            videoProvider: meeting.provider,
            videoMeetingId: meeting.meetingId,
            videoJoinUrl: meeting.joinUrl,
            videoPasscode: meeting.passcode,
            status: 'SCHEDULED',
            createdAt: nowIso,
          });

          const [classEnrollments, crsRow, tchRow] = await Promise.all([
            txDb.selectMany(enrollments, {
              where: and(eq(enrollments.classId, classId), eq(enrollments.status, 'ACTIVE')),
            }),
            txDb.findFirst(courses, eq(courses.id, courseId)),
            txDb.findFirst(users, eq(users.id, finalTeacherId)),
          ]);

          const enrIds = classEnrollments.map((e) => e.studentId);
          const stuRows =
            enrIds.length > 0
              ? await txDb.selectMany(users, {
                  where: and(inArray(users.id, enrIds), eq(users.status, 'ACTIVE')),
                })
              : [];

          return {
            createdSession: mapSessionRow(sesRow),
            enrolledStudents: stuRows,
            courseRow: crsRow,
            teacherRow: tchRow,
          };
        }
      );

      const appOrigin = extractRequestOrigin(req);
      const activeTenantIdForSession = getCurrentTenantId();
      const scheduledDisplay = scheduledAt.replace('T', ' ').slice(0, 16);

      for (const stu of enrolledStudents) {
        await dispatchTransactionalNotification({
          tenantId: activeTenantIdForSession,
          userId: stu.id,
          recipientEmail: stu.email,
          recipientName: stu.name,
          preferredLocale: stu.preferredLanguage === 'ar' ? 'ar' : 'fr',
          templateType: 'SESSION_REMINDER',
          dedupKey: `ses_rem:${createdSession.id}:${stu.id}`,
          appOrigin,
          skipImmediateProcess: true,
          variables: {
            sessionId: createdSession.id,
            sessionTitle: title,
            courseTitle: courseRow?.title || '',
            className: classRow.name,
            teacherName: teacherRow?.name || '',
            scheduledAt,
            scheduledDisplay,
            durationMinutes: Number(durationMinutes) || 90,
            videoProvider: meeting.provider,
          },
        }).catch((err) => {
          console.warn('[NajahLearn SMTP] Session reminder enqueue warning:', err);
        });
      }

      if (enrolledStudents.length > 0) {
        setImmediate(() => {
          processEmailQueueBatch({ tenantId: activeTenantIdForSession, limit: 30 }).catch(() => {});
        });
      }

      return res.status(201).json({
        success: true,
        session: createdSession,
        zoomNotice: meeting.statusMessage,
      });
    } catch (error: any) {
      console.error('POST /sessions error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de programmer la séance.' });
    }
  }
);

apiRouter.put(
  '/sessions/:id',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'TEACHER']),
  validateRequest({ params: idParamSchema, body: updateSessionBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const sessionRow = await tdb.findFirst(sessions, eq(sessions.id, req.params.id));

      if (!sessionRow) {
        return res
          .status(404)
          .json({ error: 'SESSION_NOT_FOUND', message: 'Séance de cours introuvable.' });
      }

      // Anti-IDOR: TEACHER can only update sessions they own
      if (req.user!.role === 'TEACHER' && sessionRow.teacherId !== req.user!.id) {
        await logBlockedOwnershipAttempt(
          req,
          'Session',
          sessionRow.id,
          `Enseignant ${req.user!.email} a tenté de modifier la séance ${sessionRow.id} appartenant à ${sessionRow.teacherId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez modifier que vos propres séances.',
        });
      }

      const { title, description, scheduledAt, durationMinutes, status } = req.body as {
        title?: string;
        description?: string;
        scheduledAt?: string;
        durationMinutes?: number;
        status?: 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'POSTPONED' | 'CANCELLED';
      };

      const [updated] = await tdb.updateWhere(
        sessions,
        {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(scheduledAt !== undefined ? { scheduledAt } : {}),
          ...(durationMinutes !== undefined ? { durationMinutes } : {}),
          ...(status !== undefined ? { status } : {}),
        },
        eq(sessions.id, sessionRow.id)
      );

      return res.json({
        success: true,
        session: mapSessionRow(updated),
      });
    } catch (error: any) {
      console.error('PUT /sessions/:id error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de modifier la séance.' });
    }
  }
);

apiRouter.get(
  '/sessions/:id/join',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const sessionRow = await tdb.findFirst(sessions, eq(sessions.id, req.params.id));

      if (!sessionRow) {
        return res
          .status(404)
          .json({ error: 'SESSION_NOT_FOUND', message: 'Séance de cours introuvable.' });
      }

      const session = mapSessionRow(sessionRow);
      const user = req.user!;

      if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user.role)) {
        return res.json({
          canJoin: true,
          role: user.role,
          videoJoinUrl: session.videoJoinUrl,
          videoProvider: session.videoProvider,
          videoMeetingId: session.videoMeetingId,
          videoPasscode: session.videoPasscode,
        });
      }

      if (user.role === 'TEACHER') {
        if (session.teacherId === user.id) {
          return res.json({
            canJoin: true,
            role: 'HOST_TEACHER',
            videoJoinUrl: session.videoJoinUrl,
            videoProvider: session.videoProvider,
            videoMeetingId: session.videoMeetingId,
            videoPasscode: session.videoPasscode,
          });
        }
        await logBlockedOwnershipAttempt(
          req,
          'Session',
          session.id,
          `Enseignant ${user.email} a tenté de rejoindre la séance ${session.id} d un autre enseignant.`
        );
        return res.status(403).json({
          canJoin: false,
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          reason: 'Enseignant non affecté à cette séance.',
          message: 'Enseignant non affecté à cette séance.',
        });
      }

      // Anti-IDOR for STUDENT: verify active enrollment in this exact session.classId AND active subscription
      const specificClassEnrollment = await tdb.findFirst(
        enrollments,
        and(
          eq(enrollments.studentId, user.id),
          eq(enrollments.classId, session.classId),
          eq(enrollments.status, 'ACTIVE')
        )
      );

      if (!specificClassEnrollment) {
        await logBlockedOwnershipAttempt(
          req,
          'Session',
          session.id,
          `Étudiant ${user.email} non inscrit dans la classe ${session.classId} a tenté de rejoindre ${session.id}.`
        );
        return res.status(403).json({
          canJoin: false,
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          reason: 'Vous n êtes pas inscrit dans la classe associée à cette séance.',
          message: 'Vous n êtes pas inscrit dans la classe associée à cette séance.',
        });
      }

      const accessCheck = await verifyStudentAccess(user.id, session.courseId);

      if (!accessCheck.hasAccess) {
        await tdb.insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: 'BLOCKED_SESSION_ACCESS_ATTEMPT',
          entity: 'Session',
          entityId: session.id,
          details: `Tentative d accès bloquée à la séance "${session.title}" : ${accessCheck.reason}`,
          ipAddress: extractClientIp(req),
          timestamp: new Date().toISOString(),
        });

        return res.status(403).json({
          canJoin: false,
          error: 'ACCESS_DENIED',
          reason: accessCheck.reason,
          message: accessCheck.reason,
        });
      }

      return res.json({
        canJoin: true,
        role: 'STUDENT',
        videoJoinUrl: session.videoJoinUrl,
        videoProvider: session.videoProvider,
        videoMeetingId: session.videoMeetingId,
        videoPasscode: session.videoPasscode,
        subscriptionValidUntil: accessCheck.subscription?.endDate,
      });
    } catch (error: any) {
      console.error('GET /sessions/:id/join error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Erreur lors de l ouverture de la séance.' });
    }
  }
);

// =============================================================================
// ATTENDANCE MANAGEMENT (TENANT-ISOLATED VIA `tdb` + RBAC + SESSION OWNERSHIP)
// =============================================================================

apiRouter.get(
  '/attendance/session/:sessionId',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'TEACHER']),
  validateRequest({ params: sessionIdParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const sessionRow = await tdb.findFirst(sessions, eq(sessions.id, req.params.sessionId));

      if (!sessionRow) {
        return res
          .status(404)
          .json({ error: 'SESSION_NOT_FOUND', message: 'Séance introuvable.' });
      }

      // Anti-IDOR: TEACHER can only read attendance roster for their own session
      if (req.user!.role === 'TEACHER' && sessionRow.teacherId !== req.user!.id) {
        await logBlockedOwnershipAttempt(
          req,
          'AttendanceSession',
          sessionRow.id,
          `Enseignant ${req.user!.email} a tenté de lire la feuille d émargement de ${sessionRow.id} (propriétaire: ${sessionRow.teacherId}).`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : cette feuille d émargement appartient à un autre enseignant.',
        });
      }

      const [classEnrollments, existingRecords] = await Promise.all([
        tdb.selectMany(enrollments, {
          where: and(
            eq(enrollments.classId, sessionRow.classId),
            eq(enrollments.status, 'ACTIVE')
          ),
        }),
        tdb.selectMany(attendanceRecords, {
          where: eq(attendanceRecords.sessionId, sessionRow.id),
        }),
      ]);

      const studentIds = classEnrollments.map((e) => e.studentId);
      const [studentRows, profileRows] =
        studentIds.length > 0
          ? await Promise.all([
              tdb.selectMany(users, { where: inArray(users.id, studentIds) }),
              tdb.selectMany(studentProfiles, {
                where: inArray(studentProfiles.userId, studentIds),
              }),
            ])
          : [[], []];

      const roster = classEnrollments.map((enr) => {
        const student = studentRows.find((u) => u.id === enr.studentId);
        const profile = profileRows.find((p) => p.userId === enr.studentId);
        const record = existingRecords.find((r) => r.studentId === enr.studentId);

        return {
          studentId: enr.studentId,
          studentName: student?.name || 'Étudiant',
          studentEmail: student?.email || '',
          studentIdNumber: profile?.studentIdNumber || '',
          status: (record?.status as AttendanceStatus) || 'ABSENT',
          minutesLate: record?.minutesLate || 0,
          teacherComment: record?.teacherComment || '',
          markedAt: record?.markedAt,
        };
      });

      return res.json({ session: mapSessionRow(sessionRow), roster });
    } catch (error: any) {
      console.error('GET /attendance/session/:sessionId error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Erreur chargement feuille d appel.' });
    }
  }
);

apiRouter.post(
  '/attendance/session/:sessionId',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'TEACHER']),
  validateRequest({ params: sessionIdParamSchema, body: saveAttendanceBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { entries } = req.body as {
        entries: Array<{
          studentId: string;
          status: AttendanceStatus;
          minutesLate?: number;
          teacherComment?: string;
        }>;
      };

      const sessionId = req.params.sessionId;
      const sessionRow = await tdb.findFirst(sessions, eq(sessions.id, sessionId));

      if (!sessionRow) {
        return res
          .status(404)
          .json({ error: 'SESSION_NOT_FOUND', message: 'Séance introuvable.' });
      }

      // Anti-IDOR: TEACHER can only record attendance for their own session
      if (req.user!.role === 'TEACHER' && sessionRow.teacherId !== req.user!.id) {
        await logBlockedOwnershipAttempt(
          req,
          'AttendanceSession',
          sessionRow.id,
          `Enseignant ${req.user!.email} a tenté de modifier l émargement de ${sessionRow.id}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message:
            'Accès interdit : vous ne pouvez saisir les présences que pour vos propres séances.',
        });
      }

      // Anti-IDOR: Verify every submitted studentId is actively enrolled in sessionRow.classId within active tenant
      const classEnrollments = await tdb.selectMany(enrollments, {
        where: and(eq(enrollments.classId, sessionRow.classId), eq(enrollments.status, 'ACTIVE')),
      });
      const enrolledStudentIdSet = new Set(classEnrollments.map((e) => e.studentId));

      for (const entry of entries) {
        if (!enrolledStudentIdSet.has(entry.studentId)) {
          await logBlockedOwnershipAttempt(
            req,
            'AttendanceRecord',
            entry.studentId,
            `Tentative d émargement d un étudiant (${entry.studentId}) non inscrit dans la classe ${sessionRow.classId}.`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: `L étudiant ${entry.studentId} n est pas inscrit dans la classe associée à cette séance.`,
          });
        }
      }

      const nowIso = new Date().toISOString();
      const activeTenantId = getCurrentTenantId();

      await db.transaction(async (tx) => {
        for (const entry of entries) {
          await tx
            .insert(attendanceRecords)
            .values({
              id: `att_${crypto.randomUUID()}`,
              tenantId: activeTenantId,
              sessionId,
              studentId: entry.studentId,
              status: entry.status,
              minutesLate: entry.minutesLate || 0,
              teacherComment: entry.teacherComment || '',
              markedBy: req.user!.id,
              markedAt: nowIso,
              updatedAt: nowIso,
            })
            .onConflictDoUpdate({
              target: [attendanceRecords.sessionId, attendanceRecords.studentId],
              set: {
                status: entry.status,
                minutesLate: entry.minutesLate || 0,
                teacherComment: entry.teacherComment || '',
                markedBy: req.user!.id,
                updatedAt: nowIso,
              },
            });
        }
      });

      return res.json({
        success: true,
        message: 'Feuille d émargement enregistrée avec succès.',
      });
    } catch (error: any) {
      console.error('POST /attendance/session/:sessionId error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible d enregistrer l émargement.' });
    }
  }
);

apiRouter.get(
  '/attendance/my-records',
  authenticateToken,
  requireRole(['STUDENT']),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const studentId = req.user!.id;
      const [recordRows, sessionRows, courseRows] = await Promise.all([
        tdb.selectMany(attendanceRecords, {
          where: eq(attendanceRecords.studentId, studentId),
          orderBy: desc(attendanceRecords.markedAt),
        }),
        tdb.selectMany(sessions),
        tdb.selectMany(courses),
      ]);

      const enriched = recordRows.map((r) => {
        const session = sessionRows.find((s) => s.id === r.sessionId);
        const course = session ? courseRows.find((c) => c.id === session.courseId) : null;
        return {
          ...mapAttendanceRow(r),
          sessionTitle: session?.title || 'Séance',
          sessionDate: session?.scheduledAt,
          courseTitle: course?.title || '',
        };
      });

      const total = enriched.length;
      const presentCount = enriched.filter((r) => r.status === 'PRESENT').length;
      const rate = total > 0 ? Math.round((presentCount / total) * 100) : 100;

      return res.json({
        records: enriched,
        attendanceRate: rate,
        totalSessions: total,
        presentCount,
      });
    } catch (error: any) {
      console.error('GET /attendance/my-records error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger vos présences.' });
    }
  }
);

// =============================================================================
// PAYMENTS & SUBSCRIPTIONS (TENANT-ISOLATED VIA `tdb` + CUSTOM SCHOOL RECEIPTS)
// =============================================================================

apiRouter.get(
  '/payments',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const activeTenant = req.tenant || (await getCurrentTenant());
      const receiptTenantMeta = buildReceiptTenantMetadata(activeTenant);

      const paymentRows =
        user.role === 'STUDENT'
          ? await tdb.selectMany(payments, {
              where: eq(payments.studentId, user.id),
              orderBy: desc(payments.createdAt),
            })
          : await tdb.selectMany(payments, { orderBy: desc(payments.createdAt) });

      const [userRows, profileRows, courseRows, invoiceRows] = await Promise.all([
        tdb.selectMany(users),
        tdb.selectMany(studentProfiles),
        tdb.selectMany(courses),
        tdb.selectMany(invoices),
      ]);

      const invByPay = new Map(invoiceRows.map((inv) => [inv.paymentId, inv]));

      const enriched = paymentRows.map((p) => {
        const student = userRows.find((u) => u.id === p.studentId);
        const profile = profileRows.find((prf) => prf.userId === p.studentId);
        const course = courseRows.find((c) => c.id === p.courseId);
        const linkedInv = invByPay.get(p.id);
        return {
          ...mapPaymentRow(p),
          studentName: student?.name || 'Étudiant',
          studentEmail: student?.email || '',
          studentIdNumber: profile?.studentIdNumber || '',
          courseTitle: course?.title || 'Formation',
          invoiceId: linkedInv?.id,
          invoiceNumber: linkedInv?.invoiceNumber,
          tenant: receiptTenantMeta,
        };
      });

      return res.json({ payments: enriched });
    } catch (error: any) {
      console.error('GET /payments error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les paiements.' });
    }
  }
);

// Declare `/payments/export-csv` and `/payments/chargily/*` BEFORE `/payments/:id`
apiRouter.get(
  '/payments/export-csv',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activeTenant = req.tenant || (await getCurrentTenant());
      const [paymentRows, userRows, courseRows, invoiceRows] = await Promise.all([
        tdb.selectMany(payments, { orderBy: desc(payments.createdAt) }),
        tdb.selectMany(users),
        tdb.selectMany(courses),
        tdb.selectMany(invoices),
      ]);
      const invByPay = new Map(invoiceRows.map((inv) => [inv.paymentId, inv]));

      const headers = [
        'Etablissement',
        'N Recu',
        'Etudiant',
        'Email',
        'Formation',
        'Montant DZD',
        'Mode Paiement',
        'Reference',
        'Date Paiement',
        'Statut',
        'N Facture',
      ];
      const rows = paymentRows.map((p) => {
        const student = userRows.find((u) => u.id === p.studentId);
        const course = courseRows.find((c) => c.id === p.courseId);
        const inv = invByPay.get(p.id);
        return [
          escapeCsvCell(activeTenant?.name || p.tenantId),
          escapeCsvCell(p.receiptNumber),
          escapeCsvCell(student?.name || ''),
          escapeCsvCell(student?.email || ''),
          escapeCsvCell(course?.title || ''),
          escapeCsvCell(p.amountDzd),
          escapeCsvCell(p.paymentMethod),
          escapeCsvCell(p.transactionReference),
          escapeCsvCell(p.paymentDate),
          escapeCsvCell(p.status),
          escapeCsvCell(inv?.invoiceNumber || ''),
        ].join(',');
      });

      const slug = activeTenant?.slug || 'etablissement';
      const csv = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="paiements_${slug}.csv"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send('\uFEFF' + csv);
    } catch (error: any) {
      console.error('Export payments CSV error:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erreur export CSV.' });
    }
  }
);

// Chargily Pay V2 Online Checkout Creation (CIB & Edahabia)
apiRouter.post(
  '/payments/chargily/checkout',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ body: createChargilyCheckoutBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const {
        courseId,
        cardMethod,
        installmentItemId,
        installmentsCount,
        idempotencyKey,
        locale,
      } = req.body as {
        courseId: string;
        cardMethod: 'edahabia' | 'cib';
        installmentItemId?: string;
        installmentsCount?: number;
        idempotencyKey?: string;
        locale?: 'fr' | 'ar';
      };

      const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
      const host = req.get('host');
      const appOrigin = host ? `${proto}://${host}` : process.env.APP_URL;

      const created = await createChargilyCheckout({
        studentId: user.id,
        courseId,
        cardMethod,
        installmentItemId,
        installmentsCount,
        idempotencyKey,
        locale: locale || (user.preferredLanguage === 'ar' ? 'ar' : 'fr'),
        appOrigin,
        ipAddress: extractClientIp(req),
      });

      return res.status(created.reusedIdempotent ? 200 : 201).json({
        success: true,
        ...created,
      });
    } catch (error: any) {
      const code = error?.message || 'SERVER_ERROR';
      if (code === 'CHARGILY_GATEWAY_DISABLED') {
        return res.status(503).json({
          error: 'CHARGILY_GATEWAY_DISABLED',
          message:
            'Le paiement en ligne Chargily Pay est actuellement désactivé par l établissement. Veuillez utiliser CCP / BaridiMob.',
        });
      }
      if (code === 'COURSE_NOT_FOUND' || code === 'INSTALLMENT_ITEM_NOT_FOUND') {
        return res.status(404).json({
          error: code,
          message: 'Formation ou échéance introuvable.',
        });
      }
      if (code === 'INSTALLMENT_ALREADY_PAID') {
        return res.status(409).json({
          error: 'INSTALLMENT_ALREADY_PAID',
          message: 'Cette échéance a déjà été réglée.',
        });
      }
      if (code === 'INSTALLMENTS_DISABLED_FOR_TENANT') {
        return res.status(403).json({
          error: code,
          message: 'Le paiement échelonné est désactivé pour cet établissement.',
        });
      }
      console.error('POST /payments/chargily/checkout error:', error);
      return res.status(500).json({
        error: 'CHARGILY_CHECKOUT_ERROR',
        message: error?.message || 'Impossible d initialiser le paiement Chargily Pay.',
      });
    }
  }
);

// Chargily Pay V2 Test-Mode Interactive Sandbox Simulator (executes real HMAC-SHA256 webhook verification)
apiRouter.post(
  '/payments/chargily/sandbox/:checkoutId/simulate',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({
    params: checkoutIdParamSchema,
    body: simulateChargilySandboxBodySchema,
  }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { outcome, eventIdOverride, failureReason } = req.body as {
        outcome: 'paid' | 'failed' | 'canceled' | 'expired';
        eventIdOverride?: string;
        failureReason?: string;
      };

      const result = await simulateChargilySandboxEvent({
        checkoutId: req.params.checkoutId,
        outcome,
        eventIdOverride,
        failureReason,
        requestedByUserId: user.id,
        requestedByRole: user.role,
        ipAddress: extractClientIp(req),
      });

      return res.status(result.statusCode).json(result);
    } catch (error: any) {
      const code = error?.message || '';
      if (code === 'CHECKOUT_NOT_FOUND') {
        return res.status(404).json({
          error: 'CHECKOUT_NOT_FOUND',
          message: 'Session Chargily Checkout introuvable.',
        });
      }
      if (code === 'FORBIDDEN_RESOURCE_OWNERSHIP') {
        await logBlockedOwnershipAttempt(
          req,
          'ChargilyCheckout',
          req.params.checkoutId,
          `Tentative IDOR de simulation Chargily sur ${req.params.checkoutId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : cette session de paiement appartient à un autre étudiant.',
        });
      }
      if (code === 'SANDBOX_ONLY_IN_TEST_MODE') {
        return res.status(403).json({
          error: 'SANDBOX_ONLY_IN_TEST_MODE',
          message: 'La simulation interactive n est disponible qu en mode Test.',
        });
      }
      console.error('POST /payments/chargily/sandbox/:checkoutId/simulate error:', error);
      return res.status(500).json({
        error: 'SANDBOX_SIMULATION_ERROR',
        message: 'Erreur lors de la simulation du webhook Chargily.',
      });
    }
  }
);

// Chargily Pay V2 Signed Server-to-Server Webhook Endpoint (HMAC-SHA256 verified over rawBody)
const handleChargilyWebhookRoute = async (req: Request, res: Response) => {
  try {
    const signatureHeader =
      req.get('signature') || req.get('x-chargily-signature') || undefined;
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody ||
      Buffer.from(JSON.stringify(req.body || {}), 'utf8');

    const result = await processChargilyWebhook({
      rawBody,
      signatureHeader,
      parsedBody: (req.body || {}) as Record<string, any>,
      tenantSlugHint: req.params.tenantSlug,
      ipAddress: extractClientIp(req),
    });

    return res.status(result.statusCode).json(result);
  } catch (error: any) {
    console.error('POST /webhooks/chargily error:', error);
    return res.status(500).json({
      error: 'WEBHOOK_PROCESSING_ERROR',
      message: 'Erreur lors du traitement du webhook Chargily Pay.',
    });
  }
};

apiRouter.post(
  '/webhooks/chargily',
  validateRequest({ body: chargilyWebhookBodySchema }),
  handleChargilyWebhookRoute
);

apiRouter.post(
  '/webhooks/chargily/:tenantSlug',
  validateRequest({
    params: webhookTenantSlugParamSchema,
    body: chargilyWebhookBodySchema,
  }),
  handleChargilyWebhookRoute
);

apiRouter.get(
  '/payments/:id',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const paymentRow = await tdb.findFirst(payments, eq(payments.id, req.params.id));

      if (!paymentRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Reçu de paiement introuvable.' });
      }

      // Anti-IDOR: STUDENT can only view their own payment receipt
      if (req.user!.role === 'STUDENT' && paymentRow.studentId !== req.user!.id) {
        await logBlockedOwnershipAttempt(
          req,
          'Payment',
          paymentRow.id,
          `Étudiant ${req.user!.email} a tenté de consulter le reçu ${paymentRow.id} appartenant à ${paymentRow.studentId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : ce reçu de paiement appartient à un autre étudiant.',
        });
      }

      const [student, profile, course, linkedInv, activeTenant] = await Promise.all([
        tdb.findFirst(users, eq(users.id, paymentRow.studentId)),
        tdb.findFirst(studentProfiles, eq(studentProfiles.userId, paymentRow.studentId)),
        tdb.findFirst(courses, eq(courses.id, paymentRow.courseId)),
        tdb.findFirst(invoices, eq(invoices.paymentId, paymentRow.id)),
        req.tenant ? Promise.resolve(req.tenant) : getCurrentTenant(),
      ]);

      return res.json({
        payment: {
          ...mapPaymentRow(paymentRow),
          studentName: student?.name || 'Étudiant',
          studentEmail: student?.email || '',
          studentIdNumber: profile?.studentIdNumber || '',
          courseTitle: course?.title || 'Formation',
          invoiceId: linkedInv?.id,
          invoiceNumber: linkedInv?.invoiceNumber,
          tenant: buildReceiptTenantMetadata(activeTenant),
        },
      });
    } catch (error: any) {
      console.error('GET /payments/:id error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger ce reçu de paiement.' });
    }
  }
);

apiRouter.post(
  '/payments',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ body: createPaymentBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        studentId,
        courseId,
        installmentItemId,
        amountDzd,
        paymentMethod,
        transactionReference,
        administrativeNotes,
        receiptUploadId,
      } = req.body as {
        studentId?: string;
        courseId: string;
        installmentItemId?: string;
        amountDzd: number;
        paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'BARIDIMOB_CCP' | 'CHEQUE' | 'ONLINE_CARD';
        transactionReference?: string;
        administrativeNotes?: string;
        receiptUploadId?: string;
      };

      const user = req.user!;
      const activeTenant = req.tenant || (await getCurrentTenant());

      if (user.role === 'STUDENT' && activeTenant && !activeTenant.settings.allowManualPayments) {
        return res.status(403).json({
          error: 'MANUAL_PAYMENTS_DISABLED',
          message:
            'La déclaration manuelle de paiement est désactivée par votre établissement. Veuillez régler en ligne par CIB / Edahabia ou auprès de la scolarité.',
        });
      }

      // Anti-IDOR: STUDENT cannot declare a payment on behalf of another studentId
      if (user.role === 'STUDENT' && studentId && studentId !== user.id) {
        await logBlockedOwnershipAttempt(
          req,
          'Payment',
          studentId,
          `Étudiant ${user.email} a tenté de déclarer un paiement au nom d un tiers (${studentId}).`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez déclarer un paiement que pour votre propre compte.',
        });
      }

      const targetStudentId = user.role === 'STUDENT' ? user.id : studentId || user.id;

      const [courseRow, studentRow] = await Promise.all([
        tdb.findFirst(courses, eq(courses.id, courseId)),
        tdb.findFirst(users, eq(users.id, targetStudentId)),
      ]);

      if (!courseRow) {
        return res.status(404).json({ error: 'COURSE_NOT_FOUND', message: 'Formation introuvable.' });
      }
      if (!studentRow) {
        return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Étudiant introuvable.' });
      }

      let validatedInstallmentItemId: string | null = null;
      let effectiveAmountDzd = Math.round(amountDzd);

      if (installmentItemId) {
        const itemRow = await tdb.findFirst(
          installmentItems,
          eq(installmentItems.id, installmentItemId)
        );
        if (!itemRow || itemRow.studentId !== targetStudentId || itemRow.courseId !== courseId) {
          return res.status(404).json({
            error: 'INSTALLMENT_ITEM_NOT_FOUND',
            message: 'Échéance introuvable pour cet étudiant et cette formation.',
          });
        }
        if (itemRow.status === 'PAID') {
          return res.status(409).json({
            error: 'INSTALLMENT_ALREADY_PAID',
            message: 'Cette échéance a déjà été réglée.',
          });
        }
        validatedInstallmentItemId = itemRow.id;
        effectiveAmountDzd = itemRow.amountDzd;
      }

      let receiptAttachmentUrl: string | undefined = undefined;
      if (receiptUploadId) {
        const uploadRow = await tdb.findFirst(uploadedFiles, eq(uploadedFiles.id, receiptUploadId));

        if (!uploadRow || uploadRow.category !== 'PAYMENT_RECEIPT') {
          return res.status(404).json({
            error: 'RECEIPT_UPLOAD_NOT_FOUND',
            message: 'Justificatif de paiement introuvable.',
          });
        }

        if (uploadRow.paymentId) {
          return res.status(409).json({
            error: 'RECEIPT_ALREADY_LINKED',
            message: 'Ce justificatif est déjà rattaché à un autre règlement.',
          });
        }

        const isAllowedOwner =
          user.role === 'STUDENT'
            ? uploadRow.ownerId === user.id
            : uploadRow.ownerId === targetStudentId || uploadRow.ownerId === user.id;

        if (!isAllowedOwner) {
          await logBlockedOwnershipAttempt(
            req,
            'UploadedFile',
            receiptUploadId,
            `Utilisateur ${user.email} a tenté d associer le justificatif ${receiptUploadId} appartenant à ${uploadRow.ownerId}.`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit : ce justificatif appartient à un autre utilisateur.',
          });
        }

        receiptAttachmentUrl = `/api/uploads/${uploadRow.id}/download`;
      }

      const nowIso = new Date().toISOString();
      const todayStr = nowIso.split('T')[0];
      const newPaymentId = `pay_${crypto.randomUUID()}`;
      const receiptPrefix = activeTenant?.settings.receiptPrefix || 'REC-NL';

      const existingPaymentsCount = await tdb.count(payments);
      const receiptNumber = `${receiptPrefix}-2026-${String(existingPaymentsCount + 1).padStart(4, '0')}_${crypto.randomBytes(1).toString('hex').toUpperCase()}`;

      const insertedRow = await tdb.insertOne(payments, {
        id: newPaymentId,
        receiptNumber,
        studentId: targetStudentId,
        courseId,
        installmentItemId: validatedInstallmentItemId,
        amountDzd: effectiveAmountDzd,
        currency: activeTenant?.settings.currency || 'DZD',
        paymentMethod,
        transactionReference: transactionReference || 'NON-SPECIFIE',
        paymentDate: todayStr,
        status: 'PENDING',
        receiptAttachment: receiptAttachmentUrl ?? null,
        administrativeNotes: administrativeNotes || '',
        createdAt: nowIso,
      });

      if (receiptUploadId) {
        await tdb.updateWhere(
          uploadedFiles,
          { paymentId: newPaymentId, ownerId: targetStudentId },
          eq(uploadedFiles.id, receiptUploadId)
        );
      }

      let finalPayment = mapPaymentRow(insertedRow);

      if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user.role)) {
        finalPayment = await confirmPaymentTransaction(
          newPaymentId,
          user.id,
          administrativeNotes,
          { ipAddress: extractClientIp(req) }
        );
      } else {
        const admins = await tdb.selectMany(users, { where: eq(users.role, 'ADMIN') });
        for (const adm of admins) {
          await tdb.insertOne(notifications, {
            id: `notif_${crypto.randomUUID()}`,
            userId: adm.id,
            title: 'Nouveau versement déclaré',
            message: `${user.name} a déclaré un paiement de ${effectiveAmountDzd.toLocaleString('fr-DZ')} DZD via ${paymentMethod}.`,
            type: 'WARNING',
            link: '/admin/payments',
            read: false,
            createdAt: nowIso,
          });
        }
      }

      return res.status(201).json({
        success: true,
        payment: {
          ...finalPayment,
          studentName: studentRow.name,
          studentEmail: studentRow.email,
          courseTitle: courseRow.title,
          tenant: buildReceiptTenantMetadata(activeTenant),
        },
      });
    } catch (error: any) {
      console.error('POST /payments error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible d enregistrer le paiement.' });
    }
  }
);

apiRouter.post(
  '/payments/:id/confirm',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ params: idParamSchema, body: confirmPaymentBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { administrativeNotes } = req.body as { administrativeNotes?: string };
      const payment = await confirmPaymentTransaction(
        req.params.id,
        req.user!.id,
        administrativeNotes,
        { ipAddress: extractClientIp(req) }
      );
      const activeTenant = req.tenant || (await getCurrentTenant());
      return res.json({
        success: true,
        payment: {
          ...payment,
          tenant: buildReceiptTenantMetadata(activeTenant),
        },
        message: 'Paiement confirmé, abonnement activé et facture séquentielle émise.',
      });
    } catch (err: any) {
      return res.status(400).json({ error: 'CONFIRMATION_FAILED', message: err.message });
    }
  }
);

apiRouter.post(
  '/payments/:id/refund',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ params: idParamSchema, body: refundPaymentBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { reason, amountDzd } = req.body as { reason: string; amountDzd?: number };
      const result = await refundPaymentTransaction({
        paymentId: req.params.id,
        adminUserId: req.user!.id,
        reason,
        amountDzd,
        ipAddress: extractClientIp(req),
      });

      const activeTenant = req.tenant || (await getCurrentTenant());
      return res.json({
        success: true,
        payment: {
          ...result.payment,
          tenant: buildReceiptTenantMetadata(activeTenant),
        },
        invoice: result.invoice,
        message: 'Remboursement enregistré et avoir fiscal généré.',
      });
    } catch (error: any) {
      const code = error?.message || '';
      if (code === 'PAYMENT_NOT_FOUND') {
        return res.status(404).json({ error: code, message: 'Paiement introuvable.' });
      }
      if (code === 'PAYMENT_ALREADY_REFUNDED') {
        return res.status(409).json({
          error: code,
          message: 'Ce paiement a déjà fait l objet d un remboursement.',
        });
      }
      if (code === 'PAYMENT_NOT_CONFIRMED' || code === 'INVALID_REFUND_AMOUNT') {
        return res.status(400).json({
          error: code,
          message:
            code === 'PAYMENT_NOT_CONFIRMED'
              ? 'Seul un paiement confirmé peut être remboursé.'
              : 'Montant de remboursement invalide ou supérieur au montant payé.',
        });
      }
      console.error('POST /payments/:id/refund error:', error);
      return res.status(500).json({
        error: 'REFUND_FAILED',
        message: 'Impossible d effectuer le remboursement.',
      });
    }
  }
);

// =============================================================================
// INSTALLMENT PLANS & AUTOMATED REMINDERS (PAIEMENT EN PLUSIEURS FOIS & RELANCES)
// =============================================================================

apiRouter.get(
  '/installments',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ query: installmentsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { studentId } = req.query as { studentId?: string };

      if (user.role === 'STUDENT' && studentId && studentId !== user.id) {
        await logBlockedOwnershipAttempt(
          req,
          'InstallmentPlan',
          studentId,
          `Étudiant ${user.email} a tenté de lire les échéanciers d un tiers (${studentId}).`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez consulter que vos propres échéanciers.',
        });
      }

      const plans = await listInstallmentPlansScoped({
        studentId: user.role === 'STUDENT' ? user.id : studentId,
      });

      return res.json({ plans });
    } catch (error: any) {
      console.error('GET /installments error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger les échéanciers.',
      });
    }
  }
);

apiRouter.post(
  '/installments',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ body: createInstallmentPlanBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const body = req.body as {
        studentId?: string;
        courseId: string;
        totalAmountDzd?: number;
        installmentsCount: number;
        intervalDays?: number;
        firstDueDate?: string;
        title?: string;
        notes?: string;
      };

      if (user.role === 'STUDENT' && body.studentId && body.studentId !== user.id) {
        await logBlockedOwnershipAttempt(
          req,
          'InstallmentPlan',
          body.studentId,
          `Étudiant ${user.email} a tenté de créer un échéancier pour un tiers (${body.studentId}).`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez créer un échéancier que pour votre propre compte.',
        });
      }

      const targetStudentId = user.role === 'STUDENT' ? user.id : body.studentId || user.id;

      const plan = await createInstallmentPlan({
        studentId: targetStudentId,
        courseId: body.courseId,
        totalAmountDzd: user.role === 'STUDENT' ? undefined : body.totalAmountDzd,
        installmentsCount: body.installmentsCount,
        intervalDays: body.intervalDays,
        firstDueDate: user.role === 'STUDENT' ? undefined : body.firstDueDate,
        title: body.title,
        notes: body.notes,
        createdBy: user.id,
        ipAddress: extractClientIp(req),
      });

      return res.status(201).json({ success: true, plan });
    } catch (error: any) {
      const code = error?.message || '';
      if (code === 'STUDENT_NOT_FOUND' || code === 'COURSE_NOT_FOUND') {
        return res.status(404).json({
          error: code,
          message: code === 'STUDENT_NOT_FOUND' ? 'Étudiant introuvable.' : 'Formation introuvable.',
        });
      }
      if (code === 'INSTALLMENTS_DISABLED_FOR_TENANT') {
        return res.status(403).json({
          error: code,
          message: 'Le paiement en plusieurs fois est désactivé pour cet établissement.',
        });
      }
      console.error('POST /installments error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de créer l échéancier.',
      });
    }
  }
);

apiRouter.get(
  '/installments/reminders',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ query: installmentsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { studentId } = req.query as { studentId?: string };

      if (user.role === 'STUDENT' && studentId && studentId !== user.id) {
        await logBlockedOwnershipAttempt(
          req,
          'PaymentReminder',
          studentId,
          `Étudiant ${user.email} a tenté de lire les relances d un tiers (${studentId}).`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez consulter que vos propres relances.',
        });
      }

      const reminders = await listPaymentRemindersScoped({
        studentId: user.role === 'STUDENT' ? user.id : studentId,
      });

      return res.json({ reminders });
    } catch (error: any) {
      console.error('GET /installments/reminders error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger l historique des relances.',
      });
    }
  }
);

apiRouter.post(
  '/installments/run-reminders',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ body: runRemindersBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { referenceDateYmd } = (req.body || {}) as { referenceDateYmd?: string };
      const summary = await runAutomatedPaymentRemindersForTenant({
        triggeredBy: req.user!.email,
        referenceDateYmd,
        forceIgnoreTenantToggle: true,
      });

      return res.json({
        success: true,
        ...summary,
      });
    } catch (error: any) {
      console.error('POST /installments/run-reminders error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible d exécuter le cycle de relances automatiques.',
      });
    }
  }
);

// =============================================================================
// SEQUENTIAL FISCAL INVOICES & BINARY PDF DOWNLOAD (NIF, NIS, RC, AI, TVA)
// =============================================================================

apiRouter.get(
  '/invoices',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ query: invoicesQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { studentId } = req.query as { studentId?: string };

      if (user.role === 'STUDENT' && studentId && studentId !== user.id) {
        await logBlockedOwnershipAttempt(
          req,
          'Invoice',
          studentId,
          `Étudiant ${user.email} a tenté de lister les factures d un tiers (${studentId}).`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez consulter que vos propres factures.',
        });
      }

      const list = await listInvoicesScoped({
        studentId: user.role === 'STUDENT' ? user.id : studentId,
      });

      return res.json({ invoices: list });
    } catch (error: any) {
      console.error('GET /invoices error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger les factures.',
      });
    }
  }
);

apiRouter.get(
  '/invoices/:id',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invoice = await getInvoiceByIdScoped(req.params.id);
      if (!invoice) {
        return res.status(404).json({
          error: 'INVOICE_NOT_FOUND',
          message: 'Facture introuvable.',
        });
      }

      if (req.user!.role === 'STUDENT' && invoice.studentId !== req.user!.id) {
        await logBlockedOwnershipAttempt(
          req,
          'Invoice',
          invoice.id,
          `Étudiant ${req.user!.email} a tenté d accéder à la facture ${invoice.invoiceNumber} appartenant à ${invoice.studentId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : cette facture appartient à un autre étudiant.',
        });
      }

      return res.json({ invoice });
    } catch (error: any) {
      console.error('GET /invoices/:id error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger la facture.',
      });
    }
  }
);

apiRouter.get(
  '/invoices/:id/pdf',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invoice = await getInvoiceByIdScoped(req.params.id);
      if (!invoice) {
        return res.status(404).json({
          error: 'INVOICE_NOT_FOUND',
          message: 'Facture introuvable.',
        });
      }

      if (req.user!.role === 'STUDENT' && invoice.studentId !== req.user!.id) {
        await logBlockedOwnershipAttempt(
          req,
          'InvoicePdf',
          invoice.id,
          `Étudiant ${req.user!.email} a tenté de télécharger le PDF de la facture ${invoice.invoiceNumber} appartenant à ${invoice.studentId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : cette facture PDF appartient à un autre étudiant.',
        });
      }

      const pdfBuffer = await generateInvoicePdfBuffer(invoice);
      const safeFilename = `${invoice.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Length', String(pdfBuffer.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');

      return res.send(pdfBuffer);
    } catch (error: any) {
      console.error('GET /invoices/:id/pdf error:', error);
      return res.status(500).json({
        error: 'PDF_GENERATION_ERROR',
        message: 'Impossible de générer le document PDF de la facture.',
      });
    }
  }
);

apiRouter.get(
  '/subscriptions',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STUDENT']),
  validateRequest({ query: subscriptionsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { studentId } = req.query as { studentId?: string };

      if (user.role === 'STUDENT' && studentId && studentId !== user.id) {
        await logBlockedOwnershipAttempt(
          req,
          'Subscription',
          studentId,
          `Étudiant ${user.email} a tenté de lire les abonnements d un autre étudiant (${studentId}).`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez consulter que vos propres abonnements.',
        });
      }

      let subRows;
      if (user.role === 'STUDENT') {
        subRows = await tdb.selectMany(subscriptions, {
          where: eq(subscriptions.studentId, user.id),
          orderBy: desc(subscriptions.createdAt),
        });
      } else if (studentId) {
        subRows = await tdb.selectMany(subscriptions, {
          where: eq(subscriptions.studentId, studentId),
          orderBy: desc(subscriptions.createdAt),
        });
      } else {
        subRows = await tdb.selectMany(subscriptions, {
          orderBy: desc(subscriptions.createdAt),
        });
      }

      const [userRows, courseRows, planRows] = await Promise.all([
        tdb.selectMany(users),
        tdb.selectMany(courses),
        tdb.selectMany(subscriptionPlans),
      ]);

      const enriched = subRows.map((s) => {
        const student = userRows.find((u) => u.id === s.studentId);
        const course = courseRows.find((c) => c.id === s.courseId);
        const plan = planRows.find((p) => p.id === s.planId);
        return {
          ...mapSubscriptionRow(s),
          studentName: student?.name || 'Étudiant',
          courseTitle: course?.title || 'Formation',
          planName: plan?.name || 'Standard',
        };
      });

      return res.json({ subscriptions: enriched });
    } catch (error: any) {
      console.error('GET /subscriptions error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les abonnements.' });
    }
  }
);

// =============================================================================
// SECURE FILE UPLOADS (TENANT-ISOLATED VIA `tdb` + MIME/MAGIC BYTES + ANTI-IDOR)
// =============================================================================

apiRouter.post(
  '/uploads',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateParamsAndQuery(),
  validateMultipartUpload('file'),
  validateRequest({ body: uploadMetadataBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requester = req.user!;
      const { category, courseId, paymentId } = req.body as {
        category: 'PAYMENT_RECEIPT' | 'COURSE_MATERIAL';
        courseId?: string;
        paymentId?: string;
      };

      let resolvedOwnerId = requester.id;

      if (category === 'PAYMENT_RECEIPT') {
        if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STUDENT'].includes(requester.role)) {
          return res.status(403).json({
            error: 'FORBIDDEN',
            message:
              'Seuls les étudiants et l administration peuvent téléverser un justificatif de paiement.',
          });
        }

        if (paymentId) {
          const paymentRow = await tdb.findFirst(payments, eq(payments.id, paymentId));

          if (!paymentRow) {
            return res.status(404).json({
              error: 'PAYMENT_NOT_FOUND',
              message: 'Paiement associé introuvable.',
            });
          }

          if (requester.role === 'STUDENT' && paymentRow.studentId !== requester.id) {
            await logBlockedOwnershipAttempt(
              req,
              'Payment',
              paymentId,
              `Étudiant ${requester.email} a tenté de joindre un fichier au paiement d un tiers (${paymentId}).`
            );
            return res.status(403).json({
              error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
              message: 'Accès interdit : ce paiement appartient à un autre étudiant.',
            });
          }

          resolvedOwnerId = paymentRow.studentId;
        }
      } else if (category === 'COURSE_MATERIAL') {
        if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEACHER'].includes(requester.role)) {
          return res.status(403).json({
            error: 'FORBIDDEN',
            message:
              'Seuls les enseignants et l administration peuvent téléverser un support de cours.',
          });
        }

        if (!courseId) {
          return res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Le paramètre courseId est obligatoire pour un support pédagogique.',
          });
        }

        const courseRow = await tdb.findFirst(courses, eq(courses.id, courseId));

        if (!courseRow) {
          return res.status(404).json({
            error: 'COURSE_NOT_FOUND',
            message: 'Formation introuvable.',
          });
        }

        if (requester.role === 'TEACHER') {
          const assignedClass = await tdb.findFirst(
            classes,
            and(eq(classes.courseId, courseId), eq(classes.teacherId, requester.id))
          );

          if (!assignedClass) {
            await logBlockedOwnershipAttempt(
              req,
              'Course',
              courseId,
              `Enseignant ${requester.email} a tenté de téléverser un support sur une formation non assignée (${courseId}).`
            );
            return res.status(403).json({
              error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
              message: 'Accès interdit : vous n enseignez aucune classe rattachée à cette formation.',
            });
          }
        }
      }

      const persisted = await persistValidatedFileToPrivateStorage(req.file!);
      const uploadId = `upl_${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();

      const inserted = await db.transaction(async (tx) => {
        const txDb = tdb.forTx(tx);
        const row = await txDb.insertOne(uploadedFiles, {
          id: uploadId,
          ownerId: resolvedOwnerId,
          uploadedBy: requester.id,
          category,
          originalName: persisted.sanitizedOriginalName,
          storedFilename: persisted.storedFilename,
          mimeType: persisted.mimeType,
          sizeBytes: persisted.sizeBytes,
          sha256Hash: persisted.sha256Hash,
          courseId: courseId ?? null,
          paymentId: paymentId ?? null,
          createdAt: nowIso,
        });

        if (category === 'PAYMENT_RECEIPT' && paymentId) {
          await txDb.updateWhere(
            payments,
            { receiptAttachment: `/api/uploads/${uploadId}/download` },
            eq(payments.id, paymentId)
          );
        }

        await txDb.insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: requester.id,
          userEmail: requester.email,
          userRole: requester.role,
          action: 'SECURE_FILE_UPLOADED',
          entity: 'UploadedFile',
          entityId: uploadId,
          details: `Fichier sécurisé téléversé hors dossier public (${category}, ${persisted.mimeType}, ${persisted.sizeBytes} octets).`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });

        return row;
      });

      return res.status(201).json({
        success: true,
        file: mapUploadedFileRow(inserted),
      });
    } catch (error: any) {
      console.error('POST /uploads error:', error);
      return res
        .status(500)
        .json({ error: 'UPLOAD_FAILED', message: 'Impossible d enregistrer le fichier.' });
    }
  }
);

apiRouter.get(
  '/uploads',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ query: uploadsListQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requester = req.user!;
      const { category, courseId, paymentId } = req.query as {
        category?: 'PAYMENT_RECEIPT' | 'COURSE_MATERIAL';
        courseId?: string;
        paymentId?: string;
      };

      if (requester.role === 'STUDENT') {
        if (paymentId) {
          const payRow = await tdb.findFirst(payments, eq(payments.id, paymentId));
          if (payRow && payRow.studentId !== requester.id) {
            await logBlockedOwnershipAttempt(
              req,
              'Payment',
              paymentId,
              `Étudiant ${requester.email} a tenté de lister les fichiers liés au paiement d un tiers (${paymentId}).`
            );
            return res.status(403).json({
              error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
              message: 'Accès interdit : ce paiement appartient à un autre étudiant.',
            });
          }
        }
        if (courseId) {
          const access = await verifyStudentAccess(requester.id, courseId);
          if (!access.hasAccess) {
            await logBlockedOwnershipAttempt(
              req,
              'Course',
              courseId,
              `Étudiant ${requester.email} sans abonnement actif a tenté de lister les supports de ${courseId}.`
            );
            return res.status(403).json({
              error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
              message: 'Accès interdit : abonnement actif requis pour consulter ces supports.',
            });
          }
        }
      } else if (requester.role === 'TEACHER') {
        if (paymentId || category === 'PAYMENT_RECEIPT') {
          await logBlockedOwnershipAttempt(
            req,
            'UploadedFile',
            paymentId,
            `Enseignant ${requester.email} a tenté de lister des justificatifs financiers.`
          );
          return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'Accès interdit aux justificatifs financiers pour le rôle enseignant.',
          });
        }
        if (courseId) {
          const assigned = await tdb.findFirst(
            classes,
            and(eq(classes.courseId, courseId), eq(classes.teacherId, requester.id))
          );
          if (!assigned) {
            await logBlockedOwnershipAttempt(
              req,
              'Course',
              courseId,
              `Enseignant ${requester.email} a tenté de lister les supports d une formation non assignée (${courseId}).`
            );
            return res.status(403).json({
              error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
              message: 'Accès interdit : vous n enseignez pas cette formation.',
            });
          }
        }
      }

      const allRows = await tdb.selectMany(uploadedFiles, {
        orderBy: desc(uploadedFiles.createdAt),
      });

      let visibleRows = allRows;

      if (requester.role === 'STUDENT') {
        const today = new Date().toISOString().split('T')[0];
        const activeSubs = await tdb.selectMany(subscriptions, {
          where: and(
            eq(subscriptions.studentId, requester.id),
            eq(subscriptions.status, 'ACTIVE'),
            lte(subscriptions.startDate, today),
            gte(subscriptions.endDate, today)
          ),
        });
        const accessibleCourseIds = new Set(activeSubs.map((s) => s.courseId));

        visibleRows = allRows.filter(
          (f) =>
            (f.category === 'PAYMENT_RECEIPT' && f.ownerId === requester.id) ||
            (f.category === 'COURSE_MATERIAL' &&
              Boolean(f.courseId && accessibleCourseIds.has(f.courseId)))
        );
      } else if (requester.role === 'TEACHER') {
        const myClasses = await tdb.selectMany(classes, {
          where: eq(classes.teacherId, requester.id),
        });
        const myCourseIds = new Set(myClasses.map((c) => c.courseId));
        visibleRows = allRows.filter(
          (f) =>
            f.category === 'COURSE_MATERIAL' &&
            (f.uploadedBy === requester.id || (f.courseId ? myCourseIds.has(f.courseId) : false))
        );
      }

      if (category) {
        visibleRows = visibleRows.filter((f) => f.category === category);
      }
      if (courseId) {
        visibleRows = visibleRows.filter((f) => f.courseId === courseId);
      }
      if (paymentId) {
        visibleRows = visibleRows.filter((f) => f.paymentId === paymentId);
      }

      return res.json({ files: visibleRows.map(mapUploadedFileRow) });
    } catch (error: any) {
      console.error('GET /uploads error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les fichiers.' });
    }
  }
);

apiRouter.get(
  '/uploads/:id/download',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requester = req.user!;
      // `tdb` automatically enforces `tenant_id = getCurrentTenantId()`, blocking cross-tenant file downloads!
      const fileRow = await tdb.findFirst(uploadedFiles, eq(uploadedFiles.id, req.params.id));

      if (!fileRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Fichier introuvable.' });
      }

      if (fileRow.category === 'PAYMENT_RECEIPT') {
        const isAdminOrManager = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(requester.role);
        const isOwnerStudent = requester.role === 'STUDENT' && fileRow.ownerId === requester.id;

        if (!isAdminOrManager && !isOwnerStudent) {
          await logBlockedOwnershipAttempt(
            req,
            'UploadedFile',
            fileRow.id,
            `Accès IDOR refusé au justificatif privé ${fileRow.id} (propriétaire: ${fileRow.ownerId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit à ce justificatif privé.',
          });
        }
      } else if (fileRow.category === 'COURSE_MATERIAL') {
        const isAdminOrManager = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(requester.role);
        let isAuthorizedTeacher = false;
        let isAuthorizedStudent = false;

        if (requester.role === 'TEACHER' && fileRow.courseId) {
          const assigned = await tdb.findFirst(
            classes,
            and(eq(classes.courseId, fileRow.courseId), eq(classes.teacherId, requester.id))
          );
          isAuthorizedTeacher = Boolean(assigned) || fileRow.uploadedBy === requester.id;
        } else if (requester.role === 'STUDENT' && fileRow.courseId) {
          const access = await verifyStudentAccess(requester.id, fileRow.courseId);
          isAuthorizedStudent = access.hasAccess;
        }

        if (!isAdminOrManager && !isAuthorizedTeacher && !isAuthorizedStudent) {
          await logBlockedOwnershipAttempt(
            req,
            'UploadedFile',
            fileRow.id,
            `Accès IDOR refusé au support pédagogique privé ${fileRow.id} (formation: ${fileRow.courseId}).`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message:
              'Accès interdit : abonnement actif ou affectation pédagogique requis pour ce document.',
          });
        }
      } else {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Catégorie non autorisée.' });
      }

      const fullPath = resolveSafePrivateFilePath(fileRow.storedFilename);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({
          error: 'FILE_MISSING_ON_DISK',
          message: 'Le fichier physique est introuvable dans le stockage sécurisé.',
        });
      }

      res.setHeader('Content-Type', fileRow.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileRow.originalName.replace(/["\\\r\n]/g, '_')}"`
      );
      res.setHeader('Content-Length', String(fileRow.sizeBytes));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');

      const stream = fs.createReadStream(fullPath);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'READ_ERROR', message: 'Erreur lecture fichier.' });
        }
      });
      return stream.pipe(res);
    } catch (error: any) {
      console.error('GET /uploads/:id/download error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de télécharger le fichier.' });
    }
  }
);

apiRouter.delete(
  '/uploads/:id',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requester = req.user!;
      const fileRow = await tdb.findFirst(uploadedFiles, eq(uploadedFiles.id, req.params.id));

      if (!fileRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Fichier introuvable.' });
      }

      const isAdminOrManager = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(requester.role);
      const isUploaderOwner =
        fileRow.uploadedBy === requester.id && fileRow.ownerId === requester.id;

      if (!isAdminOrManager && !isUploaderOwner) {
        await logBlockedOwnershipAttempt(
          req,
          'UploadedFile',
          fileRow.id,
          `Tentative IDOR de suppression du fichier ${fileRow.id} par ${requester.email}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : vous ne pouvez pas supprimer le fichier d un autre utilisateur.',
        });
      }

      if (!isAdminOrManager && fileRow.paymentId) {
        const payRow = await tdb.findFirst(payments, eq(payments.id, fileRow.paymentId));
        if (payRow && payRow.status === 'CONFIRMED') {
          return res.status(403).json({
            error: 'RECEIPT_LOCKED',
            message: 'Impossible de supprimer un justificatif lié à un paiement déjà confirmé.',
          });
        }
      }

      try {
        const fullPath = resolveSafePrivateFilePath(fileRow.storedFilename);
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
        }
      } catch {
        // Ignore if already removed on disk
      }

      await db.transaction(async (tx) => {
        const txDb = tdb.forTx(tx);
        if (fileRow.paymentId) {
          await txDb.updateWhere(
            payments,
            { receiptAttachment: null },
            eq(payments.id, fileRow.paymentId)
          );
        }
        await txDb.deleteWhere(uploadedFiles, eq(uploadedFiles.id, fileRow.id));
        await txDb.insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: requester.id,
          userEmail: requester.email,
          userRole: requester.role,
          action: 'SECURE_FILE_DELETED',
          entity: 'UploadedFile',
          entityId: fileRow.id,
          details: `Suppression du fichier privé ${fileRow.originalName} (${fileRow.id}).`,
          ipAddress: extractClientIp(req),
          timestamp: new Date().toISOString(),
        });
      });

      return res.json({ success: true, message: 'Fichier supprimé avec succès.' });
    } catch (error: any) {
      console.error('DELETE /uploads/:id error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de supprimer le fichier.' });
    }
  }
);

// =============================================================================
// DASHBOARD & ANALYTICS (TENANT-ISOLATED VIA `tdb`)
// =============================================================================

apiRouter.get(
  '/dashboard/stats',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest(),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const nowIso = new Date().toISOString();

      const [userRows, paymentRows, subRows, sessionRows, attRows] = await Promise.all([
        tdb.selectMany(users),
        tdb.selectMany(payments),
        tdb.selectMany(subscriptions),
        tdb.selectMany(sessions),
        tdb.selectMany(attendanceRecords),
      ]);

      const totalStudents = userRows.filter((u) => u.role === 'STUDENT').length;
      const activeStudents = userRows.filter(
        (u) => u.role === 'STUDENT' && u.status === 'ACTIVE'
      ).length;

      const confirmedPayments = paymentRows.filter((p) => p.status === 'CONFIRMED');
      const collectedRevenueDzd = confirmedPayments.reduce((acc, p) => acc + p.amountDzd, 0);

      const pendingPayments = paymentRows.filter((p) => p.status === 'PENDING');
      const pendingPaymentsAmountDzd = pendingPayments.reduce((acc, p) => acc + p.amountDzd, 0);

      const activeSubscriptions = subRows.filter(
        (s) => s.status === 'ACTIVE' && s.startDate <= today && s.endDate >= today
      ).length;
      const expiredSubscriptions = subRows.filter(
        (s) => s.status === 'EXPIRED' || s.endDate < today
      ).length;

      const totalTeachers = userRows.filter((u) => u.role === 'TEACHER').length;
      const upcomingSessionsCount = sessionRows.filter(
        (s) => (s.status === 'SCHEDULED' || s.status === 'LIVE') && s.scheduledAt >= nowIso
      ).length;

      const totalAttendanceRecords = attRows.length;
      const presentRecords = attRows.filter((r) => r.status === 'PRESENT').length;
      const overallAttendanceRate =
        totalAttendanceRecords > 0
          ? Math.round((presentRecords / totalAttendanceRecords) * 100)
          : 95;

      const baseRev = Math.max(25000, Math.round(collectedRevenueDzd * 0.65));
      const monthlyRevenue = [
        { month: 'Nov 2025', amountDzd: Math.round(baseRev * 0.7) },
        { month: 'Déc 2025', amountDzd: Math.round(baseRev * 0.85) },
        { month: 'Jan 2026', amountDzd: baseRev },
        { month: 'Fév 2026', amountDzd: collectedRevenueDzd },
      ];

      const monthlyEnrollments = [
        { month: 'Nov 2025', count: Math.max(1, Math.floor(totalStudents * 0.4)) },
        { month: 'Déc 2025', count: Math.max(1, Math.floor(totalStudents * 0.65)) },
        { month: 'Jan 2026', count: Math.max(1, Math.floor(totalStudents * 0.85)) },
        { month: 'Fév 2026', count: totalStudents },
      ];

      return res.json({
        totalStudents,
        activeStudents,
        newEnrollmentsThisMonth: Math.max(1, Math.ceil(totalStudents * 0.3)),
        activeSubscriptions,
        expiredSubscriptions,
        pendingPaymentsCount: pendingPayments.length,
        pendingPaymentsAmountDzd,
        collectedRevenueDzd,
        totalTeachers,
        upcomingSessionsCount,
        overallAttendanceRate,
        monthlyRevenue,
        monthlyEnrollments,
      });
    } catch (error: any) {
      console.error('GET /dashboard/stats error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les statistiques.' });
    }
  }
);

// =============================================================================
// AUDIT LOGS & SETTINGS (TENANT-ISOLATED VIA `tdb`)
// =============================================================================

apiRouter.get(
  '/audit-logs',
  authenticateToken,
  requireRole(['ADMIN']),
  validateRequest({ query: auditLogsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = Number((req.query as { limit?: number }).limit) || 100;
      const rows = await tdb.selectMany(auditLogs, {
        orderBy: desc(auditLogs.timestamp),
        limit,
      });
      return res.json({ logs: rows.map(mapAuditLogRow) });
    } catch (error: any) {
      console.error('GET /audit-logs error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger le journal d audit.' });
    }
  }
);

apiRouter.get(
  '/settings/integrations',
  authenticateToken,
  requireRole(['ADMIN']),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await ensureSmtpIntegrationRow();
      const rows = await tdb.selectMany(integrationSettings);
      const originBase = extractRequestOrigin(req);
      const activeTenant = req.tenant || (await getCurrentTenant());

      return res.json({
        integrations: rows.map((row) => {
          const mapped = mapIntegrationSettingRow(row);
          return {
            ...mapped,
            config: {
              ...maskIntegrationConfigForClient(mapped.config),
              ...(mapped.provider === 'PAYMENT_GATEWAY'
                ? {
                    webhookEndpointUrl: `${originBase}/api/webhooks/chargily/${activeTenant?.slug || 'najahlearn-alger'}`,
                  }
                : {}),
            },
          };
        }),
      });
    } catch (error: any) {
      console.error('GET /settings/integrations error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les intégrations.' });
    }
  }
);

apiRouter.put(
  '/settings/integrations/:provider',
  authenticateToken,
  requireRole(['ADMIN']),
  validateRequest({ params: providerParamSchema, body: updateIntegrationBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.params.provider === 'EMAIL_SMTP') {
        await ensureSmtpIntegrationRow();
      }
      const existing = await tdb.findFirst(
        integrationSettings,
        eq(integrationSettings.provider, req.params.provider)
      );

      if (!existing) {
        return res
          .status(404)
          .json({ error: 'NOT_FOUND', message: 'Paramètre d intégration introuvable.' });
      }

      const { isEnabled, isTestMode, config } = req.body as {
        isEnabled?: boolean;
        isTestMode?: boolean;
        config?: Record<string, any>;
      };

      const prevCfg = (existing.config as Record<string, any>) || {};
      const incomingCfg = { ...(config || {}) };
      for (const secretField of [
        'secretKey',
        'webhookSecret',
        'clientSecret',
        'pass',
        'smtpPass',
      ]) {
        if (
          typeof incomingCfg[secretField] === 'string' &&
          incomingCfg[secretField].includes('••••')
        ) {
          incomingCfg[secretField] = prevCfg[secretField] || '';
        }
      }

      const mergedConfig = config ? { ...prevCfg, ...incomingCfg } : prevCfg;

      const [updated] = await tdb.updateWhere(
        integrationSettings,
        {
          isEnabled: typeof isEnabled === 'boolean' ? isEnabled : existing.isEnabled,
          isTestMode: typeof isTestMode === 'boolean' ? isTestMode : existing.isTestMode,
          config: mergedConfig,
          updatedAt: new Date().toISOString(),
        },
        eq(integrationSettings.id, existing.id)
      );

      const mapped = mapIntegrationSettingRow(updated);
      return res.json({
        success: true,
        setting: {
          ...mapped,
          config: maskIntegrationConfigForClient(mapped.config),
        },
      });
    } catch (error: any) {
      console.error('PUT /settings/integrations/:provider error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de mettre à jour l intégration.' });
    }
  }
);

// =============================================================================
// COURSES & MODULES (PUBLIC TENANT SYLLABUS + PROTECTED LESSON ACCESS CHECK)
// =============================================================================

apiRouter.get(
  '/courses',
  validateRequest({ query: publicTenantQuerySchema }),
  resolvePublicTenantContext,
  async (_req: Request, res: Response) => {
    try {
      const [courseRows, allModules] = await Promise.all([
        tdb.selectMany(courses, { orderBy: asc(courses.createdAt) }),
        getModulesWithLessonsForCourse(),
      ]);

      const list = courseRows.map((c) => {
        const cModules = redactProtectedLessonsForPublicView(
          allModules.filter((m) => m.courseId === c.id)
        );
        return {
          ...mapCourseRow(c),
          modulesCount: cModules.length,
          modules: cModules,
        };
      });

      return res.json({ courses: list });
    } catch (error: any) {
      console.error('GET /courses error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les formations.' });
    }
  }
);

apiRouter.get(
  '/courses/:id',
  validateRequest({ params: idParamSchema, query: publicTenantQuerySchema }),
  resolvePublicTenantContext,
  async (req: Request, res: Response) => {
    try {
      const courseRow = await tdb.findFirst(courses, eq(courses.id, req.params.id));

      if (!courseRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Formation introuvable.' });
      }

      const modules = redactProtectedLessonsForPublicView(
        await getModulesWithLessonsForCourse(courseRow.id)
      );
      return res.json({ course: mapCourseRow(courseRow), modules });
    } catch (error: any) {
      console.error('GET /courses/:id error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger la formation.' });
    }
  }
);

apiRouter.get(
  '/courses/:courseId/lessons/:lessonId/access',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ params: courseLessonParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { courseId, lessonId } = req.params;
      const requester = req.user!;

      const lessonRow = await tdb.findFirst(lessonResources, eq(lessonResources.id, lessonId));

      if (!lessonRow) {
        return res.status(404).json({ error: 'LESSON_NOT_FOUND', message: 'Leçon introuvable.' });
      }

      const modRow = await tdb.findFirst(courseModules, eq(courseModules.id, lessonRow.moduleId));

      if (!modRow || modRow.courseId !== courseId) {
        return res.status(404).json({
          error: 'LESSON_COURSE_MISMATCH',
          message: 'Cette ressource n appartient pas à la formation demandée.',
        });
      }

      if (requester.role === 'TEACHER') {
        const assigned = await tdb.findFirst(
          classes,
          and(eq(classes.courseId, courseId), eq(classes.teacherId, requester.id))
        );
        if (!assigned) {
          await logBlockedOwnershipAttempt(
            req,
            'LessonResource',
            lessonId,
            `Enseignant ${requester.email} non affecté à ${courseId} a tenté d ouvrir la ressource protégée ${lessonId}.`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: 'Accès interdit : vous n enseignez pas cette formation.',
          });
        }
      } else if (requester.role === 'STUDENT' && lessonRow.isProtected) {
        const access = await verifyStudentAccess(requester.id, courseId);
        if (!access.hasAccess) {
          await logBlockedOwnershipAttempt(
            req,
            'LessonResource',
            lessonId,
            `Étudiant ${requester.email} sans abonnement actif a tenté d accéder à la leçon protégée ${lessonId}.`
          );
          return res.status(403).json({
            error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
            message: access.reason || 'Abonnement actif requis pour consulter cette leçon.',
          });
        }
      }

      return res.json({
        canAccess: true,
        lesson: {
          id: lessonRow.id,
          title: lessonRow.title,
          type: lessonRow.type,
          url: lessonRow.url,
          recordingUrl: lessonRow.recordingUrl ?? undefined,
        },
      });
    } catch (error: any) {
      console.error('GET /courses/:courseId/lessons/:lessonId/access error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible d ouvrir la ressource.' });
    }
  }
);

// =============================================================================
// NOTIFICATIONS, PREFERENCES & TRANSACTIONAL EMAIL QUEUE (TENANT-ISOLATED VIA `tdb`)
// =============================================================================

apiRouter.get(
  '/notifications',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ query: notificationsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { unreadOnly, category, limit } = req.query as {
        unreadOnly?: boolean;
        category?: 'ALL' | NotificationCategory;
        limit?: number;
      };

      const allUserRows = await tdb.selectMany(notifications, {
        where: eq(notifications.userId, req.user!.id),
        orderBy: desc(notifications.createdAt),
        limit: 150,
      });

      const unreadCount = allUserRows.filter((r) => !r.read).length;

      let filtered = allUserRows;
      if (unreadOnly) {
        filtered = filtered.filter((r) => !r.read);
      }
      if (category && category !== 'ALL') {
        filtered = filtered.filter((r) => (r.category || 'GENERAL') === category);
      }

      const maxRows = Math.max(1, Math.min(100, limit || 50));
      return res.json({
        notifications: filtered.slice(0, maxRows).map(mapNotificationRow),
        unreadCount,
      });
    } catch (error: any) {
      console.error('GET /notifications error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de charger les notifications.' });
    }
  }
);

apiRouter.get(
  '/notifications/preferences',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const preferences = await getUserNotificationPreferences(req.user!.id);
      return res.json({ preferences });
    } catch (error: any) {
      console.error('GET /notifications/preferences error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger vos préférences de notification.',
      });
    }
  }
);

apiRouter.put(
  '/notifications/preferences',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ body: updateNotificationPreferencesBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const preferences = await upsertUserNotificationPreferences(req.user!.id, req.body || {});

      await tdb
        .insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'NOTIFICATION_PREFERENCES_UPDATED',
          entity: 'UserNotificationPreferences',
          entityId: req.user!.id,
          details: `Préférences de notifications Email/In-App mises à jour par ${req.user!.email}.`,
          ipAddress: extractClientIp(req),
          timestamp: new Date().toISOString(),
        })
        .catch(() => {});

      return res.json({ success: true, preferences });
    } catch (error: any) {
      console.error('PUT /notifications/preferences error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible d enregistrer vos préférences de notification.',
      });
    }
  }
);

apiRouter.post(
  '/notifications/read-all',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest(),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const nowIso = new Date().toISOString();
      const updatedRows = await tdb.updateWhere(
        notifications,
        { read: true, readAt: nowIso },
        and(eq(notifications.userId, req.user!.id), eq(notifications.read, false))!
      );
      return res.json({ success: true, updatedCount: updatedRows.length });
    } catch (error: any) {
      console.error('POST /notifications/read-all error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de marquer toutes les notifications comme lues.',
      });
    }
  }
);

apiRouter.patch(
  '/notifications/:id/read',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notifRow = await tdb.findFirst(notifications, eq(notifications.id, req.params.id));

      if (!notifRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Notification introuvable.' });
      }

      if (notifRow.userId !== req.user!.id) {
        await logBlockedOwnershipAttempt(
          req,
          'Notification',
          notifRow.id,
          `Utilisateur ${req.user!.email} a tenté de modifier la notification ${notifRow.id} appartenant à ${notifRow.userId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : cette notification appartient à un autre utilisateur.',
        });
      }

      await tdb.updateWhere(
        notifications,
        { read: true, readAt: notifRow.readAt || new Date().toISOString() },
        eq(notifications.id, notifRow.id)
      );

      return res.json({ success: true });
    } catch (error: any) {
      console.error('PATCH /notifications/:id/read error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de mettre à jour la notification.' });
    }
  }
);

apiRouter.delete(
  '/notifications/:id',
  authenticateToken,
  requireRole(ALL_AUTHENTICATED_ROLES),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notifRow = await tdb.findFirst(notifications, eq(notifications.id, req.params.id));

      if (!notifRow) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Notification introuvable.' });
      }

      if (notifRow.userId !== req.user!.id) {
        await logBlockedOwnershipAttempt(
          req,
          'Notification',
          notifRow.id,
          `Utilisateur ${req.user!.email} a tenté de supprimer la notification ${notifRow.id} appartenant à ${notifRow.userId}.`
        );
        return res.status(403).json({
          error: 'RESOURCE_OWNERSHIP_FORBIDDEN',
          message: 'Accès interdit : cette notification appartient à un autre utilisateur.',
        });
      }

      await tdb.deleteWhere(notifications, eq(notifications.id, notifRow.id));
      return res.json({ success: true });
    } catch (error: any) {
      console.error('DELETE /notifications/:id error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de supprimer la notification.' });
    }
  }
);

// --- ADMIN SMTP TRANSACTIONAL EMAIL OUTBOX QUEUE & TEMPLATE TESTER ---

apiRouter.get(
  '/emails/queue',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ query: emailQueueQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status, templateType, limit } = req.query as {
        status?: string;
        templateType?: string;
        limit?: number;
      };
      const [{ items, stats }, smtpCfg] = await Promise.all([
        listEmailQueueScoped({ status, templateType, limit }),
        getSmtpResolvedConfig(),
      ]);

      return res.json({
        items,
        stats,
        smtpStatus: {
          isEnabled: smtpCfg.isEnabled,
          isTestMode: smtpCfg.isTestMode,
          hasLiveSmtpTransport: smtpCfg.hasLiveSmtpTransport,
          host: smtpCfg.host,
          port: smtpCfg.port,
          secure: smtpCfg.secure,
          fromName: smtpCfg.fromName,
          fromEmail: smtpCfg.fromEmail,
        },
      });
    } catch (error: any) {
      console.error('GET /emails/queue error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger la file d attente des e-mails transactionnels.',
      });
    }
  }
);

apiRouter.get(
  '/emails/queue/:id',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const row = await tdb.findFirst(emailQueue, eq(emailQueue.id, req.params.id));
      if (!row) {
        return res.status(404).json({
          error: 'EMAIL_QUEUE_ITEM_NOT_FOUND',
          message: 'Message introuvable dans la file d attente de cet établissement.',
        });
      }
      return res.json({ item: mapEmailQueueRow(row, true) });
    } catch (error: any) {
      console.error('GET /emails/queue/:id error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de charger le détail de l e-mail.',
      });
    }
  }
);

apiRouter.post(
  '/emails/queue/process',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ body: processEmailQueueBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { limit, forceDueNow } = (req.body || {}) as {
        limit?: number;
        forceDueNow?: boolean;
      };
      const summary = await processEmailQueueBatch({
        limit,
        forceDueNow: Boolean(forceDueNow),
      });
      return res.json({ success: true, ...summary });
    } catch (error: any) {
      console.error('POST /emails/queue/process error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de traiter la file d attente SMTP.',
      });
    }
  }
);

apiRouter.post(
  '/emails/queue/:id/retry',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ params: idParamSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await retryEmailQueueItem(req.params.id);
      return res.json({ success: true, ...result });
    } catch (error: any) {
      if (error?.message === 'EMAIL_QUEUE_ITEM_NOT_FOUND') {
        return res.status(404).json({
          error: 'EMAIL_QUEUE_ITEM_NOT_FOUND',
          message: 'E-mail introuvable dans la file d attente.',
        });
      }
      if (error?.message === 'EMAIL_ALREADY_SENT') {
        return res.status(409).json({
          error: 'EMAIL_ALREADY_SENT',
          message: 'Cet e-mail a déjà été expédié avec succès.',
        });
      }
      console.error('POST /emails/queue/:id/retry error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de relancer l envoi de cet e-mail.',
      });
    }
  }
);

apiRouter.post(
  '/emails/run-sweeps',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  validateRequest({ body: runEmailSweepsBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { referenceDateYmd, referenceTimeIso, windowHours } = (req.body || {}) as {
        referenceDateYmd?: string;
        referenceTimeIso?: string;
        windowHours?: number;
      };
      const appOrigin = extractRequestOrigin(req);

      const [subscriptionsSweep, sessionsSweep] = await Promise.all([
        runExpiringSubscriptionsSweepForTenant({ referenceDateYmd, appOrigin }),
        runSessionRemindersSweepForTenant({ referenceTimeIso, windowHours, appOrigin }),
      ]);

      return res.json({
        success: true,
        subscriptionsSweep,
        sessionsSweep,
      });
    } catch (error: any) {
      console.error('POST /emails/run-sweeps error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible d exécuter les rappels d abonnements et de séances.',
      });
    }
  }
);

apiRouter.post(
  '/emails/test-template',
  authenticateToken,
  requireRole(['ADMIN']),
  validateRequest({ body: sendTestEmailBodySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { templateType, locale, recipientEmail, simulateTransientFailuresCount } = req.body as {
        templateType: EmailTemplateType;
        locale: 'fr' | 'ar';
        recipientEmail?: string;
        simulateTransientFailuresCount?: number;
      };

      const targetEmail = (recipientEmail || req.user!.email).trim().toLowerCase();
      const targetName =
        locale === 'ar'
          ? req.user!.name || 'أمين بن علي'
          : req.user!.name || 'Administrateur';

      const sampleVarsByType: Record<EmailTemplateType, Record<string, any>> = {
        PASSWORD_RESET: {
          resetToken: `rst_demo_${crypto.randomBytes(8).toString('hex')}`,
          expiresMinutes: 60,
        },
        PAYMENT_CONFIRMATION: {
          amountDzd: 6500,
          currency: 'DZD',
          courseTitle:
            locale === 'ar'
              ? 'هندسة الويب الحديثة Full-Stack TypeScript'
              : 'Ingénierie Web Full-Stack TypeScript',
          receiptNumber: 'REC-NL-2026-0099',
          invoiceNumber: 'FAC-NL-2026-000099',
          paymentMethod: 'CHARGILY_EDAHABIA',
          subscriptionEndDate: '2026-04-30',
        },
        SUBSCRIPTION_EXPIRING_7D: {
          courseTitle:
            locale === 'ar'
              ? 'الأمن السيبراني وحماية الأنظمة السحابية'
              : 'Cybersécurité & Architecture Cloud',
          endDate: new Date(Date.now() + 7 * 86_400_000).toISOString().split('T')[0],
          daysRemaining: 7,
          renewalAmountDzd: 6500,
        },
        SESSION_REMINDER: {
          sessionTitle:
            locale === 'ar'
              ? 'ورشة تطبيقية: تأمين واجهات البرمجة وبروتوكول Argon2id'
              : 'Atelier Live : Sécurisation API & Authentification Argon2id',
          courseTitle:
            locale === 'ar'
              ? 'هندسة الويب الحديثة Full-Stack TypeScript'
              : 'Ingénierie Web Full-Stack TypeScript',
          className: 'Promo G1 - Alger',
          teacherName: 'Dr. Karim Boudiaf',
          scheduledDisplay: '2026-03-28 18:30',
          durationMinutes: 90,
          videoProvider: 'ZOOM',
        },
        ACCOUNT_CREATED: {
          role: 'STUDENT',
          studentIdNumber: 'ETU-2026-042',
          courseTitle:
            locale === 'ar'
              ? 'هندسة الويب الحديثة Full-Stack TypeScript'
              : 'Ingénierie Web Full-Stack TypeScript',
          temporaryPassword: 'Temp#2026!ChangeMe',
        },
      };

      const dispatched = await dispatchTransactionalNotification({
        userId: targetEmail === req.user!.email.toLowerCase() ? req.user!.id : undefined,
        recipientEmail: targetEmail,
        recipientName: targetName,
        preferredLocale: locale,
        templateType,
        appOrigin: extractRequestOrigin(req),
        skipImmediateProcess: true,
        skipInAppNotification: true,
        simulateTransientFailuresCount,
        variables: sampleVarsByType[templateType],
      });

      let fullItem = dispatched.emailQueueItem;
      if (dispatched.emailQueueItem) {
        await processEmailQueueBatch({
          onlyEmailId: dispatched.emailQueueItem.id,
          forceDueNow: true,
          limit: 1,
        });
        const refreshed = await tdb.findFirst(
          emailQueue,
          eq(emailQueue.id, dispatched.emailQueueItem.id)
        );
        if (refreshed) {
          fullItem = mapEmailQueueRow(refreshed, true);
        }
      }

      return res.status(201).json({
        success: true,
        dispatched,
        item: fullItem,
      });
    } catch (error: any) {
      console.error('POST /emails/test-template error:', error);
      return res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Impossible de générer et tester le modèle d e-mail.',
      });
    }
  }
);

// =============================================================================
// AUTOMATED TEST SUITE RUNNER & DEMO RESET
// =============================================================================

apiRouter.post(
  '/test-suite/run',
  authenticateToken,
  requireRole(['ADMIN']),
  validateRequest(),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await runAutomatedTestSuite();
      return res.json(result);
    } catch (error: any) {
      console.error('POST /test-suite/run error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Erreur exécution de la suite de tests.' });
    }
  }
);

apiRouter.post(
  '/reset-demo',
  authenticateToken,
  requireRole(['ADMIN']),
  validateRequest(),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      await resetDatabaseToSeed();
      return res.json({
        success: true,
        message:
          'La base de données PostgreSQL multi-tenant a été réinitialisée avec succès aux données de démonstration.',
      });
    } catch (error: any) {
      console.error('POST /reset-demo error:', error);
      return res
        .status(500)
        .json({ error: 'SERVER_ERROR', message: 'Impossible de réinitialiser les données démo.' });
    }
  }
);

// Catch-all JSON 404 for unknown /api/* endpoints (never fall through to SPA HTML)
apiRouter.use((_req: Request, res: Response) => {
  return res.status(404).json({
    error: 'API_ROUTE_NOT_FOUND',
    message: 'Route API introuvable.',
  });
});
