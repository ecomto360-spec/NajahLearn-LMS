/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction, CookieOptions } from 'express';
import crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { users, activeSessions, auditLogs, authRateLimits } from '../src/db/schema.ts';
import { mapUserRow, mapActiveSessionRow } from './db.ts';
import { adminAuth } from '../src/lib/firebase-admin.ts';
import { getOrCreateUser } from '../src/db/users.ts';
import {
  getCurrentTenantId,
  getTenantById,
  checkTenantOperationalAccess,
  runWithTenantContext,
} from './tenantContext.ts';
import type { User, UserRole, ActiveSession, Tenant } from '../src/types/index.ts';

export interface AuthenticatedRequest extends Request {
  user?: User;
  tenant?: Tenant;
  tenantId?: string;
  sessionToken?: string;
  csrfToken?: string;
  sessionRecord?: ActiveSession;
  authTransport?: 'COOKIE' | 'BEARER';
}

// =============================================================================
// SECURITY CONSTANTS (COOKIES, SESSION EXPIRATION, ROTATION & RATE LIMITING)
// =============================================================================
export const SESSION_COOKIE_NAME = 'najahlearn_session';
export const CSRF_COOKIE_NAME = 'najahlearn_csrf';
export const PREAUTH_CSRF_COOKIE_NAME = 'najahlearn_csrf_init';

export const SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours inactivity timeout
export const SESSION_ABSOLUTE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours absolute maximum lifetime
export const SESSION_ROTATION_INTERVAL_MS = 15 * 60 * 1000; // Automatic token rotation every 15 min

export const MAX_ACCOUNT_LOGIN_ATTEMPTS = 5;
export const MAX_IP_LOGIN_ATTEMPTS = 12;
export const MAX_RESET_IP_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15-minute observation window
export const RATE_LIMIT_LOCKOUT_MS = 15 * 60 * 1000; // 15-minute lockout duration

const CSRF_HMAC_SECRET =
  process.env.CSRF_SECRET ||
  process.env.JWT_SECRET ||
  'najahlearn_institutional_csrf_hmac_key_2026';

export function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

export function hashTokenSha256(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// =============================================================================
// COOKIE & CSRF MANAGEMENT (HttpOnly + Secure + SameSite=Strict)
// =============================================================================

export function buildCookieOptions(
  req: Request,
  httpOnly: boolean,
  maxAgeMs?: number
): CookieOptions {
  const isDevPreviewIframe =
    process.env.NODE_ENV !== 'production' && req.headers['x-aistudio-iframe'] === '1';

  const base: CookieOptions = isDevPreviewIframe
    ? {
        httpOnly,
        secure: true,
        sameSite: 'none',
        partitioned: true,
        path: '/',
      }
    : {
        httpOnly,
        secure: true,
        sameSite: 'strict',
        path: '/',
      };

  if (typeof maxAgeMs === 'number') {
    base.maxAge = Math.max(0, maxAgeMs);
  }
  return base;
}

export function setSessionCookies(
  req: Request,
  res: Response,
  sessionToken: string,
  csrfToken: string,
  expiresAtIso: string
): void {
  const remainingMs = Math.max(60_000, new Date(expiresAtIso).getTime() - Date.now());
  res.cookie(SESSION_COOKIE_NAME, sessionToken, buildCookieOptions(req, true, remainingMs));
  res.cookie(CSRF_COOKIE_NAME, csrfToken, buildCookieOptions(req, false, remainingMs));
  res.setHeader('X-CSRF-Token', csrfToken);
}

export function clearSessionCookies(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, buildCookieOptions(req, true));
  res.clearCookie(CSRF_COOKIE_NAME, buildCookieOptions(req, false));
}

export function issuePreAuthCsrfToken(req: Request, res: Response): string {
  const nonce = crypto.randomBytes(24).toString('hex');
  const sig = crypto.createHmac('sha256', CSRF_HMAC_SECRET).update(nonce).digest('hex');
  const csrfToken = `precsrf_${nonce}.${sig}`;
  res.cookie(PREAUTH_CSRF_COOKIE_NAME, csrfToken, buildCookieOptions(req, true, 3600_000));
  res.setHeader('X-CSRF-Token', csrfToken);
  return csrfToken;
}

export function verifySessionCsrfHeader(req: Request, expectedCsrfToken?: string): boolean {
  if (!expectedCsrfToken) return false;
  const headerVal = req.headers['x-csrf-token'];
  if (typeof headerVal !== 'string' || !headerVal.trim()) {
    return false;
  }
  return constantTimeEquals(headerVal.trim(), expectedCsrfToken);
}

// =============================================================================
// PERSISTENT POSTGRESQL RATE LIMITING (BY ACCOUNT & BY IP)
// =============================================================================

async function checkSingleRateLimitBucket(key: string): Promise<{
  isLocked: boolean;
  remainingLockoutSeconds: number;
}> {
  const [row] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key)).limit(1);
  if (!row || !row.lockedUntil) {
    return { isLocked: false, remainingLockoutSeconds: 0 };
  }

  const lockedUntilMs = new Date(row.lockedUntil).getTime();
  const nowMs = Date.now();
  if (nowMs < lockedUntilMs) {
    return {
      isLocked: true,
      remainingLockoutSeconds: Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000)),
    };
  }

  // Lockout expired — reset bucket in PostgreSQL
  await db.delete(authRateLimits).where(eq(authRateLimits.key, key));
  return { isLocked: false, remainingLockoutSeconds: 0 };
}

async function incrementRateLimitBucketTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    key: string;
    scope: 'ACCOUNT' | 'IP' | 'RESET_IP';
    identifier: string;
    maxAttempts: number;
    tenantId?: string;
    windowMs?: number;
    lockoutMs?: number;
  }
): Promise<{ locked: boolean; attempts: number; remainingLockoutSeconds: number }> {
  const windowMs = params.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const lockoutMs = params.lockoutMs ?? RATE_LIMIT_LOCKOUT_MS;
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const [existing] = await tx
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, params.key))
    .limit(1);

  if (!existing) {
    const locked = 1 >= params.maxAttempts;
    const lockedUntil = locked ? new Date(nowMs + lockoutMs).toISOString() : null;
    await tx.insert(authRateLimits).values({
      key: params.key,
      tenantId: params.tenantId || getCurrentTenantId(),
      scope: params.scope,
      identifier: params.identifier,
      attempts: 1,
      windowStartAt: nowIso,
      lastAttemptAt: nowIso,
      lockedUntil,
    });
    return {
      locked,
      attempts: 1,
      remainingLockoutSeconds: locked ? Math.ceil(lockoutMs / 1000) : 0,
    };
  }

  // Check if still locked
  if (existing.lockedUntil && new Date(existing.lockedUntil).getTime() > nowMs) {
    const remSec = Math.max(
      1,
      Math.ceil((new Date(existing.lockedUntil).getTime() - nowMs) / 1000)
    );
    return { locked: true, attempts: existing.attempts, remainingLockoutSeconds: remSec };
  }

  // Reset sliding window if expired
  const windowExpired = nowMs - new Date(existing.windowStartAt).getTime() > windowMs;
  const nextAttempts = windowExpired ? 1 : existing.attempts + 1;
  const nextWindowStart = windowExpired ? nowIso : existing.windowStartAt;
  const locked = nextAttempts >= params.maxAttempts;
  const lockedUntil = locked ? new Date(nowMs + lockoutMs).toISOString() : null;

  await tx
    .update(authRateLimits)
    .set({
      attempts: nextAttempts,
      windowStartAt: nextWindowStart,
      lastAttemptAt: nowIso,
      lockedUntil,
    })
    .where(eq(authRateLimits.key, params.key));

  return {
    locked,
    attempts: nextAttempts,
    remainingLockoutSeconds: locked ? Math.ceil(lockoutMs / 1000) : 0,
  };
}

/**
 * Checks persistent PostgreSQL rate limits for both IP address and target account email.
 */
export async function checkLoginRateLimit(
  email: string,
  ipAddress: string
): Promise<{
  isLocked: boolean;
  lockedBy?: 'IP' | 'ACCOUNT';
  remainingLockoutSeconds?: number;
}> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const [ipStatus, accountStatus] = await Promise.all([
      checkSingleRateLimitBucket(`ip:${ipAddress}`),
      checkSingleRateLimitBucket(`account:${normalizedEmail}`),
    ]);

    if (ipStatus.isLocked) {
      return {
        isLocked: true,
        lockedBy: 'IP',
        remainingLockoutSeconds: ipStatus.remainingLockoutSeconds,
      };
    }

    if (accountStatus.isLocked) {
      return {
        isLocked: true,
        lockedBy: 'ACCOUNT',
        remainingLockoutSeconds: accountStatus.remainingLockoutSeconds,
      };
    }

    return { isLocked: false };
  } catch (error) {
    console.error('checkLoginRateLimit failed:', error);
    throw new Error('Impossible de vérifier la limitation des tentatives.', { cause: error });
  }
}

/**
 * Persists a failed login attempt against both the target account and source IP in PostgreSQL.
 */
export async function recordLoginFailure(
  email: string,
  ipAddress: string
): Promise<{ accountLocked: boolean; ipLocked: boolean }> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    return await db.transaction(async (tx) => {
      const acctRes = await incrementRateLimitBucketTx(tx, {
        key: `account:${normalizedEmail}`,
        scope: 'ACCOUNT',
        identifier: normalizedEmail,
        maxAttempts: MAX_ACCOUNT_LOGIN_ATTEMPTS,
      });
      const ipRes = await incrementRateLimitBucketTx(tx, {
        key: `ip:${ipAddress}`,
        scope: 'IP',
        identifier: ipAddress,
        maxAttempts: MAX_IP_LOGIN_ATTEMPTS,
      });
      return { accountLocked: acctRes.locked, ipLocked: ipRes.locked };
    });
  } catch (error) {
    console.error('recordLoginFailure failed:', error);
    return { accountLocked: false, ipLocked: false };
  }
}

/**
 * Clears account-level failed attempts upon valid authentication (preserving IP-level anti-spray counters).
 */
export async function recordLoginSuccess(email: string): Promise<void> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    await db.delete(authRateLimits).where(eq(authRateLimits.key, `account:${normalizedEmail}`));
  } catch (error) {
    console.error('recordLoginSuccess failed:', error);
  }
}

/**
 * Persistent IP rate limiter for sensitive unauthenticated endpoints (e.g., forgot/reset password).
 */
export async function consumeIpEndpointRateLimit(
  ipAddress: string,
  maxAttempts: number = MAX_RESET_IP_ATTEMPTS
): Promise<{ allowed: boolean; remainingLockoutSeconds: number }> {
  try {
    const key = `reset_ip:${ipAddress}`;
    const check = await checkSingleRateLimitBucket(key);
    if (check.isLocked) {
      return { allowed: false, remainingLockoutSeconds: check.remainingLockoutSeconds };
    }
    const res = await db.transaction(async (tx) =>
      incrementRateLimitBucketTx(tx, {
        key,
        scope: 'RESET_IP',
        identifier: ipAddress,
        maxAttempts,
      })
    );
    // Allow up to maxAttempts requests; block once attempts > maxAttempts (or if already locked prior)
    if (res.attempts > maxAttempts) {
      return { allowed: false, remainingLockoutSeconds: res.remainingLockoutSeconds };
    }
    return { allowed: true, remainingLockoutSeconds: 0 };
  } catch (error) {
    console.error('consumeIpEndpointRateLimit failed:', error);
    return { allowed: true, remainingLockoutSeconds: 0 };
  }
}

// =============================================================================
// SESSION CREATION, EXPIRATION & ROTATION (ACID TRANSACTIONS)
// =============================================================================

/**
 * Creates a new PostgreSQL-persisted active session with idle + absolute expiration and CSRF token.
 * For STUDENT accounts: enforces single-session policy by revoking all prior active sessions.
 */
export async function createSession(
  user: User,
  req: Request
): Promise<{ token: string; csrfToken: string; session: ActiveSession }> {
  try {
    const token = `tok_${crypto.randomBytes(32).toString('hex')}`;
    const csrfToken = `csrf_${crypto.randomBytes(32).toString('hex')}`;
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + SESSION_IDLE_TTL_MS).toISOString();
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS).toISOString();

    const userAgent = req.headers['user-agent'] || 'Appareil Inconnu';
    const ipAddress = extractClientIp(req);

    let deviceName = 'Navigateur Web';
    if (/mobile/i.test(userAgent)) deviceName = 'Smartphone Mobile';
    else if (/tablet|ipad/i.test(userAgent)) deviceName = 'Tablette';
    else if (/macintosh|mac os x/i.test(userAgent)) deviceName = 'Ordinateur Mac';
    else if (/windows/i.test(userAgent)) deviceName = 'Ordinateur Windows';
    else if (/linux/i.test(userAgent)) deviceName = 'Ordinateur Linux';

    const userTenant = await getTenantById(user.tenantId);
    const enforceSingleSession = userTenant?.settings?.enforceSingleStudentSession ?? true;

    const insertedSession = await db.transaction(async (tx) => {
      if (user.role === 'STUDENT' && enforceSingleSession) {
        const existingActive = await tx
          .select()
          .from(activeSessions)
          .where(
            and(
              eq(activeSessions.tenantId, user.tenantId),
              eq(activeSessions.userId, user.id),
              isNull(activeSessions.revokedAt)
            )
          );

        for (const oldSession of existingActive) {
          await tx
            .update(activeSessions)
            .set({
              revokedAt: nowIso,
              revokedReason: 'NOUVELLE_CONNEXION_AUTRE_APPAREIL',
            })
            .where(eq(activeSessions.id, oldSession.id));

          await tx.insert(auditLogs).values({
            id: `log_${crypto.randomUUID()}`,
            tenantId: user.tenantId,
            userId: user.id,
            userEmail: user.email,
            userRole: user.role,
            action: 'SESSION_REVOKED_DUPLICATE_LOGIN',
            entity: 'ActiveSession',
            entityId: oldSession.id,
            details: `Révocation automatique de la session précédente (${oldSession.deviceName}) suite à une nouvelle connexion étudiante.`,
            ipAddress,
            timestamp: nowIso,
          });
        }
      }

      const [newRow] = await tx
        .insert(activeSessions)
        .values({
          id: `ses_${crypto.randomUUID()}`,
          tenantId: user.tenantId,
          userId: user.id,
          token,
          csrfToken,
          deviceName,
          ipAddress,
          userAgent,
          createdAt: nowIso,
          lastActiveAt: nowIso,
          rotatedAt: nowIso,
          expiresAt,
          absoluteExpiresAt,
          previousTokenHash: null,
        })
        .returning();

      await tx.insert(auditLogs).values({
        id: `log_${crypto.randomUUID()}`,
        tenantId: user.tenantId,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'USER_LOGIN',
        entity: 'User',
        entityId: user.id,
        details: `Connexion réussie depuis ${deviceName} (${ipAddress}).`,
        ipAddress,
        timestamp: nowIso,
      });

      return newRow;
    });

    return {
      token,
      csrfToken,
      session: mapActiveSessionRow(insertedSession),
    };
  } catch (error) {
    console.error('createSession failed:', error);
    throw new Error('Impossible d ouvrir la session sécurisée en base de données.', {
      cause: error,
    });
  }
}

/**
 * Rotates an active session's token and CSRF token atomically in PostgreSQL,
 * recording a SHA-256 digest of the previous token for replay/theft detection.
 */
export async function rotateSession(
  sessionId: string,
  req: Request,
  res: Response,
  options: { auditReason?: string } = {}
): Promise<{ token: string; csrfToken: string; session: ActiveSession }> {
  const newToken = `tok_${crypto.randomBytes(32).toString('hex')}`;
  const newCsrfToken = `csrf_${crypto.randomBytes(32).toString('hex')}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const ipAddress = extractClientIp(req);

  const updatedRow = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(activeSessions)
      .where(and(eq(activeSessions.id, sessionId), isNull(activeSessions.revokedAt)))
      .limit(1);

    if (!current) {
      throw new Error('Session introuvable ou déjà révoquée.');
    }

    const absLimitMs = current.absoluteExpiresAt
      ? new Date(current.absoluteExpiresAt).getTime()
      : now.getTime() + SESSION_ABSOLUTE_TTL_MS;

    const nextExpiresMs = Math.min(absLimitMs, now.getTime() + SESSION_IDLE_TTL_MS);
    const nextExpiresIso = new Date(nextExpiresMs).toISOString();
    const prevHash = hashTokenSha256(current.token);

    const [updated] = await tx
      .update(activeSessions)
      .set({
        token: newToken,
        csrfToken: newCsrfToken,
        previousTokenHash: prevHash,
        rotatedAt: nowIso,
        lastActiveAt: nowIso,
        expiresAt: nextExpiresIso,
        absoluteExpiresAt: current.absoluteExpiresAt || new Date(absLimitMs).toISOString(),
      })
      .where(eq(activeSessions.id, sessionId))
      .returning();

    if (options.auditReason) {
      const [uRow] = await tx
        .select()
        .from(users)
        .where(eq(users.id, current.userId))
        .limit(1);

      if (uRow) {
        await tx.insert(auditLogs).values({
          id: `log_${crypto.randomUUID()}`,
          tenantId: uRow.tenantId,
          userId: uRow.id,
          userEmail: uRow.email,
          userRole: uRow.role,
          action: 'SESSION_ROTATED',
          entity: 'ActiveSession',
          entityId: current.id,
          details: options.auditReason,
          ipAddress,
          timestamp: nowIso,
        });
      }
    }

    return updated;
  });

  setSessionCookies(req, res, newToken, newCsrfToken, updatedRow.expiresAt);
  return {
    token: newToken,
    csrfToken: newCsrfToken,
    session: mapActiveSessionRow(updatedRow),
  };
}

// =============================================================================
// AUTHENTICATION & CSRF ENFORCEMENT MIDDLEWARE
// =============================================================================

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  const authHeader = req.headers['authorization'];
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;

  const token = cookieToken || bearerToken;
  const transport: 'COOKIE' | 'BEARER' | undefined = cookieToken
    ? 'COOKIE'
    : bearerToken
      ? 'BEARER'
      : undefined;

  if (!token || !transport) {
    return res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'Veuillez vous connecter pour accéder à cette ressource.',
    });
  }

  try {
    // Path A: NajahLearn PostgreSQL session token (tok_...)
    if (token.startsWith('tok_')) {
      const [sessionRow] = await db
        .select()
        .from(activeSessions)
        .where(eq(activeSessions.token, token))
        .limit(1);

      if (!sessionRow) {
        // Check if this is a replay of an already-rotated token!
        const candidatePrevHash = hashTokenSha256(token);
        const [replayedSession] = await db
          .select()
          .from(activeSessions)
          .where(
            and(
              eq(activeSessions.previousTokenHash, candidatePrevHash),
              isNull(activeSessions.revokedAt)
            )
          )
          .limit(1);

        if (replayedSession) {
          const nowIso = new Date().toISOString();
          await db.transaction(async (tx) => {
            await tx
              .update(activeSessions)
              .set({
                revokedAt: nowIso,
                revokedReason: 'TOKEN_REUSE_AFTER_ROTATION',
              })
              .where(eq(activeSessions.id, replayedSession.id));

            await tx.insert(auditLogs).values({
              id: `log_${crypto.randomUUID()}`,
              tenantId: replayedSession.tenantId,
              userId: replayedSession.userId,
              userEmail: 'security@najahlearn.dz',
              userRole: 'STUDENT',
              action: 'SECURITY_TOKEN_REPLAY_BLOCKED',
              entity: 'ActiveSession',
              entityId: replayedSession.id,
              details:
                'Détection de réutilisation d un ancien jeton après rotation. Session immédiatement révoquée.',
              ipAddress: extractClientIp(req),
              timestamp: nowIso,
            });
          });

          clearSessionCookies(req, res);
          return res.status(401).json({
            error: 'SESSION_COMPROMISED_ROTATED',
            message:
              'Ancien jeton de session détecté après rotation. Par sécurité, la session a été révoquée.',
          });
        }

        if (transport === 'COOKIE') {
          clearSessionCookies(req, res);
        }
        return res
          .status(401)
          .json({ error: 'INVALID_TOKEN', message: 'Session invalide ou expirée.' });
      }

      if (sessionRow.revokedAt) {
        if (transport === 'COOKIE') {
          clearSessionCookies(req, res);
        }
        return res.status(401).json({
          error: 'SESSION_REVOKED',
          code: sessionRow.revokedReason || 'SESSION_REVOKED',
          message:
            'Votre session a été fermée car une nouvelle connexion a été établie sur un autre appareil, ou la session a été révoquée par sécurité.',
        });
      }

      const now = new Date();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();

      const idleExpired = new Date(sessionRow.expiresAt).getTime() <= nowMs;
      const absoluteExpired =
        Boolean(sessionRow.absoluteExpiresAt) &&
        new Date(sessionRow.absoluteExpiresAt).getTime() <= nowMs;

      if (idleExpired || absoluteExpired) {
        await db
          .update(activeSessions)
          .set({
            revokedAt: nowIso,
            revokedReason: absoluteExpired ? 'SESSION_ABSOLUTE_EXPIRED' : 'SESSION_EXPIRED',
          })
          .where(eq(activeSessions.id, sessionRow.id));

        if (transport === 'COOKIE') {
          clearSessionCookies(req, res);
        }

        return res.status(401).json({
          error: 'SESSION_EXPIRED',
          message: 'Votre session a expiré. Veuillez vous reconnecter.',
        });
      }

      // Enforce CSRF protection on all state-changing cookie-authenticated requests
      const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(
        req.method.toUpperCase()
      );
      if (transport === 'COOKIE' && isStateChanging) {
        if (!verifySessionCsrfHeader(req, sessionRow.csrfToken)) {
          return res.status(403).json({
            error: 'CSRF_TOKEN_INVALID',
            message: 'Jeton anti-CSRF manquant ou invalide. Requête bloquée par sécurité.',
          });
        }
      }

      const [userRow] = await db
        .select()
        .from(users)
        .where(eq(users.id, sessionRow.userId))
        .limit(1);

      if (!userRow || userRow.status !== 'ACTIVE') {
        if (transport === 'COOKIE') {
          clearSessionCookies(req, res);
        }
        return res.status(403).json({
          error: 'ACCOUNT_INACTIVE',
          message: 'Votre compte est inactif ou a été suspendu par l administration.',
        });
      }

      const mappedUser = mapUserRow(userRow);
      const headerTenantId =
        typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'].trim() : '';

      let effectiveTenantId = mappedUser.tenantId;
      if (mappedUser.role === 'SUPER_ADMIN') {
        if (headerTenantId) {
          const targetTenant = await getTenantById(headerTenantId);
          if (!targetTenant) {
            return res.status(404).json({
              error: 'TENANT_NOT_FOUND',
              message: 'Établissement cible introuvable.',
            });
          }
          effectiveTenantId = targetTenant.id;
        }
      } else if (headerTenantId && headerTenantId !== mappedUser.tenantId) {
        await db.insert(auditLogs).values({
          id: `log_${crypto.randomUUID()}`,
          tenantId: mappedUser.tenantId,
          userId: mappedUser.id,
          userEmail: mappedUser.email,
          userRole: mappedUser.role,
          action: 'SECURITY_CROSS_TENANT_BLOCKED',
          entity: 'Tenant',
          entityId: headerTenantId,
          details: `Tentative d accès inter-établissement bloquée : utilisateur rattaché à ${mappedUser.tenantId} a demandé ${headerTenantId}.`,
          ipAddress: extractClientIp(req),
          timestamp: nowIso,
        });
        return res.status(403).json({
          error: 'CROSS_TENANT_FORBIDDEN',
          message:
            'Isolation multi-tenant stricte : vous ne pouvez pas accéder aux ressources d un autre établissement.',
        });
      }

      const activeTenant = await getTenantById(effectiveTenantId);
      if (mappedUser.role !== 'SUPER_ADMIN') {
        const tenantCheck = checkTenantOperationalAccess(activeTenant);
        if (!tenantCheck.allowed) {
          if (transport === 'COOKIE') {
            clearSessionCookies(req, res);
          }
          return res.status(403).json({
            error: tenantCheck.errorCode || 'TENANT_SUSPENDED',
            message: tenantCheck.message || 'Établissement suspendu ou abonnement expiré.',
          });
        }
      }

      res.setHeader('X-Tenant-Id', effectiveTenantId);

      // Automatic periodic session rotation when rotation interval has elapsed
      const lastRotatedMs = sessionRow.rotatedAt
        ? new Date(sessionRow.rotatedAt).getTime()
        : new Date(sessionRow.createdAt).getTime();

      if (transport === 'COOKIE' && nowMs - lastRotatedMs >= SESSION_ROTATION_INTERVAL_MS) {
        const rotated = await rotateSession(sessionRow.id, req, res, {
          auditReason: 'Rotation périodique automatique du jeton de session.',
        });
        req.user = mappedUser;
        req.tenant = activeTenant || undefined;
        req.tenantId = effectiveTenantId;
        req.sessionToken = rotated.token;
        req.csrfToken = rotated.csrfToken;
        req.sessionRecord = rotated.session;
        req.authTransport = transport;
        return runWithTenantContext(
          {
            tenantId: effectiveTenantId,
            userId: mappedUser.id,
            userRole: mappedUser.role,
            isSuperAdmin: mappedUser.role === 'SUPER_ADMIN',
          },
          () => next()
        );
      }

      // Extend sliding idle expiration capped at absoluteExpiresAt
      const absCapMs = sessionRow.absoluteExpiresAt
        ? new Date(sessionRow.absoluteExpiresAt).getTime()
        : nowMs + SESSION_ABSOLUTE_TTL_MS;
      const extendedExpiresIso = new Date(
        Math.min(absCapMs, nowMs + SESSION_IDLE_TTL_MS)
      ).toISOString();

      await db
        .update(activeSessions)
        .set({
          lastActiveAt: nowIso,
          expiresAt: extendedExpiresIso,
        })
        .where(eq(activeSessions.id, sessionRow.id));

      req.user = mappedUser;
      req.tenant = activeTenant || undefined;
      req.tenantId = effectiveTenantId;
      req.sessionToken = token;
      req.csrfToken = sessionRow.csrfToken;
      req.sessionRecord = {
        ...mapActiveSessionRow(sessionRow),
        lastActiveAt: nowIso,
        expiresAt: extendedExpiresIso,
      };
      req.authTransport = transport;
      return runWithTenantContext(
        {
          tenantId: effectiveTenantId,
          userId: mappedUser.id,
          userRole: mappedUser.role,
          isSuperAdmin: mappedUser.role === 'SUPER_ADMIN',
        },
        () => next()
      );
    }

    // Path B: Firebase Authentication ID Token
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (!decodedToken.email) {
      return res.status(401).json({
        error: 'INVALID_FIREBASE_TOKEN',
        message: 'Le compte Google ne possède pas d adresse e-mail vérifiée.',
      });
    }

    const syncedRow = await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email,
      decodedToken.name,
      decodedToken.picture
    );

    if (syncedRow.status !== 'ACTIVE') {
      return res.status(403).json({
        error: 'ACCOUNT_INACTIVE',
        message: 'Votre compte est inactif ou a été suspendu par l administration.',
      });
    }

    const fbUser = mapUserRow(syncedRow);
    const fbTenant = await getTenantById(fbUser.tenantId);
    if (fbUser.role !== 'SUPER_ADMIN') {
      const tenantCheck = checkTenantOperationalAccess(fbTenant);
      if (!tenantCheck.allowed) {
        return res.status(403).json({
          error: tenantCheck.errorCode || 'TENANT_SUSPENDED',
          message: tenantCheck.message || 'Établissement suspendu ou abonnement expiré.',
        });
      }
    }

    res.setHeader('X-Tenant-Id', fbUser.tenantId);
    req.user = fbUser;
    req.tenant = fbTenant || undefined;
    req.tenantId = fbUser.tenantId;
    req.sessionToken = token;
    req.authTransport = transport;
    return runWithTenantContext(
      {
        tenantId: fbUser.tenantId,
        userId: fbUser.id,
        userRole: fbUser.role,
        isSuperAdmin: fbUser.role === 'SUPER_ADMIN',
      },
      () => next()
    );
  } catch (error) {
    console.error('Authentication verification failed:', error);
    return res
      .status(401)
      .json({ error: 'INVALID_TOKEN', message: 'Session invalide ou expirée.' });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: 'UNAUTHORIZED', message: 'Authentification requise.' });
    }

    const isSuperAdminInheritingAdmin =
      req.user.role === 'SUPER_ADMIN' && allowedRoles.includes('ADMIN');

    if (!allowedRoles.includes(req.user.role) && !isSuperAdminInheritingAdmin) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Accès refusé. Cette fonctionnalité est réservée aux rôles : ${allowedRoles.join(', ')}.`,
      });
    }

    next();
  };
}
