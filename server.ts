/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './server/routes.ts';
import { validateRequest } from './server/validation.ts';
import {
  backfillInvoicesForConfirmedPayments,
  runAutomatedRemindersAcrossAllTenants,
} from './server/billing.ts';
import { runEmailQueueAndSweepsAcrossAllTenants } from './server/emailService.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeOrigin(raw?: string): string | null {
  if (!raw || raw === 'MY_APP_URL') return null;
  try {
    const parsed = new URL(raw.trim());
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isOriginAllowed(origin: string, req: Request): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const allowed = new Set<string>();

  const appOrigin = normalizeOrigin(process.env.APP_URL);
  if (appOrigin) allowed.add(appOrigin);

  if (process.env.ALLOWED_ORIGINS) {
    for (const entry of process.env.ALLOWED_ORIGINS.split(',')) {
      const parsed = normalizeOrigin(entry);
      if (parsed) allowed.add(parsed);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:3000');
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:5173');
  }

  const host = req.get('host');
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }

  return allowed.has(normalized);
}

export function createApiApp() {
  const apiApp = express();
  apiApp.disable('x-powered-by');
  apiApp.set('trust proxy', 1);

  // 1. Helmet HTTP Security Headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, COOP, etc.)
  apiApp.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: [
            "'self'",
            'https://aistudio.google.com',
            'https://*.aistudio.google.com',
            'https://*.google.com',
          ],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://apis.google.com',
            'https://*.firebaseapp.com',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: [
            "'self'",
            'https://*.googleapis.com',
            'https://*.firebaseio.com',
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'wss:',
          ],
          frameSrc: [
            "'self'",
            'https://*.firebaseapp.com',
            'https://accounts.google.com',
            'https://meet.jit.si',
            'https://*.zoom.us',
          ],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      frameguard: false, // Delegated to CSP frame-ancestors
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // 2. Strict Allowlist CORS Enforcement
  apiApp.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');

    if (origin && !isOriginAllowed(origin, req)) {
      return res.status(403).json({
        error: 'CORS_ORIGIN_FORBIDDEN',
        message: 'Origine externe non autorisée par la politique de sécurité CORS.',
      });
    }

    return cors({
      origin: origin ? origin : false,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-CSRF-Token',
        'Authorization',
        'X-Aistudio-Iframe',
        'X-Tenant-Id',
        'signature',
        'X-Chargily-Signature',
      ],
      exposedHeaders: ['X-CSRF-Token', 'Retry-After', 'X-Tenant-Id'],
      maxAge: 600,
    })(req, res, next);
  });

  // 3. Block direct public access to server-side data, source & private_uploads folders (even in Vite dev)
  apiApp.use((req: Request, res: Response, next: NextFunction) => {
    let decodedPath = req.path || '';
    try {
      for (let i = 0; i < 2; i++) {
        const nextDecoded = decodeURIComponent(decodedPath);
        if (nextDecoded === decodedPath) break;
        decodedPath = nextDecoded;
      }
    } catch {
      return res.status(400).json({
        error: 'INVALID_URI',
        message: 'URI malformée ou encodage de caractères invalide.',
      });
    }

    const normalizedPath = decodedPath.replace(/\\/g, '/').toLowerCase();
    if (
      normalizedPath.includes('..') ||
      normalizedPath === '/data' ||
      normalizedPath.startsWith('/data/') ||
      normalizedPath === '/private_uploads' ||
      normalizedPath.startsWith('/private_uploads/') ||
      normalizedPath.includes('private_uploads') ||
      normalizedPath === '/server' ||
      normalizedPath.startsWith('/server/') ||
      normalizedPath === '/scripts' ||
      normalizedPath.startsWith('/scripts/') ||
      normalizedPath.startsWith('/.env')
    ) {
      return res.status(403).json({
        error: 'PRIVATE_STORAGE_FORBIDDEN',
        message: 'Accès direct au stockage privé interdit.',
      });
    }
    return next();
  });

  // 4. Cookie Parser & JSON Body Parser (capturing exact rawBody bytes for Chargily HMAC-SHA256 webhooks)
  apiApp.use(cookieParser());
  apiApp.use(
    express.json({
      limit: '2mb',
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    })
  );
  apiApp.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in (err as any)) {
      return res.status(400).json({
        error: 'INVALID_JSON',
        message: 'Corps de requête JSON malformé.',
      });
    }
    return next(err);
  });

  // Healthcheck endpoint (strictly validated with Zod)
  apiApp.get('/api/health', validateRequest(), (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), timezone: 'Africa/Algiers' });
  });

  // Mount REST API (PostgreSQL connections are established lazily on demand via pg.Pool)
  apiApp.use('/api', apiRouter);
  return apiApp;
}

export const app = createApiApp();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        fs: {
          deny: ['**/data/**', '**/private_uploads/**', '**/server/**', '**/scripts/**', '**/.env*'],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[NajahLearn LMS] Serveur de développement initialisé avec middlewares Vite.');
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
    console.log('[NajahLearn LMS] Serveur de production initialisé avec assets compilés.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NajahLearn LMS] Plateforme active et disponible sur le port ${PORT}`);
    // Backfill sequential invoices on initial confirmed seed payments & launch automated billing + SMTP sweeps
    backfillInvoicesForConfirmedPayments()
      .then(() => runAutomatedRemindersAcrossAllTenants())
      .then(() => runEmailQueueAndSweepsAcrossAllTenants())
      .catch((err) => console.warn('[NajahLearn Workers] Initialisation factures/relances/emails:', err));

    const reminderTimer = setInterval(() => {
      runAutomatedRemindersAcrossAllTenants().catch(() => {});
    }, 15 * 60 * 1000);
    if (typeof reminderTimer.unref === 'function') {
      reminderTimer.unref();
    }

    const emailQueueTimer = setInterval(() => {
      runEmailQueueAndSweepsAcrossAllTenants().catch(() => {});
    }, 60 * 1000);
    if (typeof emailQueueTimer.unref === 'function') {
      emailQueueTimer.unref();
    }
  });
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution && process.env.SKIP_SERVER_LISTEN !== 'true') {
  startServer().catch((err) => {
    console.error('[NajahLearn LMS] Erreur critique au démarrage du serveur:', err);
    process.exit(1);
  });
}
