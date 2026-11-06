/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { eq, and, desc, asc, inArray, lte } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  DEFAULT_TENANT_ID,
  tenants,
  users,
  courses,
  classes,
  enrollments,
  sessions,
  subscriptions,
  subscriptionPlans,
  notifications,
  userNotificationPreferences,
  emailQueue,
  integrationSettings,
  auditLogs,
} from '../src/db/schema.ts';
import {
  tdb,
  getCurrentTenantId,
  runWithTenantContext,
  mapTenantRow,
} from './tenantContext.ts';
import {
  renderTransactionalTemplate,
  toEmailBrandContext,
} from './emailTemplates.ts';
import type {
  EmailQueueItem,
  EmailQueueStats,
  EmailQueueStatus,
  EmailTemplateType,
  NotificationCategory,
  UserNotificationPreferences,
} from '../src/types/index.ts';

// =============================================================================
// 1. ROW MAPPERS
// =============================================================================

export function mapNotificationPreferencesRow(
  row: typeof userNotificationPreferences.$inferSelect
): UserNotificationPreferences {
  return {
    userId: row.userId,
    tenantId: row.tenantId,
    emailPasswordReset: true, // Security-critical alert always active
    emailPaymentConfirmation: Boolean(row.emailPaymentConfirmation),
    inAppPaymentConfirmation: Boolean(row.inAppPaymentConfirmation),
    emailSubscriptionExpiring: Boolean(row.emailSubscriptionExpiring),
    inAppSubscriptionExpiring: Boolean(row.inAppSubscriptionExpiring),
    emailSessionReminder: Boolean(row.emailSessionReminder),
    inAppSessionReminder: Boolean(row.inAppSessionReminder),
    emailAccountCreated: Boolean(row.emailAccountCreated),
    inAppAccountCreated: Boolean(row.inAppAccountCreated),
    emailInstallmentReminder: Boolean(row.emailInstallmentReminder),
    inAppInstallmentReminder: Boolean(row.inAppInstallmentReminder),
    updatedAt: row.updatedAt,
  };
}

export function mapEmailQueueRow(
  row: typeof emailQueue.$inferSelect,
  includeBodies = false
): EmailQueueItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId ?? undefined,
    recipientEmail: row.recipientEmail,
    recipientName: row.recipientName,
    templateType: row.templateType as EmailTemplateType,
    locale: row.locale === 'ar' ? 'ar' : 'fr',
    subject: row.subject,
    ...(includeBodies
      ? {
          htmlBody: row.htmlBody,
          textBody: row.textBody,
        }
      : {}),
    templateVariables: (row.templateVariables as Record<string, any>) || {},
    dedupKey: row.dedupKey ?? undefined,
    status: row.status as EmailQueueStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError ?? undefined,
    smtpMessageId: row.smtpMessageId ?? undefined,
    deliveryMode:
      row.deliveryMode === 'SMTP_LIVE'
        ? 'SMTP_LIVE'
        : row.deliveryMode === 'SANDBOX_SIMULATED'
          ? 'SANDBOX_SIMULATED'
          : undefined,
    sentAt: row.sentAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// =============================================================================
// 2. PER-USER NOTIFICATION PREFERENCES
// =============================================================================

export function buildDefaultNotificationPreferences(
  userId: string,
  tenantId: string = getCurrentTenantId()
): UserNotificationPreferences {
  return {
    userId,
    tenantId,
    emailPasswordReset: true,
    emailPaymentConfirmation: true,
    inAppPaymentConfirmation: true,
    emailSubscriptionExpiring: true,
    inAppSubscriptionExpiring: true,
    emailSessionReminder: true,
    inAppSessionReminder: true,
    emailAccountCreated: true,
    inAppAccountCreated: true,
    emailInstallmentReminder: true,
    inAppInstallmentReminder: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function getUserNotificationPreferences(
  userId: string,
  tenantId: string = getCurrentTenantId()
): Promise<UserNotificationPreferences> {
  const [row] = await db
    .select()
    .from(userNotificationPreferences)
    .where(
      and(
        eq(userNotificationPreferences.userId, userId),
        eq(userNotificationPreferences.tenantId, tenantId)
      )
    )
    .limit(1);

  if (!row) {
    return buildDefaultNotificationPreferences(userId, tenantId);
  }
  return mapNotificationPreferencesRow(row);
}

export async function upsertUserNotificationPreferences(
  userId: string,
  patch: Partial<
    Omit<UserNotificationPreferences, 'userId' | 'tenantId' | 'emailPasswordReset' | 'updatedAt'>
  >,
  tenantId: string = getCurrentTenantId()
): Promise<UserNotificationPreferences> {
  const current = await getUserNotificationPreferences(userId, tenantId);
  const nowIso = new Date().toISOString();

  const merged = {
    emailPasswordReset: true,
    emailPaymentConfirmation:
      patch.emailPaymentConfirmation ?? current.emailPaymentConfirmation,
    inAppPaymentConfirmation:
      patch.inAppPaymentConfirmation ?? current.inAppPaymentConfirmation,
    emailSubscriptionExpiring:
      patch.emailSubscriptionExpiring ?? current.emailSubscriptionExpiring,
    inAppSubscriptionExpiring:
      patch.inAppSubscriptionExpiring ?? current.inAppSubscriptionExpiring,
    emailSessionReminder: patch.emailSessionReminder ?? current.emailSessionReminder,
    inAppSessionReminder: patch.inAppSessionReminder ?? current.inAppSessionReminder,
    emailAccountCreated: patch.emailAccountCreated ?? current.emailAccountCreated,
    inAppAccountCreated: patch.inAppAccountCreated ?? current.inAppAccountCreated,
    emailInstallmentReminder:
      patch.emailInstallmentReminder ?? current.emailInstallmentReminder,
    inAppInstallmentReminder:
      patch.inAppInstallmentReminder ?? current.inAppInstallmentReminder,
  };

  const [existing] = await db
    .select({ userId: userNotificationPreferences.userId })
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(userNotificationPreferences)
      .set({
        ...merged,
        tenantId,
        updatedAt: nowIso,
      })
      .where(eq(userNotificationPreferences.userId, userId))
      .returning();
    return mapNotificationPreferencesRow(updated);
  }

  const [inserted] = await db
    .insert(userNotificationPreferences)
    .values({
      userId,
      tenantId,
      ...merged,
      updatedAt: nowIso,
    })
    .returning();
  return mapNotificationPreferencesRow(inserted);
}

export function checkChannelPreference(
  prefs: UserNotificationPreferences,
  category: NotificationCategory | EmailTemplateType,
  channel: 'email' | 'inApp'
): boolean {
  switch (category) {
    case 'PASSWORD_RESET':
      return true; // Critical account recovery security alerts cannot be silenced
    case 'PAYMENT_CONFIRMATION':
      return channel === 'email' ? prefs.emailPaymentConfirmation : prefs.inAppPaymentConfirmation;
    case 'SUBSCRIPTION_EXPIRING_7D':
      return channel === 'email'
        ? prefs.emailSubscriptionExpiring
        : prefs.inAppSubscriptionExpiring;
    case 'SESSION_REMINDER':
      return channel === 'email' ? prefs.emailSessionReminder : prefs.inAppSessionReminder;
    case 'ACCOUNT_CREATED':
      return channel === 'email' ? prefs.emailAccountCreated : prefs.inAppAccountCreated;
    case 'BILLING_REMINDER':
      return channel === 'email'
        ? prefs.emailInstallmentReminder
        : prefs.inAppInstallmentReminder;
    default:
      return true;
  }
}

// =============================================================================
// 3. SMTP CONFIGURATION RESOLUTION & REAL NODEMAILER TRANSPORT
// =============================================================================

export interface SmtpResolvedConfig {
  isEnabled: boolean;
  isTestMode: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  hasLiveSmtpTransport: boolean;
}

export async function ensureSmtpIntegrationRow(
  tenantId: string = getCurrentTenantId()
): Promise<typeof integrationSettings.$inferSelect> {
  const [existing] = await db
    .select()
    .from(integrationSettings)
    .where(
      and(
        eq(integrationSettings.tenantId, tenantId),
        eq(integrationSettings.provider, 'EMAIL_SMTP')
      )
    )
    .limit(1);

  if (existing) return existing;

  const [tenantRow] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const nowIso = new Date().toISOString();
  const [created] = await db
    .insert(integrationSettings)
    .values({
      id: `int_${tenantId}_smtp_${crypto.randomBytes(2).toString('hex')}`,
      tenantId,
      provider: 'EMAIL_SMTP',
      isEnabled: true,
      isTestMode: true,
      config: {
        host: process.env.SMTP_HOST || 'smtp.najahlearn.dz',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        pass: '',
        fromName: tenantRow?.name || process.env.SMTP_FROM_NAME || 'NajahLearn Académie',
        fromEmail:
          tenantRow?.contactEmail || process.env.SMTP_FROM_EMAIL || 'noreply@najahlearn.dz',
        replyTo: tenantRow?.contactEmail || 'scolarite@najahlearn.dz',
      },
      updatedAt: nowIso,
    })
    .returning();

  return created;
}

export async function getSmtpResolvedConfig(
  tenantId: string = getCurrentTenantId()
): Promise<SmtpResolvedConfig> {
  const [settingRow, tenantRows] = await Promise.all([
    ensureSmtpIntegrationRow(tenantId),
    db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
  ]);
  const tenantRow = tenantRows[0];
  const cfg = (settingRow?.config || {}) as Record<string, any>;

  const envHost = (process.env.SMTP_HOST || '').trim();
  const cfgHost = typeof cfg.host === 'string' ? cfg.host.trim() : '';
  const host = (!settingRow.isTestMode && cfgHost ? cfgHost : envHost || cfgHost) || '';

  const port = Number(cfg.port || process.env.SMTP_PORT || 587) || 587;
  const secure =
    typeof cfg.secure === 'boolean' ? cfg.secure : process.env.SMTP_SECURE === 'true';

  const user =
    (typeof cfg.user === 'string' ? cfg.user.trim() : '') ||
    (process.env.SMTP_USER || '').trim();

  const rawPass =
    typeof cfg.pass === 'string' && !cfg.pass.includes('••••')
      ? cfg.pass
      : typeof cfg.smtpPass === 'string' && !cfg.smtpPass.includes('••••')
        ? cfg.smtpPass
        : process.env.SMTP_PASS || '';

  const fromName =
    (typeof cfg.fromName === 'string' && cfg.fromName.trim()) ||
    process.env.SMTP_FROM_NAME ||
    tenantRow?.name ||
    'NajahLearn Académie';

  const fromEmail =
    (typeof cfg.fromEmail === 'string' && cfg.fromEmail.trim()) ||
    (typeof cfg.senderEmail === 'string' && cfg.senderEmail.trim()) ||
    process.env.SMTP_FROM_EMAIL ||
    tenantRow?.contactEmail ||
    'noreply@najahlearn.dz';

  const replyTo =
    (typeof cfg.replyTo === 'string' && cfg.replyTo.trim()) ||
    tenantRow?.contactEmail ||
    undefined;

  const isTestMode = Boolean(settingRow.isTestMode) && !envHost;
  const hasLiveSmtpTransport = Boolean(!isTestMode && host.length > 0 && port > 0);

  return {
    isEnabled: settingRow ? Boolean(settingRow.isEnabled) : true,
    isTestMode,
    host,
    port,
    secure,
    user,
    pass: rawPass,
    fromName,
    fromEmail,
    replyTo,
    hasLiveSmtpTransport,
  };
}

// =============================================================================
// 4. TRANSACTIONAL EMAIL OUTBOX ENQUEUE + IN-APP NOTIFICATION DISPATCH
// =============================================================================

export interface DispatchTransactionalEventParams {
  tenantId?: string;
  userId?: string;
  recipientEmail: string;
  recipientName: string;
  preferredLocale?: 'fr' | 'ar';
  templateType: EmailTemplateType;
  variables?: Record<string, any>;
  dedupKey?: string;
  appOrigin?: string;
  maxAttempts?: number;
  skipInAppNotification?: boolean;
  skipImmediateProcess?: boolean;
  /**
   * Optional test hook: number of initial delivery attempts that should fail
   * with a simulated transient SMTP 421 error to deterministically test retry/backoff.
   */
  simulateTransientFailuresCount?: number;
}

export interface DispatchTransactionalEventResult {
  emailQueued: boolean;
  emailSkippedByPreference: boolean;
  emailDeduplicated: boolean;
  emailQueueItem?: EmailQueueItem;
  inAppCreated: boolean;
  inAppSkippedByPreference: boolean;
  inAppNotificationId?: string;
}

/**
 * Enqueues a bilingual (FR / AR RTL) HTML transactional email in PostgreSQL `email_queue`
 * AND creates a matching In-App Notification in `notifications`, respecting the user's
 * saved `user_notification_preferences` and optional `dedupKey`.
 */
export async function dispatchTransactionalNotification(
  params: DispatchTransactionalEventParams
): Promise<DispatchTransactionalEventResult> {
  const resolvedTenantId = params.tenantId || getCurrentTenantId() || DEFAULT_TENANT_ID;

  return await runWithTenantContext({ tenantId: resolvedTenantId }, async () => {
    const [tenantRow, userRow] = await Promise.all([
      db.select().from(tenants).where(eq(tenants.id, resolvedTenantId)).limit(1).then((r) => r[0]),
      params.userId
        ? db
            .select()
            .from(users)
            .where(and(eq(users.id, params.userId), eq(users.tenantId, resolvedTenantId)))
            .limit(1)
            .then((r) => r[0])
        : Promise.resolve(undefined),
    ]);

    const mappedTenant = tenantRow ? mapTenantRow(tenantRow) : null;
    const brand = toEmailBrandContext(mappedTenant, params.appOrigin);

    const locale: 'fr' | 'ar' =
      params.preferredLocale ||
      (userRow?.preferredLanguage === 'ar' ? 'ar' : 'fr');

    const prefs = params.userId
      ? await getUserNotificationPreferences(params.userId, resolvedTenantId)
      : buildDefaultNotificationPreferences('anonymous', resolvedTenantId);

    const allowEmail = checkChannelPreference(prefs, params.templateType, 'email');
    const allowInApp =
      !params.skipInAppNotification &&
      Boolean(params.userId) &&
      checkChannelPreference(prefs, params.templateType, 'inApp');

    // Deduplication check if a dedupKey is provided (e.g., J-7 subscription sweep or session sweep)
    if (params.dedupKey) {
      const existingQueued = await tdb.findFirst(
        emailQueue,
        eq(emailQueue.dedupKey, params.dedupKey)
      );
      if (existingQueued) {
        return {
          emailQueued: false,
          emailSkippedByPreference: false,
          emailDeduplicated: true,
          emailQueueItem: mapEmailQueueRow(existingQueued),
          inAppCreated: false,
          inAppSkippedByPreference: false,
        };
      }
    }

    const templateVars: Record<string, any> = {
      ...(params.variables || {}),
      ...(params.simulateTransientFailuresCount && params.simulateTransientFailuresCount > 0
        ? { _simulateTransientFailuresCount: params.simulateTransientFailuresCount }
        : {}),
    };

    const rendered = renderTransactionalTemplate({
      templateType: params.templateType,
      locale,
      recipientName: params.recipientName || userRow?.name || 'Utilisateur',
      recipientEmail: params.recipientEmail || userRow?.email || '',
      brand,
      variables: templateVars,
    });

    const nowIso = new Date().toISOString();
    let createdNotifId: string | undefined;
    let queuedItem: EmailQueueItem | undefined;

    if (allowInApp && params.userId) {
      const notifId = `notif_${crypto.randomUUID()}`;
      await tdb.insertOne(notifications, {
        id: notifId,
        userId: params.userId,
        category: rendered.category,
        title: rendered.inAppTitle,
        message: rendered.inAppMessage,
        type: rendered.inAppType,
        link: rendered.inAppLink,
        read: false,
        readAt: null,
        createdAt: nowIso,
      });
      createdNotifId = notifId;
    }

    if (allowEmail && params.recipientEmail) {
      const queueId = `eml_${crypto.randomUUID()}`;
      const insertedEmail = await tdb.insertOne(emailQueue, {
        id: queueId,
        userId: params.userId ?? null,
        recipientEmail: params.recipientEmail.trim().toLowerCase(),
        recipientName: params.recipientName || userRow?.name || 'Utilisateur',
        templateType: params.templateType,
        locale: rendered.locale,
        subject: rendered.subject,
        htmlBody: rendered.htmlBody,
        textBody: rendered.textBody,
        templateVariables: templateVars,
        dedupKey: params.dedupKey ?? null,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: Math.max(1, Math.min(8, params.maxAttempts ?? 4)),
        nextAttemptAt: nowIso,
        lastError: null,
        smtpMessageId: null,
        deliveryMode: null,
        lockedAt: null,
        sentAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      queuedItem = mapEmailQueueRow(insertedEmail);

      if (!params.skipImmediateProcess) {
        setImmediate(() => {
          processEmailQueueBatch({ tenantId: resolvedTenantId, limit: 10 }).catch((err) => {
            console.warn('[NajahLearn SMTP Queue] Background dispatch warning:', err);
          });
        });
      }
    }

    return {
      emailQueued: Boolean(queuedItem),
      emailSkippedByPreference: !allowEmail,
      emailDeduplicated: false,
      emailQueueItem: queuedItem,
      inAppCreated: Boolean(createdNotifId),
      inAppSkippedByPreference: Boolean(
        !params.skipInAppNotification && params.userId && !allowInApp
      ),
      inAppNotificationId: createdNotifId,
    };
  });
}

// =============================================================================
// 5. PERSISTENT OUTBOX WORKER WITH RETRY & EXPONENTIAL BACKOFF
// =============================================================================

/**
 * Computes exponential backoff delay in seconds after a failed attempt:
 * Attempt 1 -> 30s, Attempt 2 -> 90s, Attempt 3 -> 270s, Attempt 4 -> 810s.
 */
export function computeRetryBackoffSeconds(attemptNumber: number): number {
  const exp = Math.max(0, Math.min(6, attemptNumber - 1));
  return 30 * Math.pow(3, exp);
}

export interface ProcessEmailQueueSummary {
  evaluatedCount: number;
  sentCount: number;
  retryScheduledCount: number;
  failedPermanentlyCount: number;
  processedItems: EmailQueueItem[];
}

/**
 * Processes due `PENDING` and `RETRY_SCHEDULED` emails in `email_queue`.
 * Supports real SMTP delivery via `nodemailer` as well as Sandbox simulation mode,
 * with automatic exponential backoff retry on transient failures.
 */
export async function processEmailQueueBatch(options?: {
  tenantId?: string;
  limit?: number;
  forceDueNow?: boolean;
  onlyEmailId?: string;
}): Promise<ProcessEmailQueueSummary> {
  const targetTenantId = options?.tenantId || getCurrentTenantId() || DEFAULT_TENANT_ID;
  const limit = Math.max(1, Math.min(50, options?.limit ?? 20));

  return await runWithTenantContext({ tenantId: targetTenantId }, async () => {
    const smtpCfg = await getSmtpResolvedConfig(targetTenantId);
    const now = new Date();
    const nowIso = now.toISOString();

    const baseStatusFilter = inArray(emailQueue.status, ['PENDING', 'RETRY_SCHEDULED']);
    const whereClause = options?.onlyEmailId
      ? and(eq(emailQueue.id, options.onlyEmailId), baseStatusFilter)
      : options?.forceDueNow
        ? baseStatusFilter
        : and(baseStatusFilter, lte(emailQueue.nextAttemptAt, nowIso));

    const dueRows = await tdb.selectMany(emailQueue, {
      where: whereClause,
      orderBy: asc(emailQueue.createdAt),
      limit,
    });

    if (dueRows.length === 0) {
      return {
        evaluatedCount: 0,
        sentCount: 0,
        retryScheduledCount: 0,
        failedPermanentlyCount: 0,
        processedItems: [],
      };
    }

    // Prepare reusable Nodemailer transporter if live SMTP is configured
    let transporter: Transporter | null = null;
    if (smtpCfg.hasLiveSmtpTransport) {
      transporter = nodemailer.createTransport({
        host: smtpCfg.host,
        port: smtpCfg.port,
        secure: smtpCfg.secure,
        ...(smtpCfg.user
          ? {
              auth: {
                user: smtpCfg.user,
                pass: smtpCfg.pass,
              },
            }
          : {}),
        connectionTimeout: 6000,
        greetingTimeout: 6000,
        socketTimeout: 10000,
        tls: {
          rejectUnauthorized: false,
        },
      });
    }

    let sentCount = 0;
    let retryScheduledCount = 0;
    let failedPermanentlyCount = 0;
    const processedItems: EmailQueueItem[] = [];

    for (const row of dueRows) {
      // Optimistic lock: only claim if still PENDING or RETRY_SCHEDULED
      const attemptNumber = row.attempts + 1;
      const lockedRows = await tdb.updateWhere(
        emailQueue,
        {
          status: 'PROCESSING',
          attempts: attemptNumber,
          lockedAt: nowIso,
          updatedAt: nowIso,
        },
        and(
          eq(emailQueue.id, row.id),
          inArray(emailQueue.status, ['PENDING', 'RETRY_SCHEDULED'])
        )!
      );

      if (lockedRows.length === 0) {
        continue; // Claimed concurrently by another worker tick
      }

      try {
        if (!smtpCfg.isEnabled) {
          throw new Error('SMTP_INTEGRATION_DISABLED: Passerelle SMTP désactivée pour cet établissement.');
        }

        const vars = (row.templateVariables as Record<string, any>) || {};
        const simFailLimit = Number(vars._simulateTransientFailuresCount) || 0;
        if (simFailLimit > 0 && attemptNumber <= simFailLimit) {
          throw new Error(
            `SMTP_421_TRANSIENT_ERROR: Connexion temporairement refusée par le relais SMTP (tentative ${attemptNumber}/${row.maxAttempts}).`
          );
        }

        let messageId = '';
        let deliveryMode: 'SMTP_LIVE' | 'SANDBOX_SIMULATED' = 'SANDBOX_SIMULATED';

        if (transporter && smtpCfg.hasLiveSmtpTransport) {
          const info = await transporter.sendMail({
            from: `"${smtpCfg.fromName.replace(/"/g, '')}" <${smtpCfg.fromEmail}>`,
            to: `"${row.recipientName.replace(/"/g, '')}" <${row.recipientEmail}>`,
            ...(smtpCfg.replyTo ? { replyTo: smtpCfg.replyTo } : {}),
            subject: row.subject,
            text: row.textBody,
            html: row.htmlBody,
          });
          messageId = info.messageId || `<${row.id}@${smtpCfg.host}>`;
          deliveryMode = 'SMTP_LIVE';
        } else {
          // Sandbox / Test mode capture with deterministic RFC-5322 Message-ID
          messageId = `<sandbox.${row.id}.${attemptNumber}@najahlearn.dz>`;
          deliveryMode = 'SANDBOX_SIMULATED';
        }

        const sentAtIso = new Date().toISOString();
        const [sentRow] = await tdb.updateWhere(
          emailQueue,
          {
            status: 'SENT',
            smtpMessageId: messageId,
            deliveryMode,
            lastError: null,
            lockedAt: null,
            sentAt: sentAtIso,
            updatedAt: sentAtIso,
          },
          eq(emailQueue.id, row.id)
        );
        sentCount++;
        if (sentRow) processedItems.push(mapEmailQueueRow(sentRow));
      } catch (err: any) {
        const errMessage = String(err?.message || 'Erreur de transport SMTP inconnue').slice(
          0,
          500
        );
        const failNow = new Date();
        const failIso = failNow.toISOString();

        if (attemptNumber < row.maxAttempts) {
          const backoffSec = computeRetryBackoffSeconds(attemptNumber);
          const nextAttemptIso = new Date(failNow.getTime() + backoffSec * 1000).toISOString();

          const [retryRow] = await tdb.updateWhere(
            emailQueue,
            {
              status: 'RETRY_SCHEDULED',
              nextAttemptAt: nextAttemptIso,
              lastError: errMessage,
              lockedAt: null,
              updatedAt: failIso,
            },
            eq(emailQueue.id, row.id)
          );
          retryScheduledCount++;
          if (retryRow) processedItems.push(mapEmailQueueRow(retryRow));
        } else {
          const [failedRow] = await tdb.updateWhere(
            emailQueue,
            {
              status: 'FAILED',
              lastError: errMessage,
              lockedAt: null,
              updatedAt: failIso,
            },
            eq(emailQueue.id, row.id)
          );
          failedPermanentlyCount++;
          if (failedRow) processedItems.push(mapEmailQueueRow(failedRow));

          await tdb
            .insertOne(auditLogs, {
              id: `log_${crypto.randomUUID()}`,
              userId: row.userId || 'system_smtp',
              userEmail: row.recipientEmail,
              userRole: 'ADMIN',
              action: 'EMAIL_DELIVERY_FAILED_PERMANENTLY',
              entity: 'EmailQueue',
              entityId: row.id,
              details: `Échec définitif d envoi SMTP après ${attemptNumber}/${row.maxAttempts} tentatives (${row.templateType} -> ${row.recipientEmail}) : ${errMessage}`,
              ipAddress: '127.0.0.1',
              timestamp: failIso,
            })
            .catch(() => {});
        }
      }
    }

    if (transporter) {
      transporter.close();
    }

    return {
      evaluatedCount: dueRows.length,
      sentCount,
      retryScheduledCount,
      failedPermanentlyCount,
      processedItems,
    };
  });
}

/**
 * Manually resets a `FAILED` or `RETRY_SCHEDULED` email in the active tenant's queue
 * and triggers immediate redelivery.
 */
export async function retryEmailQueueItem(emailId: string): Promise<{
  item: EmailQueueItem;
  summary: ProcessEmailQueueSummary;
}> {
  const existing = await tdb.findFirst(emailQueue, eq(emailQueue.id, emailId));
  if (!existing) {
    throw new Error('EMAIL_QUEUE_ITEM_NOT_FOUND');
  }
  if (existing.status === 'SENT') {
    throw new Error('EMAIL_ALREADY_SENT');
  }

  const nowIso = new Date().toISOString();
  const nextMax =
    existing.attempts >= existing.maxAttempts ? existing.attempts + 2 : existing.maxAttempts;

  // Clear any test failure simulation counter on manual retry if exhausted, or allow natural retry progression
  await tdb.updateWhere(
    emailQueue,
    {
      status: 'PENDING',
      maxAttempts: nextMax,
      nextAttemptAt: nowIso,
      lockedAt: null,
      updatedAt: nowIso,
    },
    eq(emailQueue.id, existing.id)
  );

  const summary = await processEmailQueueBatch({
    tenantId: existing.tenantId,
    onlyEmailId: existing.id,
    forceDueNow: true,
    limit: 1,
  });

  const refreshed = await tdb.findFirst(emailQueue, eq(emailQueue.id, existing.id));
  return {
    item: mapEmailQueueRow(refreshed || existing, true),
    summary,
  };
}

export async function listEmailQueueScoped(filters?: {
  status?: string;
  templateType?: string;
  limit?: number;
}): Promise<{
  items: EmailQueueItem[];
  stats: EmailQueueStats;
}> {
  const allRows = await tdb.selectMany(emailQueue, {
    orderBy: desc(emailQueue.createdAt),
    limit: 300,
  });

  const stats: EmailQueueStats = {
    total: allRows.length,
    pendingCount: allRows.filter((r) => r.status === 'PENDING').length,
    processingCount: allRows.filter((r) => r.status === 'PROCESSING').length,
    sentCount: allRows.filter((r) => r.status === 'SENT').length,
    retryScheduledCount: allRows.filter((r) => r.status === 'RETRY_SCHEDULED').length,
    failedCount: allRows.filter((r) => r.status === 'FAILED').length,
  };

  let filtered = allRows;
  if (filters?.status && filters.status !== 'ALL') {
    filtered = filtered.filter((r) => r.status === filters.status);
  }
  if (filters?.templateType && filters.templateType !== 'ALL') {
    filtered = filtered.filter((r) => r.templateType === filters.templateType);
  }

  const maxItems = Math.max(1, Math.min(200, filters?.limit ?? 100));
  return {
    items: filtered.slice(0, maxItems).map((r) => mapEmailQueueRow(r, false)),
    stats,
  };
}

// =============================================================================
// 6. AUTOMATED SWEEPS : EXPIRING SUBSCRIPTIONS (J-7) & SESSION REMINDERS
// =============================================================================

function diffDaysYmd(targetYmd: string, refYmd: string): number {
  const t = new Date(`${targetYmd}T00:00:00.000Z`).getTime();
  const r = new Date(`${refYmd}T00:00:00.000Z`).getTime();
  return Math.round((t - r) / 86_400_000);
}

/**
 * Scans `ACTIVE` subscriptions in the active tenant expiring within the next 7 days
 * (`1 <= daysRemaining <= 7`) and dispatches localized FR/AR `SUBSCRIPTION_EXPIRING_7D`
 * HTML emails + in-app notifications (deduplicated per subscription & endDate).
 */
export async function runExpiringSubscriptionsSweepForTenant(options?: {
  referenceDateYmd?: string;
  appOrigin?: string;
}): Promise<{
  evaluatedSubscriptions: number;
  expiringSoonMatched: number;
  emailsQueued: number;
  inAppCreated: number;
}> {
  const todayYmd = options?.referenceDateYmd || new Date().toISOString().split('T')[0];

  const [activeSubs, userRows, courseRows, planRows] = await Promise.all([
    tdb.selectMany(subscriptions, { where: eq(subscriptions.status, 'ACTIVE') }),
    tdb.selectMany(users),
    tdb.selectMany(courses),
    tdb.selectMany(subscriptionPlans),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const courseMap = new Map(courseRows.map((c) => [c.id, c]));
  const planMap = new Map(planRows.map((p) => [p.id, p]));

  let expiringSoonMatched = 0;
  let emailsQueued = 0;
  let inAppCreated = 0;

  for (const sub of activeSubs) {
    const daysRemaining = diffDaysYmd(sub.endDate, todayYmd);
    if (daysRemaining < 1 || daysRemaining > 7) {
      continue;
    }

    const student = userMap.get(sub.studentId);
    if (!student || student.status !== 'ACTIVE') continue;

    expiringSoonMatched++;
    const course = courseMap.get(sub.courseId);
    const plan = planMap.get(sub.planId);

    const dispatched = await dispatchTransactionalNotification({
      userId: student.id,
      recipientEmail: student.email,
      recipientName: student.name,
      preferredLocale: student.preferredLanguage === 'ar' ? 'ar' : 'fr',
      templateType: 'SUBSCRIPTION_EXPIRING_7D',
      dedupKey: `sub_exp7d:${sub.id}:${sub.endDate}`,
      appOrigin: options?.appOrigin,
      skipImmediateProcess: true,
      variables: {
        subscriptionId: sub.id,
        courseId: sub.courseId,
        courseTitle: course?.title || 'Formation',
        endDate: sub.endDate,
        daysRemaining,
        renewalAmountDzd: course?.priceDzd || plan?.priceDzd || 6500,
      },
    });

    if (dispatched.emailQueued) emailsQueued++;
    if (dispatched.inAppCreated) inAppCreated++;
  }

  if (emailsQueued > 0) {
    await processEmailQueueBatch({ limit: 30 });
  }

  return {
    evaluatedSubscriptions: activeSubs.length,
    expiringSoonMatched,
    emailsQueued,
    inAppCreated,
  };
}

/**
 * Scans `SCHEDULED` live sessions starting within the next `windowHours` (default 24h)
 * and dispatches localized FR/AR `SESSION_REMINDER` HTML emails + in-app notifications
 * to enrolled active students (deduplicated per session & student).
 */
export async function runSessionRemindersSweepForTenant(options?: {
  referenceTimeIso?: string;
  windowHours?: number;
  appOrigin?: string;
}): Promise<{
  evaluatedSessions: number;
  upcomingSessionsMatched: number;
  emailsQueued: number;
  inAppCreated: number;
}> {
  const refMs = options?.referenceTimeIso
    ? new Date(options.referenceTimeIso).getTime()
    : Date.now();
  const windowMs = Math.max(1, Math.min(72, options?.windowHours ?? 24)) * 3_600_000;

  const [scheduledSessions, enrollmentRows, userRows, courseRows, classRows] = await Promise.all([
    tdb.selectMany(sessions, { where: eq(sessions.status, 'SCHEDULED') }),
    tdb.selectMany(enrollments, { where: eq(enrollments.status, 'ACTIVE') }),
    tdb.selectMany(users),
    tdb.selectMany(courses),
    tdb.selectMany(classes),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const courseMap = new Map(courseRows.map((c) => [c.id, c]));
  const classMap = new Map(classRows.map((c) => [c.id, c]));

  let upcomingSessionsMatched = 0;
  let emailsQueued = 0;
  let inAppCreated = 0;

  for (const ses of scheduledSessions) {
    const sesMs = new Date(ses.scheduledAt).getTime();
    const deltaMs = sesMs - refMs;
    if (Number.isNaN(sesMs) || deltaMs <= 0 || deltaMs > windowMs) {
      continue;
    }

    upcomingSessionsMatched++;
    const course = courseMap.get(ses.courseId);
    const cls = classMap.get(ses.classId);
    const teacher = userMap.get(ses.teacherId);
    const classEnrollments = enrollmentRows.filter((e) => e.classId === ses.classId);

    const scheduledDisplay = ses.scheduledAt.replace('T', ' ').slice(0, 16);

    for (const enr of classEnrollments) {
      const student = userMap.get(enr.studentId);
      if (!student || student.status !== 'ACTIVE') continue;

      const dispatched = await dispatchTransactionalNotification({
        userId: student.id,
        recipientEmail: student.email,
        recipientName: student.name,
        preferredLocale: student.preferredLanguage === 'ar' ? 'ar' : 'fr',
        templateType: 'SESSION_REMINDER',
        dedupKey: `ses_rem:${ses.id}:${student.id}`,
        appOrigin: options?.appOrigin,
        skipImmediateProcess: true,
        variables: {
          sessionId: ses.id,
          sessionTitle: ses.title,
          courseTitle: course?.title || '',
          className: cls?.name || '',
          teacherName: teacher?.name || '',
          scheduledAt: ses.scheduledAt,
          scheduledDisplay,
          durationMinutes: ses.durationMinutes,
          videoProvider: ses.videoProvider,
        },
      });

      if (dispatched.emailQueued) emailsQueued++;
      if (dispatched.inAppCreated) inAppCreated++;
    }
  }

  if (emailsQueued > 0) {
    await processEmailQueueBatch({ limit: 50 });
  }

  return {
    evaluatedSessions: scheduledSessions.length,
    upcomingSessionsMatched,
    emailsQueued,
    inAppCreated,
  };
}

/**
 * Background maintenance tick across all active establishments:
 * 1. Retries due `RETRY_SCHEDULED` / `PENDING` emails in `email_queue`
 * 2. Dispatches J-7 expiring subscription warnings & 24h upcoming session reminders
 */
export async function runEmailQueueAndSweepsAcrossAllTenants(): Promise<void> {
  const activeTenants = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.status, 'ACTIVE'));

  for (const t of activeTenants) {
    await runWithTenantContext({ tenantId: t.id }, async () => {
      await processEmailQueueBatch({ tenantId: t.id, limit: 25 });
      await runExpiringSubscriptionsSweepForTenant();
      await runSessionRemindersSweepForTenant();
    }).catch((err) => {
      console.warn(`[NajahLearn SMTP Worker] Sweep warning for tenant ${t.id}:`, err);
    });
  }
}
