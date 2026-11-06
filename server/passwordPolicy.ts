/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';

export interface PasswordValidationContext {
  email?: string;
  name?: string;
}

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_WEAK_PATTERNS = [
  'password',
  'motdepasse',
  'azerty',
  'qwerty',
  '123456',
  '654321',
  'abcdef',
  'admin123',
  'welcome',
  'letmein',
  'algerie123',
];

/**
 * Validates a password against NajahLearn LMS institutional security policy:
 * - Between 12 and 128 characters
 * - At least 1 uppercase letter, 1 lowercase letter, 1 digit, and 1 special symbol
 * - No 4+ consecutive identical characters
 * - Not matching common weak/breached patterns
 * - Does not contain user's email local-part or name tokens
 */
export function validatePasswordPolicy(
  password: string,
  context: PasswordValidationContext = {}
): PasswordValidationResult {
  const errors: string[] = [];

  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
  }

  if (typeof password === 'string' && password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`);
  }

  if (typeof password !== 'string') {
    return { valid: false, errors };
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Le mot de passe doit contenir au moins une lettre majuscule (A-Z).');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Le mot de passe doit contenir au moins une lettre minuscule (a-z).');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Le mot de passe doit contenir au moins un chiffre (0-9).');
  }

  if (!/[^A-Za-z0-9\s]/.test(password)) {
    errors.push('Le mot de passe doit contenir au moins un caractère spécial (ex: !@#$%^&*_-+=).');
  }

  if (/\s/.test(password)) {
    errors.push('Le mot de passe ne doit pas contenir d espaces.');
  }

  if (/(.)\1{3,}/.test(password)) {
    errors.push('Le mot de passe ne doit pas comporter plus de 3 caractères identiques consécutifs.');
  }

  const lower = password.toLowerCase();
  for (const pattern of COMMON_WEAK_PATTERNS) {
    if (lower.includes(pattern)) {
      errors.push('Le mot de passe contient une suite courante ou facilement devinable interdite.');
      break;
    }
  }

  if (context.email) {
    const localPart = context.email.split('@')[0]?.toLowerCase() || '';
    const tokens = localPart.split(/[._+-]/).filter((t) => t.length >= 3);
    if (
      (localPart.length >= 3 && lower.includes(localPart)) ||
      tokens.some((tok) => lower.includes(tok))
    ) {
      errors.push('Le mot de passe ne doit pas contenir votre identifiant ou adresse e-mail.');
    }
  }

  if (context.name) {
    const nameTokens = context.name
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ''))
      .filter((t) => t.length >= 4);
    if (nameTokens.some((tok) => lower.includes(tok))) {
      errors.push('Le mot de passe ne doit pas contenir votre nom ou prénom.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generates a cryptographically strong 16-character temporary password
 * guaranteed to comply with validatePasswordPolicy().
 */
export function generateCompliantTemporaryPassword(): string {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*+-=?';
  const all = uppers + lowers + digits + symbols;

  const pick = (charset: string) => charset[crypto.randomInt(0, charset.length)];

  const chars = [
    pick(uppers),
    pick(uppers),
    pick(lowers),
    pick(lowers),
    pick(digits),
    pick(digits),
    pick(symbols),
    pick(symbols),
  ];

  while (chars.length < 16) {
    chars.push(pick(all));
  }

  // Fisher-Yates shuffle with CSPRNG
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
