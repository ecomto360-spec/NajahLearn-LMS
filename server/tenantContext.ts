/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { eq, and, count, type SQL } from 'drizzle-orm';
import type { PgTableWithColumns } from 'drizzle-orm/pg-core';
import { db } from '../src/db/index.ts';
import {
  DEFAULT_TENANT_ID,
  tenants,
  tenantSubscriptions,
  type TenantSettingsJson,
} from '../src/db/schema.ts';
export { DEFAULT_TENANT_ID };
import type {
  Tenant,
  TenantPublicSummary,
  TenantSubscription,
  TenantPlanCode,
  TenantSubscriptionStatus,
  TenantStatus,
  PaymentMethod,
  UserRole,
} from '../src/types/index.ts';

export interface TenantExecutionContext {
  tenantId: string;
  userId?: string;
  userRole?: UserRole;
  isSuperAdmin?: boolean;
}

const tenantStorage = new AsyncLocalStorage<TenantExecutionContext>();

/**
 * Executes an asynchronous or synchronous callback within an isolated TenantExecutionContext.
 * Every `tdb.*` query and repository helper inside `fn` automatically scopes to `ctx.tenantId`.
 */
export function runWithTenantContext<T>(ctx: TenantExecutionContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}

export function getTenantContext(): TenantExecutionContext | undefined {
  return tenantStorage.getStore();
}

/**
 * Returns the active `tenantId` from AsyncLocalStorage, defaulting to `DEFAULT_TENANT_ID`
 * (`'tnt_najahlearn'`) when invoked outside an HTTP request (e.g., direct unit tests).
 */
export function getCurrentTenantId(): string {
  return tenantStorage.getStore()?.tenantId || DEFAULT_TENANT_ID;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettingsJson = {
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
};

export function mapTenantRow(row: typeof tenants.$inferSelect): Tenant {
  const mergedSettings: TenantSettingsJson = {
    ...DEFAULT_TENANT_SETTINGS,
    ...((row.settings as Partial<TenantSettingsJson>) || {}),
  };

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.shortName,
    tagline: row.tagline,
    logoUrl: row.logoUrl ?? undefined,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    accentColor: row.accentColor,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    address: row.address,
    city: row.city,
    wilaya: row.wilaya,
    country: row.country,
    website: row.website ?? undefined,
    accreditationNumber: row.accreditationNumber ?? undefined,
    taxId: row.taxId ?? undefined,
    nif: row.nif ?? undefined,
    nis: row.nis ?? undefined,
    rc: row.rc ?? undefined,
    articleImposition: row.articleImposition ?? undefined,
    tvaApplicable: Boolean(row.tvaApplicable),
    tvaRatePercent: Number(row.tvaRatePercent ?? 0),
    invoicePrefix: row.invoicePrefix || 'FAC-NL',
    invoiceNextSequence: Number(row.invoiceNextSequence ?? 1),
    invoiceFooterNote: row.invoiceFooterNote ?? undefined,
    settings: mergedSettings,
    subscriptionPlan: row.subscriptionPlan as TenantPlanCode,
    subscriptionStatus: row.subscriptionStatus as TenantSubscriptionStatus,
    subscriptionStartDate: row.subscriptionStartDate,
    subscriptionEndDate: row.subscriptionEndDate,
    monthlyFeeDzd: row.monthlyFeeDzd,
    billingNotes: row.billingNotes ?? undefined,
    status: row.status as TenantStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTenantPublicSummary(tenant: Tenant): TenantPublicSummary {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    shortName: tenant.shortName,
    tagline: tenant.tagline,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
    accentColor: tenant.accentColor,
    contactEmail: tenant.contactEmail,
    contactPhone: tenant.contactPhone,
    address: tenant.address,
    city: tenant.city,
    wilaya: tenant.wilaya,
    country: tenant.country,
    website: tenant.website,
    accreditationNumber: tenant.accreditationNumber,
    nif: tenant.nif,
    nis: tenant.nis,
    rc: tenant.rc,
    articleImposition: tenant.articleImposition,
    tvaApplicable: tenant.tvaApplicable,
    tvaRatePercent: tenant.tvaRatePercent,
    invoicePrefix: tenant.invoicePrefix,
    supportHours: tenant.settings.supportHours,
    currency: tenant.settings.currency,
    allowInstallments: tenant.settings.allowInstallments !== false,
    status: tenant.status,
    subscriptionStatus: tenant.subscriptionStatus,
  };
}

export function mapTenantSubscriptionRow(
  row: typeof tenantSubscriptions.$inferSelect
): TenantSubscription {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planCode: row.planCode as TenantPlanCode,
    billingCycle: row.billingCycle as 'MONTHLY' | 'ANNUAL',
    status: row.status as TenantSubscriptionStatus,
    amountDzd: row.amountDzd,
    maxStudents: row.maxStudents,
    maxTeachers: row.maxTeachers,
    startDate: row.startDate,
    endDate: row.endDate,
    invoiceNumber: row.invoiceNumber,
    paymentMethod: row.paymentMethod as PaymentMethod,
    notes: row.notes ?? undefined,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return row ? mapTenantRow(row) : null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const [row] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug.trim().toLowerCase()))
    .limit(1);
  return row ? mapTenantRow(row) : null;
}

export async function getCurrentTenant(): Promise<Tenant | null> {
  return getTenantById(getCurrentTenantId());
}

/**
 * Verifies whether an establishment (`Tenant`) is operational and holds an active SaaS subscription.
 */
export function checkTenantOperationalAccess(tenant: Tenant | null): {
  allowed: boolean;
  errorCode?: 'TENANT_NOT_FOUND' | 'TENANT_SUSPENDED' | 'TENANT_SUBSCRIPTION_INACTIVE';
  message?: string;
} {
  if (!tenant) {
    return {
      allowed: false,
      errorCode: 'TENANT_NOT_FOUND',
      message: 'Établissement introuvable.',
    };
  }

  if (tenant.status !== 'ACTIVE') {
    return {
      allowed: false,
      errorCode: 'TENANT_SUSPENDED',
      message: `L'établissement "${tenant.name}" est actuellement ${tenant.status === 'SUSPENDED' ? 'suspendu' : 'archivé'} par la direction SaaS.`,
    };
  }

  const todayStr = new Date().toISOString().split('T')[0];
  if (
    tenant.subscriptionStatus === 'SUSPENDED' ||
    tenant.subscriptionStatus === 'EXPIRED' ||
    tenant.subscriptionEndDate < todayStr
  ) {
    return {
      allowed: false,
      errorCode: 'TENANT_SUBSCRIPTION_INACTIVE',
      message: `L'abonnement plateforme de l'établissement "${tenant.name}" est ${tenant.subscriptionStatus === 'SUSPENDED' ? 'suspendu' : 'arrivé à échéance'} (${tenant.subscriptionEndDate}). Veuillez contacter l'administrateur SaaS.`,
    };
  }

  return { allowed: true };
}

// =============================================================================
// AUTOMATIC TENANT-SCOPED DRIZZLE REPOSITORY WRAPPER (`tdb`)
// =============================================================================

type AnyTenantTable = PgTableWithColumns<any> & {
  tenantId: any;
};

/**
 * Builds a SQL `WHERE` predicate that ALWAYS enforces `table.tenant_id = getCurrentTenantId()`.
 */
export function scopedWhere<TTable extends AnyTenantTable>(
  table: TTable,
  extraCondition?: SQL
): SQL {
  const tenantCond = eq(table.tenantId, getCurrentTenantId());
  return extraCondition ? (and(tenantCond, extraCondition) as SQL) : tenantCond;
}

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function createTenantScopedDb(executor: DbExecutor) {
  return {
    get tenantId(): string {
      return getCurrentTenantId();
    },

    where<TTable extends AnyTenantTable>(table: TTable, extraCondition?: SQL): SQL {
      return scopedWhere(table, extraCondition);
    },

    async selectMany<TTable extends AnyTenantTable>(
      table: TTable,
      options?: {
        where?: SQL;
        orderBy?: SQL | SQL[];
        limit?: number;
      }
    ): Promise<Array<TTable['$inferSelect']>> {
      let query: any = executor
        .select()
        .from(table as any)
        .where(scopedWhere(table, options?.where));

      if (options?.orderBy) {
        const orderClauses = Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy];
        query = query.orderBy(...orderClauses);
      }
      if (typeof options?.limit === 'number') {
        query = query.limit(options.limit);
      }
      return await query;
    },

    async findFirst<TTable extends AnyTenantTable>(
      table: TTable,
      whereCondition?: SQL
    ): Promise<TTable['$inferSelect'] | undefined> {
      const rows = await executor
        .select()
        .from(table as any)
        .where(scopedWhere(table, whereCondition))
        .limit(1);
      return rows[0] as TTable['$inferSelect'] | undefined;
    },

    async count<TTable extends AnyTenantTable>(
      table: TTable,
      whereCondition?: SQL
    ): Promise<number> {
      const [res] = await executor
        .select({ value: count() })
        .from(table as any)
        .where(scopedWhere(table, whereCondition));
      return Number(res?.value ?? 0);
    },

    async insertOne<TTable extends AnyTenantTable>(
      table: TTable,
      values: Omit<TTable['$inferInsert'], 'tenantId'> & { tenantId?: string }
    ): Promise<TTable['$inferSelect']> {
      const scopedPayload = {
        ...values,
        tenantId: getCurrentTenantId(),
      };
      const [inserted] = (await executor
        .insert(table as any)
        .values(scopedPayload as any)
        .returning()) as Array<TTable['$inferSelect']>;
      return inserted;
    },

    async updateWhere<TTable extends AnyTenantTable>(
      table: TTable,
      setValues: Partial<Omit<TTable['$inferInsert'], 'tenantId'>>,
      whereCondition: SQL
    ): Promise<Array<TTable['$inferSelect']>> {
      const sanitizedSet = { ...(setValues as Record<string, unknown>) };
      delete sanitizedSet.tenantId;

      const updated = (await executor
        .update(table as any)
        .set(sanitizedSet as any)
        .where(scopedWhere(table, whereCondition))
        .returning()) as Array<TTable['$inferSelect']>;
      return updated;
    },

    async deleteWhere<TTable extends AnyTenantTable>(
      table: TTable,
      whereCondition: SQL
    ): Promise<Array<TTable['$inferSelect']>> {
      const deleted = (await executor
        .delete(table as any)
        .where(scopedWhere(table, whereCondition))
        .returning()) as Array<TTable['$inferSelect']>;
      return deleted;
    },
  };
}

export const tdb = {
  ...createTenantScopedDb(db),
  forTx(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
    return createTenantScopedDb(tx);
  },
};

/**
 * Express middleware for public unauthenticated endpoints (e.g., `/api/courses`).
 * Resolves the requested establishment from `X-Tenant-Id`, `?tenantId=`, or `?tenantSlug=`
 * (defaulting to `DEFAULT_TENANT_ID`) and runs downstream handlers inside `runWithTenantContext`.
 */
export async function resolvePublicTenantContext(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const headerTenantId =
      typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'].trim() : '';
    const queryObj = (req.query || {}) as Record<string, unknown>;
    const queryTenantId = typeof queryObj.tenantId === 'string' ? queryObj.tenantId.trim() : '';
    const queryTenantSlug =
      typeof queryObj.tenantSlug === 'string' ? queryObj.tenantSlug.trim().toLowerCase() : '';

    let resolvedTenant: Tenant | null = null;

    if (headerTenantId) {
      resolvedTenant = await getTenantById(headerTenantId);
      if (!resolvedTenant) {
        return res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: 'Établissement spécifié dans X-Tenant-Id introuvable.',
        });
      }
    } else if (queryTenantId) {
      resolvedTenant = await getTenantById(queryTenantId);
      if (!resolvedTenant) {
        return res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: 'Établissement demandé introuvable.',
        });
      }
    } else if (queryTenantSlug) {
      resolvedTenant = await getTenantBySlug(queryTenantSlug);
      if (!resolvedTenant) {
        return res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: 'Établissement demandé introuvable.',
        });
      }
    } else {
      resolvedTenant = await getTenantById(DEFAULT_TENANT_ID);
    }

    const effectiveTenantId = resolvedTenant?.id || DEFAULT_TENANT_ID;
    res.setHeader('X-Tenant-Id', effectiveTenantId);

    return runWithTenantContext({ tenantId: effectiveTenantId }, () => next());
  } catch (error) {
    console.error('resolvePublicTenantContext error:', error);
    return res.status(500).json({
      error: 'TENANT_RESOLUTION_ERROR',
      message: 'Impossible de résoudre le contexte de l établissement.',
    });
  }
}
