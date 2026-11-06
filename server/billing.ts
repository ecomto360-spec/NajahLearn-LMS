/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  DEFAULT_TENANT_ID,
  tenants,
  users,
  studentProfiles,
  courses,
  subscriptions,
  payments,
  chargilyCheckouts,
  paymentWebhookEvents,
  installmentPlans,
  installmentItems,
  paymentReminders,
  invoices,
  notifications,
  auditLogs,
  integrationSettings,
} from '../src/db/schema.ts';
import {
  tdb,
  getCurrentTenantId,
  runWithTenantContext,
  mapTenantRow,
} from './tenantContext.ts';
import { confirmPaymentTransaction, mapPaymentRow } from './db.ts';
import {
  getUserNotificationPreferences,
  checkChannelPreference,
} from './emailService.ts';
import type {
  ChargilyCardMethod,
  ChargilyCheckout,
  ChargilyCheckoutStatus,
  InstallmentItem,
  InstallmentItemStatus,
  InstallmentPlan,
  InstallmentPlanStatus,
  Invoice,
  Payment,
  PaymentMethod,
  PaymentReminder,
  PaymentReminderType,
} from '../src/types/index.ts';

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// =============================================================================
// 1. ROW MAPPERS
// =============================================================================

export function mapChargilyCheckoutRow(
  row: typeof chargilyCheckouts.$inferSelect
): ChargilyCheckout {
  return {
    id: row.id,
    tenantId: row.tenantId,
    paymentId: row.paymentId,
    studentId: row.studentId,
    courseId: row.courseId,
    installmentItemId: row.installmentItemId ?? undefined,
    amountDzd: row.amountDzd,
    currency: 'dzd',
    cardMethod: (row.cardMethod === 'cib' ? 'cib' : 'edahabia') as ChargilyCardMethod,
    mode: row.mode === 'live' ? 'live' : 'test',
    status: row.status as ChargilyCheckoutStatus,
    checkoutUrl: row.checkoutUrl,
    isLiveApi: row.checkoutUrl.startsWith('https://pay.chargily.net/'),
    idempotencyKey: row.idempotencyKey ?? undefined,
    failureReason: row.failureReason ?? undefined,
    metadata: (row.metadata as Record<string, any>) || {},
    paidAt: row.paidAt ?? undefined,
    failedAt: row.failedAt ?? undefined,
    refundedAt: row.refundedAt ?? undefined,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapInstallmentItemRow(
  row: typeof installmentItems.$inferSelect
): InstallmentItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planId: row.planId,
    studentId: row.studentId,
    courseId: row.courseId,
    installmentNumber: row.installmentNumber,
    totalInstallments: row.totalInstallments,
    amountDzd: row.amountDzd,
    dueDate: row.dueDate,
    status: row.status as InstallmentItemStatus,
    paymentId: row.paymentId ?? undefined,
    paidAt: row.paidAt ?? undefined,
    reminderCount: row.reminderCount,
    lastReminderType: row.lastReminderType ?? undefined,
    lastReminderAt: row.lastReminderAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapInstallmentPlanRow(
  row: typeof installmentPlans.$inferSelect,
  items: InstallmentItem[] = [],
  extra?: { studentName?: string; studentEmail?: string; courseTitle?: string }
): InstallmentPlan {
  const remainingAmountDzd = Math.max(0, row.totalAmountDzd - row.paidAmountDzd);
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    studentName: extra?.studentName,
    studentEmail: extra?.studentEmail,
    courseId: row.courseId,
    courseTitle: extra?.courseTitle,
    subscriptionId: row.subscriptionId ?? undefined,
    title: row.title,
    totalAmountDzd: row.totalAmountDzd,
    paidAmountDzd: row.paidAmountDzd,
    remainingAmountDzd,
    installmentsCount: row.installmentsCount,
    intervalDays: row.intervalDays,
    status: row.status as InstallmentPlanStatus,
    notes: row.notes ?? undefined,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items,
  };
}

export function mapPaymentReminderRow(
  row: typeof paymentReminders.$inferSelect,
  studentName?: string
): PaymentReminder {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    studentName,
    planId: row.planId,
    installmentItemId: row.installmentItemId,
    reminderType: row.reminderType as PaymentReminderType,
    channel: row.channel,
    amountDzd: row.amountDzd,
    dueDate: row.dueDate,
    subject: row.subject,
    message: row.message,
    triggeredBy: row.triggeredBy,
    sentAt: row.sentAt,
  };
}

export function mapInvoiceRow(row: typeof invoices.$inferSelect): Invoice {
  return {
    id: row.id,
    tenantId: row.tenantId,
    invoiceNumber: row.invoiceNumber,
    sequenceNumber: row.sequenceNumber,
    fiscalYear: row.fiscalYear,
    paymentId: row.paymentId,
    studentId: row.studentId,
    courseId: row.courseId,
    installmentNumber: row.installmentNumber ?? undefined,
    totalInstallments: row.totalInstallments ?? undefined,
    status: row.status === 'REFUNDED' ? 'REFUNDED' : 'PAID',
    creditNoteNumber: row.creditNoteNumber ?? undefined,
    currency: row.currency || 'DZD',
    amountHtDzd: row.amountHtDzd,
    tvaApplicable: Boolean(row.tvaApplicable),
    tvaRatePercent: row.tvaRatePercent,
    tvaAmountDzd: row.tvaAmountDzd,
    amountTtcDzd: row.amountTtcDzd,
    paymentMethod: row.paymentMethod as PaymentMethod,
    transactionReference: row.transactionReference,
    sellerSnapshot: row.sellerSnapshot,
    buyerSnapshot: row.buyerSnapshot,
    lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
    footerNote: row.footerNote ?? undefined,
    issuedAt: row.issuedAt,
    paidAt: row.paidAt ?? undefined,
    refundedAt: row.refundedAt ?? undefined,
    refundReason: row.refundReason ?? undefined,
    createdAt: row.createdAt,
  };
}

// =============================================================================
// 2. CHARGILY PAY V2 CONFIGURATION & HMAC-SHA256 SIGNATURE VERIFICATION
// =============================================================================

export interface ChargilyResolvedConfig {
  isEnabled: boolean;
  mode: 'test' | 'live';
  publicKey: string;
  secretKey: string;
  webhookSecret: string;
  hasExternalChargilyKey: boolean;
}

export function maskIntegrationConfigForClient(
  config: Record<string, any> | null | undefined
): Record<string, any> {
  const src = { ...(config || {}) };
  for (const sensitiveKey of [
    'secretKey',
    'webhookSecret',
    'clientSecret',
    'pass',
    'smtpPass',
  ]) {
    if (typeof src[sensitiveKey] === 'string' && src[sensitiveKey].trim().length > 0) {
      const val = src[sensitiveKey].trim();
      src[sensitiveKey] =
        val.length > 8 ? `${val.slice(0, 4)}••••••••${val.slice(-4)}` : '••••••••';
    }
  }
  return src;
}

export async function getChargilyResolvedConfig(
  tenantId: string = getCurrentTenantId()
): Promise<ChargilyResolvedConfig> {
  const [settingRow] = await db
    .select()
    .from(integrationSettings)
    .where(
      and(
        eq(integrationSettings.tenantId, tenantId),
        eq(integrationSettings.provider, 'PAYMENT_GATEWAY')
      )
    )
    .limit(1);

  const cfg = (settingRow?.config || {}) as Record<string, any>;
  const isChargilyRecord = cfg.gateway === 'chargily_pay_v2' || cfg.gateway === 'chargily';

  // Enabled by default unless admin explicitly turned off the Chargily gateway
  const isEnabled = settingRow
    ? isChargilyRecord
      ? Boolean(settingRow.isEnabled)
      : true
    : true;

  const envMode = process.env.CHARGILY_MODE === 'live' ? 'live' : 'test';
  const mode: 'test' | 'live' = settingRow
    ? settingRow.isTestMode
      ? 'test'
      : 'live'
    : envMode;

  const rawSecretKey =
    (typeof cfg.secretKey === 'string' && !cfg.secretKey.includes('••••')
      ? cfg.secretKey.trim()
      : '') ||
    (process.env.CHARGILY_SECRET_KEY || '').trim();

  const rawPublicKey =
    (typeof cfg.publicKey === 'string' ? cfg.publicKey.trim() : '') ||
    (process.env.CHARGILY_API_KEY || '').trim();

  const hasExternalChargilyKey =
    rawSecretKey.startsWith('test_sk_') ||
    rawSecretKey.startsWith('live_sk_') ||
    rawSecretKey.startsWith('sk_test_') ||
    rawSecretKey.startsWith('sk_live_');

  const fallbackSandboxSecret = crypto
    .createHmac(
      'sha256',
      process.env.CHARGILY_WEBHOOK_SECRET ||
        process.env.JWT_SECRET ||
        'najahlearn_chargily_v2_hmac_key_2026'
    )
    .update(`chargily_tenant_${tenantId}`)
    .digest('hex');

  const rawWebhookSecret =
    (typeof cfg.webhookSecret === 'string' && !cfg.webhookSecret.includes('••••')
      ? cfg.webhookSecret.trim()
      : '') ||
    (process.env.CHARGILY_WEBHOOK_SECRET || '').trim() ||
    rawSecretKey ||
    fallbackSandboxSecret;

  return {
    isEnabled,
    mode,
    publicKey: rawPublicKey,
    secretKey: rawSecretKey || fallbackSandboxSecret,
    webhookSecret: rawWebhookSecret,
    hasExternalChargilyKey,
  };
}

/**
 * Computes Chargily Pay V2 lowercase hex HMAC-SHA256 signature over the exact raw request body.
 */
export function computeChargilySignature(
  rawBody: Buffer | string,
  secretKey: string
): string {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return crypto.createHmac('sha256', secretKey).update(buf).digest('hex');
}

/**
 * Timing-safe verification of Chargily Pay V2 `signature` header against raw payload bytes.
 */
export function verifyChargilySignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secretKey: string
): boolean {
  if (!signatureHeader || !secretKey) return false;
  const cleanedSig = signatureHeader.trim().toLowerCase().replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/.test(cleanedSig)) {
    return false;
  }

  const expectedHex = computeChargilySignature(rawBody, secretKey);
  const providedBuf = Buffer.from(cleanedSig, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

// =============================================================================
// 3. INSTALLMENT SYNCHRONIZATION & SEQUENTIAL INVOICE ISSUANCE (IN ACID TX)
// =============================================================================

export interface InstallmentSyncResult {
  installmentNumber?: number;
  totalInstallments?: number;
  planId?: string;
  intervalDays?: number;
  isPlanCompleted?: boolean;
}

/**
 * Synchronizes any linked installment item & parent installment plan when a payment is confirmed.
 * Executed inside `confirmPaymentTransaction` so payment, subscription, installment & invoice commit atomically.
 */
export async function syncInstallmentOnPaymentConfirmedInTx(
  tx: DbTx,
  paymentRow: typeof payments.$inferSelect,
  subscriptionId?: string
): Promise<InstallmentSyncResult> {
  const txDb = tdb.forTx(tx);
  const nowIso = new Date().toISOString();
  const todayStr = nowIso.split('T')[0];

  let itemRow: typeof installmentItems.$inferSelect | undefined;
  if (paymentRow.installmentItemId) {
    itemRow = await txDb.findFirst(
      installmentItems,
      eq(installmentItems.id, paymentRow.installmentItemId)
    );
  }
  if (!itemRow) {
    itemRow = await txDb.findFirst(
      installmentItems,
      eq(installmentItems.paymentId, paymentRow.id)
    );
  }

  if (!itemRow) {
    return {};
  }

  await txDb.updateWhere(
    installmentItems,
    {
      status: 'PAID',
      paymentId: paymentRow.id,
      paidAt: nowIso,
      updatedAt: nowIso,
    },
    eq(installmentItems.id, itemRow.id)
  );

  if (paymentRow.installmentItemId !== itemRow.id) {
    await txDb.updateWhere(
      payments,
      { installmentItemId: itemRow.id },
      eq(payments.id, paymentRow.id)
    );
  }

  const allPlanItems = await txDb.selectMany(installmentItems, {
    where: eq(installmentItems.planId, itemRow.planId),
    orderBy: asc(installmentItems.installmentNumber),
  });

  const paidAmountDzd = allPlanItems.reduce(
    (sum, it) => sum + (it.status === 'PAID' || it.id === itemRow!.id ? it.amountDzd : 0),
    0
  );
  const allPaid = allPlanItems.every((it) => it.status === 'PAID' || it.id === itemRow!.id);
  const hasOverdue = allPlanItems.some(
    (it) =>
      it.id !== itemRow!.id &&
      (it.status === 'OVERDUE' || (it.status === 'PENDING' && it.dueDate < todayStr))
  );

  const planRow = await txDb.findFirst(
    installmentPlans,
    eq(installmentPlans.id, itemRow.planId)
  );

  const nextPlanStatus: InstallmentPlanStatus = allPaid
    ? 'COMPLETED'
    : hasOverdue
      ? 'OVERDUE'
      : 'ACTIVE';

  if (planRow) {
    await txDb.updateWhere(
      installmentPlans,
      {
        paidAmountDzd,
        status: nextPlanStatus,
        subscriptionId: subscriptionId || planRow.subscriptionId,
        updatedAt: nowIso,
      },
      eq(installmentPlans.id, planRow.id)
    );
  }

  return {
    installmentNumber: itemRow.installmentNumber,
    totalInstallments: itemRow.totalInstallments,
    planId: itemRow.planId,
    intervalDays: planRow?.intervalDays || 30,
    isPlanCompleted: allPaid,
  };
}

/**
 * Issues a gap-free sequentially numbered fiscal invoice inside an active PostgreSQL transaction.
 * Locks the establishment row (`FOR UPDATE`) to prevent concurrent sequence collisions.
 */
export async function issueSequentialInvoiceInTx(
  tx: DbTx,
  paymentRow: typeof payments.$inferSelect,
  installmentMeta?: InstallmentSyncResult
): Promise<Invoice> {
  const txDb = tdb.forTx(tx);
  const tenantId = paymentRow.tenantId || getCurrentTenantId();

  // Idempotent guard: return existing invoice if already issued for this payment
  const existing = await txDb.findFirst(invoices, eq(invoices.paymentId, paymentRow.id));
  if (existing) {
    return mapInvoiceRow(existing);
  }

  // Row-level lock on tenant to guarantee gap-free monotonic sequence numbering
  await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

  const [tenantRow] = await tx
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenantRow) {
    throw new Error('Établissement introuvable pour la facturation séquentielle.');
  }

  const tenant = mapTenantRow(tenantRow);
  const nowIso = new Date().toISOString();
  const baseDateStr = paymentRow.confirmedAt || paymentRow.paymentDate || nowIso;
  const parsedYear = parseInt(baseDateStr.slice(0, 4), 10);
  const fiscalYear =
    Number.isFinite(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  const latestSeqRows = await tx
    .select({ seq: invoices.sequenceNumber })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.fiscalYear, fiscalYear)))
    .orderBy(desc(invoices.sequenceNumber))
    .limit(1);

  const maxExistingSeq = Number(latestSeqRows[0]?.seq ?? 0);
  const configuredNextSeq = Number(tenantRow.invoiceNextSequence ?? 1);
  const sequenceNumber = Math.max(configuredNextSeq, maxExistingSeq + 1);

  const prefix = (tenant.invoicePrefix || `FAC-${tenant.shortName || 'NL'}`)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');

  const invoiceNumber = `${prefix}-${fiscalYear}-${String(sequenceNumber).padStart(5, '0')}`;

  await tx
    .update(tenants)
    .set({
      invoiceNextSequence: sequenceNumber + 1,
      updatedAt: nowIso,
    })
    .where(eq(tenants.id, tenantId));

  // Fetch student & course details for immutable fiscal snapshot
  const [studentRow, studentProfileRow, courseRow] = await Promise.all([
    txDb.findFirst(users, eq(users.id, paymentRow.studentId)),
    txDb.findFirst(studentProfiles, eq(studentProfiles.userId, paymentRow.studentId)),
    txDb.findFirst(courses, eq(courses.id, paymentRow.courseId)),
  ]);

  const tvaApplicable = Boolean(tenant.tvaApplicable) && Number(tenant.tvaRatePercent) > 0;
  const tvaRatePercent = tvaApplicable ? Number(tenant.tvaRatePercent) : 0;
  const amountTtcDzd = Number(paymentRow.amountDzd);
  const amountHtDzd = tvaApplicable
    ? Math.round(amountTtcDzd / (1 + tvaRatePercent / 100))
    : amountTtcDzd;
  const tvaAmountDzd = amountTtcDzd - amountHtDzd;

  const installmentSuffix =
    installmentMeta?.installmentNumber && installmentMeta?.totalInstallments
      ? ` — Échéance ${installmentMeta.installmentNumber}/${installmentMeta.totalInstallments}`
      : '';

  const lineDescription = `${courseRow?.title || 'Formation Académique'}${installmentSuffix}`;

  const inserted = await txDb.insertOne(invoices, {
    id: `inv_${crypto.randomUUID()}`,
    invoiceNumber,
    sequenceNumber,
    fiscalYear,
    paymentId: paymentRow.id,
    studentId: paymentRow.studentId,
    courseId: paymentRow.courseId,
    installmentNumber: installmentMeta?.installmentNumber ?? null,
    totalInstallments: installmentMeta?.totalInstallments ?? null,
    status: 'PAID',
    creditNoteNumber: null,
    currency: paymentRow.currency || tenant.settings.currency || 'DZD',
    amountHtDzd,
    tvaApplicable,
    tvaRatePercent,
    tvaAmountDzd,
    amountTtcDzd,
    paymentMethod: paymentRow.paymentMethod,
    transactionReference: paymentRow.transactionReference,
    sellerSnapshot: {
      name: tenant.name,
      shortName: tenant.shortName,
      address: tenant.address,
      city: tenant.city,
      wilaya: tenant.wilaya,
      country: tenant.country,
      phone: tenant.contactPhone,
      email: tenant.contactEmail,
      website: tenant.website,
      accreditationNumber: tenant.accreditationNumber,
      nif: tenant.nif || tenant.taxId?.replace(/^NIF\s*/i, ''),
      nis: tenant.nis,
      rc: tenant.rc,
      articleImposition: tenant.articleImposition,
      primaryColor: tenant.primaryColor,
      logoUrl: tenant.logoUrl,
    },
    buyerSnapshot: {
      id: paymentRow.studentId,
      name: studentRow?.name || 'Étudiant',
      email: studentRow?.email || '',
      phone: studentRow?.phone ?? undefined,
      studentIdNumber: studentProfileRow?.studentIdNumber ?? undefined,
      city: studentProfileRow?.city ?? undefined,
      wilaya: studentProfileRow?.wilaya ?? undefined,
    },
    lineItems: [
      {
        description: lineDescription,
        courseCode: courseRow?.code,
        quantity: 1,
        unitPriceHtDzd: amountHtDzd,
        tvaRatePercent,
        tvaAmountDzd,
        totalTtcDzd: amountTtcDzd,
      },
    ],
    footerNote:
      tenant.invoiceFooterNote ||
      tenant.settings.receiptFooterNote ||
      'Facture fiscale officielle numérotée séquentiellement.',
    issuedAt: nowIso,
    paidAt: paymentRow.confirmedAt || nowIso,
    refundedAt: null,
    refundReason: null,
    createdAt: nowIso,
  });

  return mapInvoiceRow(inserted);
}

// =============================================================================
// 4. INSTALLMENT PLANS (PAIEMENT EN PLUSIEURS FOIS)
// =============================================================================

export async function createInstallmentPlan(params: {
  studentId: string;
  courseId: string;
  totalAmountDzd?: number;
  installmentsCount: number;
  intervalDays?: number;
  firstDueDate?: string;
  title?: string;
  notes?: string;
  createdBy?: string;
  ipAddress?: string;
}): Promise<InstallmentPlan> {
  const tenantId = getCurrentTenantId();
  const [tenantRow] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (tenantRow) {
    const mappedTenant = mapTenantRow(tenantRow);
    if (mappedTenant.settings.allowInstallments === false) {
      throw new Error('INSTALLMENTS_DISABLED_FOR_TENANT');
    }
  }

  const [studentRow, courseRow] = await Promise.all([
    tdb.findFirst(users, eq(users.id, params.studentId)),
    tdb.findFirst(courses, eq(courses.id, params.courseId)),
  ]);

  if (!studentRow || studentRow.role !== 'STUDENT') {
    throw new Error('STUDENT_NOT_FOUND');
  }
  if (!courseRow) {
    throw new Error('COURSE_NOT_FOUND');
  }

  const countN = Math.max(2, Math.min(12, Math.trunc(params.installmentsCount)));
  const intervalDays = Math.max(7, Math.min(90, Math.trunc(params.intervalDays || 30)));
  const totalAmountDzd = Math.max(
    countN * 100,
    Math.trunc(params.totalAmountDzd ?? courseRow.priceDzd)
  );

  // Check if an active non-completed plan already exists for this student & course
  const existingPlans = await tdb.selectMany(installmentPlans, {
    where: and(
      eq(installmentPlans.studentId, params.studentId),
      eq(installmentPlans.courseId, params.courseId)
    ),
    orderBy: desc(installmentPlans.createdAt),
  });
  const activeExisting = existingPlans.find(
    (p) => p.status === 'ACTIVE' || p.status === 'OVERDUE'
  );
  if (activeExisting) {
    const existingItems = await tdb.selectMany(installmentItems, {
      where: eq(installmentItems.planId, activeExisting.id),
      orderBy: asc(installmentItems.installmentNumber),
    });
    return mapInstallmentPlanRow(
      activeExisting,
      existingItems.map(mapInstallmentItemRow),
      {
        studentName: studentRow.name,
        studentEmail: studentRow.email,
        courseTitle: courseRow.title,
      }
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = nowIso.split('T')[0];
  const startDueStr =
    params.firstDueDate && /^\d{4}-\d{2}-\d{2}$/.test(params.firstDueDate)
      ? params.firstDueDate
      : todayStr;

  const baseAmount = Math.floor(totalAmountDzd / countN);
  const firstRemainder = totalAmountDzd - baseAmount * countN;

  return await db.transaction(async (tx) => {
    const txDb = tdb.forTx(tx);
    const planId = `iplan_${crypto.randomUUID()}`;
    const planTitle =
      params.title?.trim() ||
      `Échéancier ${countN}x — ${courseRow.title}`;

    const baseDate = new Date(`${startDueStr}T00:00:00.000Z`);
    let hasOverdueOnInit = false;
    const itemPayloads: Array<typeof installmentItems.$inferSelect> = [];

    const insertedPlan = await txDb.insertOne(installmentPlans, {
      id: planId,
      studentId: params.studentId,
      courseId: params.courseId,
      subscriptionId: null,
      title: planTitle,
      totalAmountDzd,
      paidAmountDzd: 0,
      installmentsCount: countN,
      intervalDays,
      status: 'ACTIVE',
      notes: params.notes ?? null,
      createdBy: params.createdBy ?? params.studentId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    for (let idx = 0; idx < countN; idx++) {
      const due = new Date(baseDate.getTime() + idx * intervalDays * 86_400_000);
      const dueStr = due.toISOString().split('T')[0];
      const itemStatus: InstallmentItemStatus = dueStr < todayStr ? 'OVERDUE' : 'PENDING';
      if (itemStatus === 'OVERDUE') hasOverdueOnInit = true;

      const itemAmount = idx === 0 ? baseAmount + firstRemainder : baseAmount;
      const insertedItem = await txDb.insertOne(installmentItems, {
        id: `iitem_${crypto.randomUUID()}`,
        planId,
        studentId: params.studentId,
        courseId: params.courseId,
        installmentNumber: idx + 1,
        totalInstallments: countN,
        amountDzd: itemAmount,
        dueDate: dueStr,
        status: itemStatus,
        paymentId: null,
        paidAt: null,
        reminderCount: 0,
        lastReminderType: null,
        lastReminderAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      itemPayloads.push(insertedItem);
    }

    if (hasOverdueOnInit) {
      const [updatedPlan] = await txDb.updateWhere(
        installmentPlans,
        { status: 'OVERDUE' },
        eq(installmentPlans.id, planId)
      );
      Object.assign(insertedPlan, updatedPlan);
    }

    await txDb.insertOne(auditLogs, {
      id: `log_${crypto.randomUUID()}`,
      userId: params.createdBy || params.studentId,
      userEmail: studentRow.email,
      userRole: studentRow.role,
      action: 'INSTALLMENT_PLAN_CREATED',
      entity: 'InstallmentPlan',
      entityId: planId,
      details: `Échéancier ${countN}x créé pour ${studentRow.name} (${courseRow.title}) — Total : ${totalAmountDzd} DZD.`,
      ipAddress: params.ipAddress || '127.0.0.1',
      timestamp: nowIso,
    });

    return mapInstallmentPlanRow(
      insertedPlan,
      itemPayloads.map(mapInstallmentItemRow),
      {
        studentName: studentRow.name,
        studentEmail: studentRow.email,
        courseTitle: courseRow.title,
      }
    );
  });
}

export async function listInstallmentPlansScoped(options?: {
  studentId?: string;
}): Promise<InstallmentPlan[]> {
  const whereClause = options?.studentId
    ? eq(installmentPlans.studentId, options.studentId)
    : undefined;

  const [planRows, itemRows, userRows, courseRows] = await Promise.all([
    tdb.selectMany(installmentPlans, {
      where: whereClause,
      orderBy: desc(installmentPlans.createdAt),
    }),
    tdb.selectMany(installmentItems, {
      where: options?.studentId ? eq(installmentItems.studentId, options.studentId) : undefined,
      orderBy: asc(installmentItems.installmentNumber),
    }),
    tdb.selectMany(users),
    tdb.selectMany(courses),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const courseMap = new Map(courseRows.map((c) => [c.id, c]));
  const itemsByPlan = new Map<string, InstallmentItem[]>();

  for (const item of itemRows) {
    const arr = itemsByPlan.get(item.planId) || [];
    arr.push(mapInstallmentItemRow(item));
    itemsByPlan.set(item.planId, arr);
  }

  return planRows.map((p) => {
    const stu = userMap.get(p.studentId);
    const crs = courseMap.get(p.courseId);
    return mapInstallmentPlanRow(p, itemsByPlan.get(p.id) || [], {
      studentName: stu?.name,
      studentEmail: stu?.email,
      courseTitle: crs?.title,
    });
  });
}

// =============================================================================
// 5. CHARGILY PAY V2 CHECKOUT CREATION & WEBHOOK PROCESSING
// =============================================================================

export async function createChargilyCheckout(params: {
  studentId: string;
  courseId: string;
  cardMethod: ChargilyCardMethod;
  installmentItemId?: string;
  installmentsCount?: number;
  idempotencyKey?: string;
  locale?: 'fr' | 'ar';
  appOrigin?: string;
  ipAddress?: string;
}): Promise<{
  checkout: ChargilyCheckout;
  payment: Payment;
  installmentPlan?: InstallmentPlan;
  reusedIdempotent: boolean;
}> {
  const tenantId = getCurrentTenantId();
  const gatewayCfg = await getChargilyResolvedConfig(tenantId);

  if (!gatewayCfg.isEnabled) {
    throw new Error('CHARGILY_GATEWAY_DISABLED');
  }

  const [studentRow, courseRow, tenantRow] = await Promise.all([
    tdb.findFirst(users, eq(users.id, params.studentId)),
    tdb.findFirst(courses, eq(courses.id, params.courseId)),
    db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1).then((r) => r[0]),
  ]);

  if (!studentRow) {
    throw new Error('STUDENT_NOT_FOUND');
  }
  if (!courseRow) {
    throw new Error('COURSE_NOT_FOUND');
  }

  const cleanIdempotencyKey = params.idempotencyKey?.trim() || undefined;

  // 1. Idempotency check: prevent duplicate checkouts if client retries with same idempotencyKey
  if (cleanIdempotencyKey) {
    const existingCheckout = await tdb.findFirst(
      chargilyCheckouts,
      and(
        eq(chargilyCheckouts.studentId, params.studentId),
        eq(chargilyCheckouts.idempotencyKey, cleanIdempotencyKey)
      )
    );
    if (existingCheckout) {
      const existingPayment = await tdb.findFirst(
        payments,
        eq(payments.id, existingCheckout.paymentId)
      );
      if (existingPayment) {
        return {
          checkout: mapChargilyCheckoutRow(existingCheckout),
          payment: mapPaymentRow(existingPayment),
          reusedIdempotent: true,
        };
      }
    }
  }

  // 2. Resolve optional installment plan / installment item
  let createdOrLoadedPlan: InstallmentPlan | undefined;
  let targetInstallmentItem: typeof installmentItems.$inferSelect | undefined;

  if (params.installmentItemId) {
    targetInstallmentItem = await tdb.findFirst(
      installmentItems,
      eq(installmentItems.id, params.installmentItemId)
    );
    if (!targetInstallmentItem || targetInstallmentItem.studentId !== params.studentId) {
      throw new Error('INSTALLMENT_ITEM_NOT_FOUND');
    }
    if (targetInstallmentItem.status === 'PAID') {
      throw new Error('INSTALLMENT_ALREADY_PAID');
    }
    if (targetInstallmentItem.courseId !== params.courseId) {
      throw new Error('INSTALLMENT_COURSE_MISMATCH');
    }
  } else if (params.installmentsCount && params.installmentsCount >= 2) {
    createdOrLoadedPlan = await createInstallmentPlan({
      studentId: params.studentId,
      courseId: params.courseId,
      totalAmountDzd: courseRow.priceDzd,
      installmentsCount: params.installmentsCount,
      createdBy: params.studentId,
      ipAddress: params.ipAddress,
    });
    const nextUnpaid = createdOrLoadedPlan.items.find(
      (it) => it.status === 'PENDING' || it.status === 'OVERDUE'
    );
    if (!nextUnpaid) {
      throw new Error('INSTALLMENT_ALREADY_PAID');
    }
    targetInstallmentItem = await tdb.findFirst(
      installmentItems,
      eq(installmentItems.id, nextUnpaid.id)
    );
  }

  const amountDzd = targetInstallmentItem
    ? targetInstallmentItem.amountDzd
    : courseRow.priceDzd;

  // Also prevent duplicate concurrent PENDING checkout on the exact same installment item + cardMethod within 30 min
  if (targetInstallmentItem && !cleanIdempotencyKey) {
    const nowIsoCheck = new Date().toISOString();
    const pendingForSameItem = await tdb.findFirst(
      chargilyCheckouts,
      and(
        eq(chargilyCheckouts.studentId, params.studentId),
        eq(chargilyCheckouts.installmentItemId, targetInstallmentItem.id),
        eq(chargilyCheckouts.cardMethod, params.cardMethod),
        eq(chargilyCheckouts.status, 'PENDING')
      )
    );
    if (pendingForSameItem && pendingForSameItem.expiresAt > nowIsoCheck) {
      const existingPay = await tdb.findFirst(
        payments,
        eq(payments.id, pendingForSameItem.paymentId)
      );
      if (existingPay && existingPay.status === 'PENDING') {
        return {
          checkout: mapChargilyCheckoutRow(pendingForSameItem),
          payment: mapPaymentRow(existingPay),
          installmentPlan: createdOrLoadedPlan,
          reusedIdempotent: true,
        };
      }
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = nowIso.split('T')[0];
  const expiresAt = new Date(now.getTime() + 45 * 60 * 1000).toISOString();

  const mappedTenant = tenantRow ? mapTenantRow(tenantRow) : null;
  const receiptPrefix = mappedTenant?.settings.receiptPrefix || 'REC-NL';
  const receiptNumber = `${receiptPrefix}-${now.getFullYear()}-${String(
    Math.floor(10000 + Math.random() * 89999)
  )}`;
  const paymentId = `pay_${crypto.randomUUID()}`;
  const paymentMethod: PaymentMethod =
    params.cardMethod === 'cib' ? 'CHARGILY_CIB' : 'CHARGILY_EDAHABIA';

  const description = targetInstallmentItem
    ? `${courseRow.title} (Échéance ${targetInstallmentItem.installmentNumber}/${targetInstallmentItem.totalInstallments})`
    : courseRow.title;

  let checkoutId = `chk_${gatewayCfg.mode}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const originBase = (params.appOrigin || process.env.APP_URL || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );
  let checkoutUrl = `${originBase}/?chargily_checkout=${checkoutId}`;

  const metadata: Record<string, any> = {
    tenantId,
    paymentId,
    studentId: params.studentId,
    courseId: params.courseId,
    installmentItemId: targetInstallmentItem?.id || null,
    receiptNumber,
  };

  // Call live/test Chargily Pay V2 REST API when an external Chargily Secret Key is configured
  if (gatewayCfg.hasExternalChargilyKey) {
    const apiBase =
      gatewayCfg.mode === 'live'
        ? 'https://pay.chargily.net/api/v2/checkouts'
        : 'https://pay.chargily.net/test/api/v2/checkouts';

    const response = await fetch(apiBase, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gatewayCfg.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountDzd,
        currency: 'dzd',
        payment_method: params.cardMethod,
        locale: params.locale === 'ar' ? 'ar' : 'fr',
        description,
        success_url: `${originBase}/?payment_status=success&checkout_id=${checkoutId}`,
        failure_url: `${originBase}/?payment_status=failed&checkout_id=${checkoutId}`,
        webhook_endpoint: `${originBase}/api/webhooks/chargily`,
        metadata,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Chargily API Error');
      throw new Error(`CHARGILY_API_ERROR:${response.status}:${errText.slice(0, 200)}`);
    }

    const remoteData = (await response.json()) as {
      id?: string;
      checkout_url?: string;
    };
    if (remoteData.id) checkoutId = remoteData.id;
    if (remoteData.checkout_url) checkoutUrl = remoteData.checkout_url;
  }

  metadata.checkoutId = checkoutId;

  const result = await db.transaction(async (tx) => {
    const txDb = tdb.forTx(tx);

    const insertedPayment = await txDb.insertOne(payments, {
      id: paymentId,
      receiptNumber,
      studentId: params.studentId,
      courseId: params.courseId,
      subscriptionId: null,
      installmentItemId: targetInstallmentItem?.id ?? null,
      chargilyCheckoutId: checkoutId,
      idempotencyKey: cleanIdempotencyKey ?? null,
      amountDzd,
      currency: 'DZD',
      paymentMethod,
      transactionReference: `CHG-${params.cardMethod.toUpperCase()}-${checkoutId.slice(-10).toUpperCase()}`,
      paymentDate: todayStr,
      status: 'PENDING',
      failureReason: null,
      receiptAttachment: null,
      confirmedBy: null,
      confirmedAt: null,
      refundedAmountDzd: 0,
      refundReason: null,
      refundedBy: null,
      refundedAt: null,
      administrativeNotes: `Session de paiement en ligne Chargily Pay V2 (${params.cardMethod.toUpperCase()}) initialisée.`,
      createdAt: nowIso,
    });

    const insertedCheckout = await txDb.insertOne(chargilyCheckouts, {
      id: checkoutId,
      paymentId: insertedPayment.id,
      studentId: params.studentId,
      courseId: params.courseId,
      installmentItemId: targetInstallmentItem?.id ?? null,
      amountDzd,
      currency: 'dzd',
      cardMethod: params.cardMethod,
      mode: gatewayCfg.mode,
      status: 'PENDING',
      checkoutUrl,
      idempotencyKey: cleanIdempotencyKey ?? null,
      failureReason: null,
      metadata,
      paidAt: null,
      failedAt: null,
      refundedAt: null,
      expiresAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await txDb.insertOne(auditLogs, {
      id: `log_${crypto.randomUUID()}`,
      userId: params.studentId,
      userEmail: studentRow.email,
      userRole: studentRow.role,
      action: 'CHARGILY_CHECKOUT_CREATED',
      entity: 'ChargilyCheckout',
      entityId: checkoutId,
      details: `Checkout Chargily Pay (${params.cardMethod.toUpperCase()}) créé : ${amountDzd} DZD pour "${description}".`,
      ipAddress: params.ipAddress || '127.0.0.1',
      timestamp: nowIso,
    });

    return {
      checkout: mapChargilyCheckoutRow(insertedCheckout),
      payment: mapPaymentRow(insertedPayment),
    };
  });

  return {
    ...result,
    installmentPlan: createdOrLoadedPlan,
    reusedIdempotent: false,
  };
}

export interface WebhookProcessResult {
  statusCode: number;
  received: boolean;
  duplicate?: boolean;
  error?: string;
  message: string;
  eventType?: string;
  checkoutId?: string;
  payment?: Payment;
  invoice?: Invoice | null;
}

/**
 * Processes an incoming Chargily Pay V2 Webhook:
 * 1. Resolves checkout & tenant
 * 2. Verifies HMAC-SHA256 signature on exact rawBody bytes
 * 3. Guarantees event idempotency (prevents duplicate activations/invoices)
 * 4. Handles checkout.paid, checkout.failed, checkout.canceled, checkout.expired, checkout.refunded
 */
export async function processChargilyWebhook(params: {
  rawBody: Buffer;
  signatureHeader?: string;
  parsedBody: Record<string, any>;
  tenantSlugHint?: string;
  ipAddress?: string;
}): Promise<WebhookProcessResult> {
  const payload = params.parsedBody || {};
  const eventId = typeof payload.id === 'string' ? payload.id.trim() : '';
  const eventType = typeof payload.type === 'string' ? payload.type.trim() : '';
  const dataObj = (payload.data && typeof payload.data === 'object' ? payload.data : {}) as Record<
    string,
    any
  >;
  const metadataObj = (
    dataObj.metadata && typeof dataObj.metadata === 'object' ? dataObj.metadata : {}
  ) as Record<string, any>;

  const checkoutId =
    (typeof dataObj.id === 'string' && dataObj.id.trim()) ||
    (typeof metadataObj.checkoutId === 'string' && metadataObj.checkoutId.trim()) ||
    '';

  if (!eventId || !eventType || !checkoutId) {
    return {
      statusCode: 400,
      received: false,
      error: 'INVALID_WEBHOOK_PAYLOAD',
      message: 'Enveloppe webhook Chargily Pay incomplète (id, type ou data.id manquant).',
    };
  }

  // Locate checkout across tenants to establish exact tenant context
  const [checkoutRow] = await db
    .select()
    .from(chargilyCheckouts)
    .where(eq(chargilyCheckouts.id, checkoutId))
    .limit(1);

  let resolvedTenantId = checkoutRow?.tenantId || '';
  if (!resolvedTenantId && typeof metadataObj.tenantId === 'string') {
    resolvedTenantId = metadataObj.tenantId.trim();
  }
  if (!resolvedTenantId && params.tenantSlugHint) {
    const [tRow] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, params.tenantSlugHint.trim().toLowerCase()))
      .limit(1);
    if (tRow) resolvedTenantId = tRow.id;
  }
  if (!resolvedTenantId) {
    resolvedTenantId = DEFAULT_TENANT_ID;
  }

  // Verify HMAC-SHA256 signature against tenant's webhook secret
  const gatewayCfg = await getChargilyResolvedConfig(resolvedTenantId);
  const isSigValid = verifyChargilySignature(
    params.rawBody,
    params.signatureHeader,
    gatewayCfg.webhookSecret
  );

  if (!isSigValid) {
    await runWithTenantContext({ tenantId: resolvedTenantId }, async () => {
      await tdb.insertOne(auditLogs, {
        id: `log_${crypto.randomUUID()}`,
        userId: 'system_webhook',
        userEmail: 'webhook@chargily.dz',
        userRole: 'ADMIN',
        action: 'SECURITY_WEBHOOK_SIGNATURE_REJECTED',
        entity: 'ChargilyWebhook',
        entityId: checkoutId,
        details: `Signature HMAC-SHA256 invalide rejetée sur le webhook Chargily (${eventType}, event=${eventId}).`,
        ipAddress: params.ipAddress || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });
    }).catch(() => {});

    return {
      statusCode: 401,
      received: false,
      error: 'INVALID_WEBHOOK_SIGNATURE',
      message: 'Signature HMAC-SHA256 du webhook Chargily absente ou invalide.',
    };
  }

  if (!checkoutRow) {
    return {
      statusCode: 404,
      received: false,
      error: 'CHECKOUT_NOT_FOUND',
      message: `Session Chargily Checkout (${checkoutId}) introuvable.`,
    };
  }

  const payloadHash = crypto.createHash('sha256').update(params.rawBody).digest('hex');
  const nowIso = new Date().toISOString();

  // Execute all state mutations strictly inside the target tenant's isolated context
  return await runWithTenantContext({ tenantId: checkoutRow.tenantId }, async () => {
    // 1. Check duplicate eventId (Idempotency)
    const [existingEvent] = await db
      .select()
      .from(paymentWebhookEvents)
      .where(eq(paymentWebhookEvents.eventId, eventId))
      .limit(1);

    if (existingEvent) {
      const currentPay = await tdb.findFirst(payments, eq(payments.id, checkoutRow.paymentId));
      const currentInv = await tdb.findFirst(
        invoices,
        eq(invoices.paymentId, checkoutRow.paymentId)
      );
      return {
        statusCode: 200,
        received: true,
        duplicate: true,
        eventType,
        checkoutId,
        payment: currentPay ? mapPaymentRow(currentPay) : undefined,
        invoice: currentInv ? mapInvoiceRow(currentInv) : null,
        message: 'Événement webhook déjà traité (idempotence garantie).',
      };
    }

    const paymentRow = await tdb.findFirst(payments, eq(payments.id, checkoutRow.paymentId));
    if (!paymentRow) {
      return {
        statusCode: 404,
        received: false,
        error: 'PAYMENT_NOT_FOUND',
        message: 'Paiement associé au checkout introuvable.',
      };
    }

    // 2. Handle `checkout.paid`
    if (eventType === 'checkout.paid') {
      // Secondary duplicate guard: if payment was already CONFIRMED by an earlier webhook with a different eventId
      if (paymentRow.status === 'CONFIRMED' || paymentRow.status === 'REFUNDED') {
        await tdb.insertOne(paymentWebhookEvents, {
          id: `wh_${crypto.randomUUID()}`,
          provider: 'CHARGILY_PAY',
          eventId,
          eventType,
          checkoutId,
          paymentId: paymentRow.id,
          signatureValid: true,
          payloadHash,
          processingStatus: 'DUPLICATE_IGNORED',
          rawPayload: payload,
          processedAt: nowIso,
        });

        const existingInv = await tdb.findFirst(invoices, eq(invoices.paymentId, paymentRow.id));
        return {
          statusCode: 200,
          received: true,
          duplicate: true,
          eventType,
          checkoutId,
          payment: mapPaymentRow(paymentRow),
          invoice: existingInv ? mapInvoiceRow(existingInv) : null,
          message: 'Paiement déjà confirmé — doublon ignoré sans réactivation ni double facture.',
        };
      }

      // Resolve an admin user of this tenant for audit trail attribution
      const tenantAdmin = await tdb.findFirst(users, eq(users.role, 'ADMIN'));
      const confirmerId = tenantAdmin?.id || paymentRow.studentId;

      await tdb.updateWhere(
        chargilyCheckouts,
        {
          status: 'PAID',
          paidAt: nowIso,
          failureReason: null,
          updatedAt: nowIso,
        },
        eq(chargilyCheckouts.id, checkoutRow.id)
      );

      const confirmedPayment = await confirmPaymentTransaction(
        paymentRow.id,
        confirmerId,
        `Confirmé automatiquement par Webhook Chargily Pay V2 (${checkoutRow.cardMethod.toUpperCase()} — ${eventId})`,
        { ipAddress: params.ipAddress || '127.0.0.1' }
      );

      await tdb.insertOne(paymentWebhookEvents, {
        id: `wh_${crypto.randomUUID()}`,
        provider: 'CHARGILY_PAY',
        eventId,
        eventType,
        checkoutId,
        paymentId: paymentRow.id,
        signatureValid: true,
        payloadHash,
        processingStatus: 'PROCESSED',
        rawPayload: payload,
        processedAt: nowIso,
      });

      const generatedInvoice = await tdb.findFirst(
        invoices,
        eq(invoices.paymentId, paymentRow.id)
      );

      return {
        statusCode: 200,
        received: true,
        duplicate: false,
        eventType,
        checkoutId,
        payment: confirmedPayment,
        invoice: generatedInvoice ? mapInvoiceRow(generatedInvoice) : null,
        message: 'Paiement Chargily confirmé, abonnement activé et facture séquentielle émise.',
      };
    }

    // 3. Handle Failures / Cancellations / Expirations
    if (
      eventType === 'checkout.failed' ||
      eventType === 'checkout.canceled' ||
      eventType === 'checkout.expired'
    ) {
      // Never downgrade an already CONFIRMED or REFUNDED payment
      if (paymentRow.status === 'CONFIRMED' || paymentRow.status === 'REFUNDED') {
        await tdb.insertOne(paymentWebhookEvents, {
          id: `wh_${crypto.randomUUID()}`,
          provider: 'CHARGILY_PAY',
          eventId,
          eventType,
          checkoutId,
          paymentId: paymentRow.id,
          signatureValid: true,
          payloadHash,
          processingStatus: 'DUPLICATE_IGNORED',
          rawPayload: payload,
          processedAt: nowIso,
        });
        return {
          statusCode: 200,
          received: true,
          duplicate: true,
          eventType,
          checkoutId,
          payment: mapPaymentRow(paymentRow),
          message: 'Paiement déjà confirmé — événement d échec tardif ignoré.',
        };
      }

      const mappedCheckoutStatus: ChargilyCheckoutStatus =
        eventType === 'checkout.canceled'
          ? 'CANCELED'
          : eventType === 'checkout.expired'
            ? 'EXPIRED'
            : 'FAILED';

      const reason =
        (typeof dataObj.failure_reason === 'string' && dataObj.failure_reason.trim()) ||
        (eventType === 'checkout.canceled'
          ? 'Transaction annulée par le porteur de carte.'
          : eventType === 'checkout.expired'
            ? 'Session de paiement expirée.'
            : 'Transaction refusée par le réseau monétique CIB / Edahabia (provision ou authentification 3DS).');

      const [updatedPay] = await db.transaction(async (tx) => {
        const txDb = tdb.forTx(tx);

        await txDb.updateWhere(
          chargilyCheckouts,
          {
            status: mappedCheckoutStatus,
            failedAt: nowIso,
            failureReason: reason,
            updatedAt: nowIso,
          },
          eq(chargilyCheckouts.id, checkoutRow.id)
        );

        const updatedPayments = await txDb.updateWhere(
          payments,
          {
            status: 'FAILED',
            failureReason: reason,
            administrativeNotes: `Échec Chargily Pay (${eventType}) : ${reason}`,
          },
          eq(payments.id, paymentRow.id)
        );

        await txDb.insertOne(notifications, {
          id: `notif_${crypto.randomUUID()}`,
          userId: paymentRow.studentId,
          title: 'Échec du paiement en ligne CIB / Edahabia',
          message: `Votre tentative de règlement de ${paymentRow.amountDzd} DZD n'a pas abouti (${reason}). Vous pouvez réessayer en ligne ou régler par CCP / BaridiMob.`,
          type: 'ALERT',
          link: '/student/subscriptions',
          read: false,
          createdAt: nowIso,
        });

        await txDb.insertOne(auditLogs, {
          id: `log_${crypto.randomUUID()}`,
          userId: paymentRow.studentId,
          userEmail: 'webhook@chargily.dz',
          userRole: 'STUDENT',
          action: 'PAYMENT_FAILED',
          entity: 'Payment',
          entityId: paymentRow.id,
          details: `Échec paiement Chargily ${paymentRow.receiptNumber} (${eventType}) : ${reason}`,
          ipAddress: params.ipAddress || '127.0.0.1',
          timestamp: nowIso,
        });

        await txDb.insertOne(paymentWebhookEvents, {
          id: `wh_${crypto.randomUUID()}`,
          provider: 'CHARGILY_PAY',
          eventId,
          eventType,
          checkoutId,
          paymentId: paymentRow.id,
          signatureValid: true,
          payloadHash,
          processingStatus: 'PROCESSED',
          rawPayload: payload,
          processedAt: nowIso,
        });

        return updatedPayments;
      });

      return {
        statusCode: 200,
        received: true,
        duplicate: false,
        eventType,
        checkoutId,
        payment: mapPaymentRow(updatedPay || paymentRow),
        invoice: null,
        message: `Échec de paiement enregistré (${mappedCheckoutStatus}).`,
      };
    }

    // 4. Handle `checkout.refunded`
    if (eventType === 'checkout.refunded') {
      if (paymentRow.status === 'REFUNDED') {
        await tdb.insertOne(paymentWebhookEvents, {
          id: `wh_${crypto.randomUUID()}`,
          provider: 'CHARGILY_PAY',
          eventId,
          eventType,
          checkoutId,
          paymentId: paymentRow.id,
          signatureValid: true,
          payloadHash,
          processingStatus: 'DUPLICATE_IGNORED',
          rawPayload: payload,
          processedAt: nowIso,
        });
        const inv = await tdb.findFirst(invoices, eq(invoices.paymentId, paymentRow.id));
        return {
          statusCode: 200,
          received: true,
          duplicate: true,
          eventType,
          checkoutId,
          payment: mapPaymentRow(paymentRow),
          invoice: inv ? mapInvoiceRow(inv) : null,
          message: 'Remboursement déjà enregistré (idempotent).',
        };
      }

      const tenantAdmin = await tdb.findFirst(users, eq(users.role, 'ADMIN'));
      const refundAmount =
        typeof dataObj.refunded_amount === 'number' && dataObj.refunded_amount > 0
          ? Math.min(paymentRow.amountDzd, Math.trunc(dataObj.refunded_amount))
          : paymentRow.amountDzd;

      const refundReason =
        (typeof dataObj.refund_reason === 'string' && dataObj.refund_reason.trim()) ||
        'Remboursement confirmé via Webhook Chargily Pay V2';

      const refundedResult = await refundPaymentTransaction({
        paymentId: paymentRow.id,
        adminUserId: tenantAdmin?.id || paymentRow.studentId,
        reason: refundReason,
        amountDzd: refundAmount,
        ipAddress: params.ipAddress || '127.0.0.1',
      });

      await tdb.insertOne(paymentWebhookEvents, {
        id: `wh_${crypto.randomUUID()}`,
        provider: 'CHARGILY_PAY',
        eventId,
        eventType,
        checkoutId,
        paymentId: paymentRow.id,
        signatureValid: true,
        payloadHash,
        processingStatus: 'PROCESSED',
        rawPayload: payload,
        processedAt: nowIso,
      });

      return {
        statusCode: 200,
        received: true,
        duplicate: false,
        eventType,
        checkoutId,
        payment: refundedResult.payment,
        invoice: refundedResult.invoice,
        message: 'Remboursement Chargily Pay traité avec succès.',
      };
    }

    return {
      statusCode: 200,
      received: true,
      duplicate: false,
      eventType,
      checkoutId,
      message: `Événement ${eventType} acquitté sans changement d'état.`,
    };
  });
}

/**
 * Sandbox Simulator (Test Mode Only): builds a genuine Chargily V2 webhook payload,
 * signs its raw bytes with the tenant's HMAC-SHA256 secret, and dispatches it through `processChargilyWebhook`.
 */
export async function simulateChargilySandboxEvent(params: {
  checkoutId: string;
  outcome: 'paid' | 'failed' | 'canceled' | 'expired';
  eventIdOverride?: string;
  failureReason?: string;
  requestedByUserId: string;
  requestedByRole: string;
  ipAddress?: string;
}): Promise<WebhookProcessResult> {
  const checkoutRow = await tdb.findFirst(
    chargilyCheckouts,
    eq(chargilyCheckouts.id, params.checkoutId)
  );
  if (!checkoutRow) {
    throw new Error('CHECKOUT_NOT_FOUND');
  }
  if (checkoutRow.mode !== 'test') {
    throw new Error('SANDBOX_ONLY_IN_TEST_MODE');
  }
  if (
    params.requestedByRole === 'STUDENT' &&
    checkoutRow.studentId !== params.requestedByUserId
  ) {
    throw new Error('FORBIDDEN_RESOURCE_OWNERSHIP');
  }

  const eventType = `checkout.${params.outcome}`;
  const eventPayload = {
    id: params.eventIdOverride || `evt_sandbox_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
    entity: 'event',
    livemode: false,
    type: eventType,
    data: {
      id: checkoutRow.id,
      entity: 'checkout',
      amount: checkoutRow.amountDzd,
      currency: 'dzd',
      payment_method: checkoutRow.cardMethod,
      status: params.outcome,
      failure_reason: params.failureReason || undefined,
      metadata: checkoutRow.metadata,
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const rawBody = Buffer.from(JSON.stringify(eventPayload), 'utf8');
  const gatewayCfg = await getChargilyResolvedConfig(checkoutRow.tenantId);
  const signature = computeChargilySignature(rawBody, gatewayCfg.webhookSecret);

  return processChargilyWebhook({
    rawBody,
    signatureHeader: signature,
    parsedBody: eventPayload,
    ipAddress: params.ipAddress,
  });
}

// =============================================================================
// 6. REFUND TRANSACTION (FULL & PARTIAL + CREDIT NOTE + SUBSCRIPTION SUSPENSION)
// =============================================================================

export async function refundPaymentTransaction(params: {
  paymentId: string;
  adminUserId: string;
  reason: string;
  amountDzd?: number;
  ipAddress?: string;
}): Promise<{ payment: Payment; invoice: Invoice | null }> {
  const paymentRow = await tdb.findFirst(payments, eq(payments.id, params.paymentId));
  if (!paymentRow) {
    throw new Error('PAYMENT_NOT_FOUND');
  }
  if (paymentRow.status === 'REFUNDED') {
    throw new Error('PAYMENT_ALREADY_REFUNDED');
  }
  if (paymentRow.status !== 'CONFIRMED') {
    throw new Error('PAYMENT_NOT_CONFIRMED');
  }

  const refundAmountDzd =
    typeof params.amountDzd === 'number'
      ? Math.trunc(params.amountDzd)
      : paymentRow.amountDzd;

  if (refundAmountDzd <= 0 || refundAmountDzd > paymentRow.amountDzd) {
    throw new Error('INVALID_REFUND_AMOUNT');
  }

  const isFullRefund = refundAmountDzd >= paymentRow.amountDzd;
  const nowIso = new Date().toISOString();

  return await db.transaction(async (tx) => {
    const txDb = tdb.forTx(tx);
    const adminRow = await txDb.findFirst(users, eq(users.id, params.adminUserId));

    const [updatedPay] = await txDb.updateWhere(
      payments,
      {
        status: 'REFUNDED',
        refundedAmountDzd: refundAmountDzd,
        refundReason: params.reason,
        refundedBy: adminRow ? params.adminUserId : null,
        refundedAt: nowIso,
        administrativeNotes: `${paymentRow.administrativeNotes ? `${paymentRow.administrativeNotes} | ` : ''}Remboursé (${refundAmountDzd} DZD) : ${params.reason}`,
      },
      eq(payments.id, paymentRow.id)
    );

    if (paymentRow.chargilyCheckoutId) {
      await txDb.updateWhere(
        chargilyCheckouts,
        {
          status: 'REFUNDED',
          refundedAt: nowIso,
          updatedAt: nowIso,
        },
        eq(chargilyCheckouts.id, paymentRow.chargilyCheckoutId)
      );
    }

    // Suspend linked subscription on full refund
    if (isFullRefund && paymentRow.subscriptionId) {
      await txDb.updateWhere(
        subscriptions,
        {
          status: 'SUSPENDED',
          notes: `Abonnement suspendu automatiquement suite au remboursement du paiement ${paymentRow.receiptNumber} (${params.reason}).`,
        },
        eq(subscriptions.id, paymentRow.subscriptionId)
      );
    }

    // Update linked installment item & plan totals if applicable
    if (paymentRow.installmentItemId) {
      const itemRow = await txDb.findFirst(
        installmentItems,
        eq(installmentItems.id, paymentRow.installmentItemId)
      );
      if (itemRow) {
        await txDb.updateWhere(
          installmentItems,
          {
            status: 'REFUNDED',
            updatedAt: nowIso,
          },
          eq(installmentItems.id, itemRow.id)
        );

        const allItems = await txDb.selectMany(installmentItems, {
          where: eq(installmentItems.planId, itemRow.planId),
        });
        const remainingPaid = allItems.reduce(
          (sum, it) => sum + (it.id !== itemRow.id && it.status === 'PAID' ? it.amountDzd : 0),
          0
        );
        await txDb.updateWhere(
          installmentPlans,
          {
            paidAmountDzd: remainingPaid,
            status: 'ACTIVE',
            updatedAt: nowIso,
          },
          eq(installmentPlans.id, itemRow.planId)
        );
      }
    }

    // Issue sequential credit note marker on the linked fiscal invoice
    let updatedInvoice: Invoice | null = null;
    const invRow = await txDb.findFirst(invoices, eq(invoices.paymentId, paymentRow.id));
    if (invRow) {
      const creditNoteNumber = `AVO-${invRow.invoiceNumber.replace(/^FAC-/, '')}`;
      const [newInvRow] = await txDb.updateWhere(
        invoices,
        {
          status: 'REFUNDED',
          creditNoteNumber,
          refundedAt: nowIso,
          refundReason: `${params.reason} (${refundAmountDzd} DZD)`,
        },
        eq(invoices.id, invRow.id)
      );
      if (newInvRow) {
        updatedInvoice = mapInvoiceRow(newInvRow);
      }
    }

    await txDb.insertOne(notifications, {
      id: `notif_${crypto.randomUUID()}`,
      userId: paymentRow.studentId,
      title: 'Remboursement effectué',
      message: `Un remboursement de ${refundAmountDzd} DZD a été enregistré sur votre paiement ${paymentRow.receiptNumber} (${params.reason}).${updatedInvoice?.creditNoteNumber ? ` Avoir N° ${updatedInvoice.creditNoteNumber}.` : ''}`,
      type: 'WARNING',
      link: '/student/subscriptions',
      read: false,
      createdAt: nowIso,
    });

    await txDb.insertOne(auditLogs, {
      id: `log_${crypto.randomUUID()}`,
      userId: params.adminUserId,
      userEmail: adminRow?.email || 'admin@najahlearn.dz',
      userRole: adminRow?.role || 'ADMIN',
      action: 'PAYMENT_REFUNDED',
      entity: 'Payment',
      entityId: paymentRow.id,
      details: `Remboursement de ${refundAmountDzd} DZD sur ${paymentRow.receiptNumber}. Motif : ${params.reason}.${updatedInvoice?.creditNoteNumber ? ` Avoir : ${updatedInvoice.creditNoteNumber}.` : ''}`,
      ipAddress: params.ipAddress || '127.0.0.1',
      timestamp: nowIso,
    });

    return {
      payment: mapPaymentRow(updatedPay || paymentRow),
      invoice: updatedInvoice,
    };
  });
}

// =============================================================================
// 7. AUTOMATED INSTALLMENT REMINDERS ENGINE (ANTI-SPAM DEDUPLICATED)
// =============================================================================

function diffDaysBetweenDates(targetYmd: string, referenceYmd: string): number {
  const t = new Date(`${targetYmd}T00:00:00.000Z`).getTime();
  const r = new Date(`${referenceYmd}T00:00:00.000Z`).getTime();
  return Math.round((t - r) / 86_400_000);
}

/**
 * Evaluates upcoming and overdue installments for the current tenant (or all active tenants),
 * transitions past-due items to OVERDUE, and sends deduplicated in-app notifications + reminder audit records.
 */
export async function runAutomatedPaymentRemindersForTenant(options?: {
  triggeredBy?: string;
  referenceDateYmd?: string;
  forceIgnoreTenantToggle?: boolean;
}): Promise<{
  evaluatedItems: number;
  markedOverdueCount: number;
  remindersSentCount: number;
  reminders: PaymentReminder[];
}> {
  const tenantId = getCurrentTenantId();
  const [tenantRow] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenantRow || tenantRow.status !== 'ACTIVE') {
    return { evaluatedItems: 0, markedOverdueCount: 0, remindersSentCount: 0, reminders: [] };
  }

  const tenant = mapTenantRow(tenantRow);
  if (tenant.settings.autoRemindersEnabled === false && !options?.forceIgnoreTenantToggle) {
    return { evaluatedItems: 0, markedOverdueCount: 0, remindersSentCount: 0, reminders: [] };
  }

  const daysBeforeDue = Number(tenant.settings.reminderDaysBeforeDue ?? 3);
  const daysAfterOverdue = Number(tenant.settings.reminderDaysAfterOverdue ?? 1);
  const finalDaysAfterOverdue = Number(tenant.settings.reminderFinalDaysAfterOverdue ?? 7);

  const nowIso = new Date().toISOString();
  const todayYmd =
    options?.referenceDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(options.referenceDateYmd)
      ? options.referenceDateYmd
      : nowIso.split('T')[0];

  const candidateItems = await tdb.selectMany(installmentItems, {
    where: inArray(installmentItems.status, ['PENDING', 'OVERDUE']),
    orderBy: asc(installmentItems.dueDate),
  });

  if (candidateItems.length === 0) {
    return { evaluatedItems: 0, markedOverdueCount: 0, remindersSentCount: 0, reminders: [] };
  }

  const [existingReminders, userRows, courseRows] = await Promise.all([
    tdb.selectMany(paymentReminders),
    tdb.selectMany(users),
    tdb.selectMany(courses),
  ]);

  const sentSet = new Set(
    existingReminders.map((r) => `${r.installmentItemId}::${r.reminderType}`)
  );
  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const courseMap = new Map(courseRows.map((c) => [c.id, c]));

  let markedOverdueCount = 0;
  const createdReminders: PaymentReminder[] = [];
  const overduePlanIds = new Set<string>();

  for (const item of candidateItems) {
    // diffDays > 0 => upcoming; diffDays === 0 => due today; diffDays < 0 => overdue
    const diffDays = diffDaysBetweenDates(item.dueDate, todayYmd);

    if (diffDays < 0 && item.status === 'PENDING') {
      await tdb.updateWhere(
        installmentItems,
        { status: 'OVERDUE', updatedAt: nowIso },
        eq(installmentItems.id, item.id)
      );
      markedOverdueCount++;
      overduePlanIds.add(item.planId);
    } else if (diffDays < 0 && item.status === 'OVERDUE') {
      overduePlanIds.add(item.planId);
    }

    let reminderType: PaymentReminderType | null = null;
    if (diffDays <= -finalDaysAfterOverdue) {
      reminderType = 'OVERDUE_FINAL';
    } else if (diffDays <= -daysAfterOverdue) {
      reminderType = 'OVERDUE_REMINDER';
    } else if (diffDays < 0) {
      // Past due by < daysAfterOverdue threshold (if threshold > 1)
      reminderType = 'OVERDUE_REMINDER';
    } else if (diffDays === 0) {
      reminderType = 'DUE_TODAY';
    } else if (diffDays > 0 && diffDays <= daysBeforeDue) {
      reminderType = 'UPCOMING_DUE';
    }

    if (!reminderType) continue;
    const dedupKey = `${item.id}::${reminderType}`;
    if (sentSet.has(dedupKey)) continue;

    const student = userMap.get(item.studentId);
    const course = courseMap.get(item.courseId);
    const courseLabel = course?.title || 'votre formation';

    let subject = '';
    let message = '';
    let notifType: 'INFO' | 'WARNING' | 'ALERT' = 'INFO';

    if (reminderType === 'UPCOMING_DUE') {
      subject = `Échéance ${item.installmentNumber}/${item.totalInstallments} à venir (${item.dueDate})`;
      message = `Rappel : votre échéance ${item.installmentNumber}/${item.totalInstallments} de ${item.amountDzd} DZD pour "${courseLabel}" arrive à échéance le ${item.dueDate}. Réglez en ligne par CIB / Edahabia ou par CCP / BaridiMob.`;
      notifType = 'INFO';
    } else if (reminderType === 'DUE_TODAY') {
      subject = `Échéance ${item.installmentNumber}/${item.totalInstallments} exigible aujourd'hui`;
      message = `Votre échéance ${item.installmentNumber}/${item.totalInstallments} de ${item.amountDzd} DZD pour "${courseLabel}" est exigible ce jour (${item.dueDate}).`;
      notifType = 'WARNING';
    } else if (reminderType === 'OVERDUE_REMINDER') {
      subject = `Retard de paiement — Échéance ${item.installmentNumber}/${item.totalInstallments}`;
      message = `Relance : votre échéance ${item.installmentNumber}/${item.totalInstallments} de ${item.amountDzd} DZD pour "${courseLabel}" (prévue le ${item.dueDate}) est en retard de ${Math.abs(diffDays)} jour(s). Merci de régulariser votre situation.`;
      notifType = 'WARNING';
    } else {
      subject = `Dernier avis avant suspension — Échéance ${item.installmentNumber}/${item.totalInstallments}`;
      message = `Relance finale : votre échéance ${item.installmentNumber}/${item.totalInstallments} de ${item.amountDzd} DZD pour "${courseLabel}" accuse un retard de ${Math.abs(diffDays)} jours (échéance ${item.dueDate}). Sans régularisation rapide, votre abonnement sera suspendu.`;
      notifType = 'ALERT';
    }

    const insertedRem = await tdb.insertOne(paymentReminders, {
      id: `rem_${crypto.randomUUID()}`,
      studentId: item.studentId,
      planId: item.planId,
      installmentItemId: item.id,
      reminderType,
      channel: 'IN_APP_EMAIL',
      amountDzd: item.amountDzd,
      dueDate: item.dueDate,
      subject,
      message,
      triggeredBy: options?.triggeredBy || 'AUTO_SCHEDULER',
      sentAt: nowIso,
    });

    await tdb.updateWhere(
      installmentItems,
      {
        reminderCount: item.reminderCount + 1,
        lastReminderType: reminderType,
        lastReminderAt: nowIso,
        updatedAt: nowIso,
      },
      eq(installmentItems.id, item.id)
    );

    const studentPrefs = await getUserNotificationPreferences(item.studentId);
    if (checkChannelPreference(studentPrefs, 'BILLING_REMINDER', 'inApp')) {
      await tdb.insertOne(notifications, {
        id: `notif_${crypto.randomUUID()}`,
        userId: item.studentId,
        category: 'BILLING_REMINDER',
        title: subject,
        message,
        type: notifType,
        link: '/student/subscriptions',
        read: false,
        readAt: null,
        createdAt: nowIso,
      });
    }

    sentSet.add(dedupKey);
    createdReminders.push(mapPaymentReminderRow(insertedRem, student?.name));
  }

  for (const planId of overduePlanIds) {
    await tdb.updateWhere(
      installmentPlans,
      { status: 'OVERDUE', updatedAt: nowIso },
      and(eq(installmentPlans.id, planId), eq(installmentPlans.status, 'ACTIVE'))!
    );
  }

  return {
    evaluatedItems: candidateItems.length,
    markedOverdueCount,
    remindersSentCount: createdReminders.length,
    reminders: createdReminders,
  };
}

export async function runAutomatedRemindersAcrossAllTenants(): Promise<void> {
  const activeTenants = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.status, 'ACTIVE'));

  for (const t of activeTenants) {
    await runWithTenantContext({ tenantId: t.id }, () =>
      runAutomatedPaymentRemindersForTenant({ triggeredBy: 'AUTO_SCHEDULER' })
    ).catch((err) => {
      console.warn(`[NajahLearn Reminders] Sweep warning for tenant ${t.id}:`, err);
    });
  }
}

export async function listPaymentRemindersScoped(options?: {
  studentId?: string;
}): Promise<PaymentReminder[]> {
  const [remRows, userRows] = await Promise.all([
    tdb.selectMany(paymentReminders, {
      where: options?.studentId ? eq(paymentReminders.studentId, options.studentId) : undefined,
      orderBy: desc(paymentReminders.sentAt),
    }),
    tdb.selectMany(users),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  return remRows.map((r) => mapPaymentReminderRow(r, userMap.get(r.studentId)?.name));
}

// =============================================================================
// 8. INVOICES QUERIES & SEED BACKFILL
// =============================================================================

export async function listInvoicesScoped(options?: {
  studentId?: string;
}): Promise<Invoice[]> {
  const rows = await tdb.selectMany(invoices, {
    where: options?.studentId ? eq(invoices.studentId, options.studentId) : undefined,
    orderBy: desc(invoices.sequenceNumber),
  });
  return rows.map(mapInvoiceRow);
}

export async function getInvoiceByIdScoped(invoiceId: string): Promise<Invoice | null> {
  const row = await tdb.findFirst(invoices, eq(invoices.id, invoiceId));
  return row ? mapInvoiceRow(row) : null;
}

/**
 * Ensures any pre-existing confirmed seed payments have sequential invoices issued.
 */
export async function backfillInvoicesForConfirmedPayments(): Promise<void> {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  for (const t of allTenants) {
    await runWithTenantContext({ tenantId: t.id }, async () => {
      const confirmedPays = await tdb.selectMany(payments, {
        where: eq(payments.status, 'CONFIRMED'),
        orderBy: asc(payments.createdAt),
      });
      for (const p of confirmedPays) {
        const existingInv = await tdb.findFirst(invoices, eq(invoices.paymentId, p.id));
        if (!existingInv) {
          await db.transaction(async (tx) => {
            await issueSequentialInvoiceInTx(tx, p);
          });
        }
      }
    });
  }
}
