/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer, { MulterError } from 'multer';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { containsXssPayload, stripControlChars } from './validation.ts';

/**
 * Private upload storage directory located OUTSIDE `public/` and `dist/`.
 * Never exposed via `express.static` or Vite dev static serving.
 */
export const PRIVATE_UPLOADS_DIR = path.resolve(process.cwd(), 'data', 'private_uploads');

export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB strict ceiling

export const ALLOWED_MIME_TYPES: Record<
  string,
  {
    extension: string;
    verifyMagicBytes: (buf: Buffer) => boolean;
  }
> = {
  'application/pdf': {
    extension: '.pdf',
    verifyMagicBytes: (buf: Buffer) => {
      if (buf.length < 5) return false;
      // %PDF- (25 50 44 46 2D)
      return (
        buf[0] === 0x25 &&
        buf[1] === 0x50 &&
        buf[2] === 0x44 &&
        buf[3] === 0x46 &&
        buf[4] === 0x2d
      );
    },
  },
  'image/png': {
    extension: '.png',
    verifyMagicBytes: (buf: Buffer) => {
      if (buf.length < 8) return false;
      // 89 50 4E 47 0D 0A 1A 0A
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    },
  },
  'image/jpeg': {
    extension: '.jpg',
    verifyMagicBytes: (buf: Buffer) => {
      if (buf.length < 3) return false;
      // FF D8 FF
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    },
  },
  'image/webp': {
    extension: '.webp',
    verifyMagicBytes: (buf: Buffer) => {
      if (buf.length < 12) return false;
      // RIFF....WEBP
      return (
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
      );
    },
  },
};

export function ensurePrivateUploadsDir(): void {
  if (!fs.existsSync(PRIVATE_UPLOADS_DIR)) {
    fs.mkdirSync(PRIVATE_UPLOADS_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Inspects a PDF buffer for embedded active scripting/launch actions (`/JavaScript`, `/JS`, `/Launch`).
 */
export function containsDangerousPdfPayload(buf: Buffer): boolean {
  const sample = buf.toString('latin1');
  return /\/(?:JavaScript|JS|Launch|OpenAction\s*<<[^>]*\/JS)\b/i.test(sample);
}

/**
 * Sanitizes the user-facing display name (stripping path components, null bytes, XSS tags, and executable suffixes).
 * NOTE: This sanitized label is ONLY for metadata display — disk storage strictly uses a generated UUID filename!
 */
export function sanitizeDisplayFilename(rawName: string, canonicalExtension: string): string {
  const baseOnly = path.basename(stripControlChars(rawName || 'document', false));
  const cleaned = baseOnly
    .replace(/[<>:"/\\|?*'`$;]/g, '_')
    .replace(/\.(?:php|phtml|exe|sh|bat|cmd|js|mjs|cjs|html|htm|svg|jsp|asp|aspx)\b/gi, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);

  if (!cleaned || containsXssPayload(cleaned)) {
    return `document${canonicalExtension}`;
  }

  const withoutExt = cleaned.replace(/\.[a-zA-Z0-9]{1,8}$/, '') || 'document';
  return `${withoutExt}${canonicalExtension}`;
}

/**
 * Resolves a stored UUID filename safely inside `PRIVATE_UPLOADS_DIR`, blocking any path traversal.
 */
export function resolveSafePrivateFilePath(storedFilename: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|png|jpg|webp)$/.test(storedFilename)) {
    throw new Error('INVALID_STORED_FILENAME');
  }
  ensurePrivateUploadsDir();
  const resolved = path.resolve(PRIVATE_UPLOADS_DIR, storedFilename);
  if (!resolved.startsWith(PRIVATE_UPLOADS_DIR + path.sep)) {
    throw new Error('PATH_TRAVERSAL_BLOCKED');
  }
  return resolved;
}

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 4096,
  },
});

/**
 * Express middleware that parses a single `multipart/form-data` file into memory,
 * enforces size limits (`<= 5 MB`), allowlisted MIME types, binary magic-byte signatures,
 * and anti-script PDF inspection before any route handler runs.
 */
export function validateMultipartUpload(fieldName: string = 'file'): RequestHandler {
  const singleMiddleware = memoryUpload.single(fieldName);

  return (req: Request, res: Response, next: NextFunction) => {
    singleMiddleware(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: 'FILE_TOO_LARGE',
              maxSizeBytes: MAX_UPLOAD_SIZE_BYTES,
              message: 'Le fichier dépasse la taille maximale autorisée de 5 Mo.',
            });
          }
          return res.status(400).json({
            error: 'UPLOAD_MALFORMED',
            code: err.code,
            message: 'Requête de téléversement invalide (un seul fichier autorisé).',
          });
        }
        return res.status(400).json({
          error: 'UPLOAD_ERROR',
          message: 'Impossible de lire le fichier téléversé.',
        });
      }

      const file = req.file;
      if (!file || !file.buffer || file.size <= 0) {
        return res.status(400).json({
          error: 'MISSING_FILE',
          message: 'Aucun fichier valide fourni dans le champ "file".',
        });
      }

      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        return res.status(413).json({
          error: 'FILE_TOO_LARGE',
          maxSizeBytes: MAX_UPLOAD_SIZE_BYTES,
          message: 'Le fichier dépasse la taille maximale autorisée de 5 Mo.',
        });
      }

      const declaredMime = (file.mimetype || '').toLowerCase().trim();
      const spec = ALLOWED_MIME_TYPES[declaredMime];
      if (!spec) {
        return res.status(415).json({
          error: 'UNSUPPORTED_MEDIA_TYPE',
          allowedMimeTypes: Object.keys(ALLOWED_MIME_TYPES),
          message:
            'Type de fichier refusé. Seuls les formats PDF, PNG, JPEG et WEBP sont autorisés.',
        });
      }

      if (!spec.verifyMagicBytes(file.buffer)) {
        return res.status(400).json({
          error: 'INVALID_FILE_SIGNATURE',
          message:
            'La signature binaire réelle du fichier ne correspond pas au type MIME déclaré (usurpation détectée).',
        });
      }

      if (declaredMime === 'application/pdf' && containsDangerousPdfPayload(file.buffer)) {
        return res.status(400).json({
          error: 'DANGEROUS_PDF_CONTENT',
          message:
            'Le document PDF contient des actions actives ou scripts embarqués interdits par sécurité.',
        });
      }

      return next();
    });
  };
}

/**
 * Persists a validated upload buffer into `PRIVATE_UPLOADS_DIR` using a random UUID filename (`0o600`).
 */
export async function persistValidatedFileToPrivateStorage(file: Express.Multer.File): Promise<{
  storedFilename: string;
  sanitizedOriginalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  fullPath: string;
}> {
  const declaredMime = file.mimetype.toLowerCase().trim();
  const spec = ALLOWED_MIME_TYPES[declaredMime];
  if (!spec) {
    throw new Error('UNSUPPORTED_MEDIA_TYPE');
  }

  ensurePrivateUploadsDir();
  const storedFilename = `${crypto.randomUUID()}${spec.extension}`;
  const fullPath = resolveSafePrivateFilePath(storedFilename);
  const sha256Hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const sanitizedOriginalName = sanitizeDisplayFilename(file.originalname, spec.extension);

  await fs.promises.writeFile(fullPath, file.buffer, { mode: 0o600 });

  return {
    storedFilename,
    sanitizedOriginalName,
    mimeType: declaredMime,
    sizeBytes: file.size,
    sha256Hash,
    fullPath,
  };
}
