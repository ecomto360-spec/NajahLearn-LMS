/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { containsXssPayload, stripControlChars } from './validation.ts';

/**
 * Leading characters interpreted by Microsoft Excel, LibreOffice Calc, or Google Sheets
 * as formulas or Dynamic Data Exchange (DDE) invocations (OWASP CSV Injection).
 */
const FORMULA_LEADING_PATTERN = /^[\s"']*[=+\-@\t\r\n|]/;
const DDE_DANGEROUS_PATTERN =
  /(?:\b(?:cmd|powershell|bash|sh|msexe|hyperlink|importxml|importdata|importfeed|importhtml|webservice)\b|[|!])/i;

/**
 * Neutralizes spreadsheet formula injection on CSV export cells:
 * - Normalizes embedded CR/LF newlines to spaces so multi-line payloads cannot break into a new row starting with `=`
 * - Prefixes any cell starting with `=`, `+`, `-`, `@`, `\t`, `\r`, `\n`, or `|` (even after whitespace/quotes) with `'`
 * - Wraps text cells containing special characters or neutralized prefixes in RFC-4180 double quotes (`""` escaping)
 */
export function escapeCsvCell(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return String(rawValue);
  }

  let str = String(rawValue)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  const startsWithFormulaTrigger =
    FORMULA_LEADING_PATTERN.test(String(rawValue)) || FORMULA_LEADING_PATTERN.test(str);

  if (startsWithFormulaTrigger) {
    str = `'${str.trimStart()}`;
  }

  const escapedQuotes = str.replace(/"/g, '""');
  if (
    startsWithFormulaTrigger ||
    escapedQuotes.includes(',') ||
    escapedQuotes.includes('"') ||
    escapedQuotes.includes("'") ||
    escapedQuotes.includes(' ') ||
    escapedQuotes.includes(';')
  ) {
    return `"${escapedQuotes}"`;
  }

  return escapedQuotes;
}

/**
 * RFC-4180 compliant single-line CSV parser supporting quoted fields and `""` escapes.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

export interface CsvCellSanitizationResult {
  value: string;
  formulaNeutralized: boolean;
  dangerousFormulaBlocked: boolean;
}

/**
 * Sanitizes and neutralizes formula injection in imported CSV cells.
 * - Legitimate international phone numbers (`+213...`) are allowed ONLY when `allowInternationalPhone` is true.
 * - Explicit DDE / spreadsheet macro formulas (`=CMD|...`, `+HYPERLINK(...)`, `@SUM(...)`, etc.) are flagged as dangerous.
 * - Benign leading formula prefixes (`=Amine`, `-Alger`, `@Oran`) have their leading trigger operators stripped and neutralized.
 */
export function sanitizeCsvImportCell(
  rawCell: string,
  options: { allowInternationalPhone?: boolean } = {}
): CsvCellSanitizationResult {
  const withoutControls = stripControlChars(rawCell, false).trim();
  const unquoted = withoutControls.replace(/^["']+|["']+$/g, '').trim();

  if (
    options.allowInternationalPhone &&
    (/^\+[1-9][0-9]{0,3}(?:[\s.][0-9]{1,4}){1,5}$/.test(unquoted) ||
      /^\+[1-9][0-9]{6,14}$/.test(unquoted))
  ) {
    return {
      value: unquoted,
      formulaNeutralized: false,
      dangerousFormulaBlocked: false,
    };
  }

  const hasFormulaPrefix =
    FORMULA_LEADING_PATTERN.test(rawCell) || FORMULA_LEADING_PATTERN.test(unquoted);

  if (!hasFormulaPrefix) {
    return {
      value: unquoted,
      formulaNeutralized: false,
      dangerousFormulaBlocked: false,
    };
  }

  // Detect active DDE / spreadsheet function call (`=SUM(...)`, `+HYPERLINK(...)`, `=CMD|...`, `=1+1`)
  const strippedLeading = unquoted.replace(/^[\s"'=+\-@\t\r\n|]+/, '').trim();
  const looksLikeFunctionOrMath =
    DDE_DANGEROUS_PATTERN.test(unquoted) ||
    /^[A-Z_]{2,24}\s*\(/i.test(strippedLeading) ||
    /^[0-9]+(?:\s*[+\-*/^]\s*[0-9]+)+$/.test(strippedLeading);

  if (looksLikeFunctionOrMath) {
    return {
      value: strippedLeading,
      formulaNeutralized: true,
      dangerousFormulaBlocked: true,
    };
  }

  return {
    value: strippedLeading,
    formulaNeutralized: true,
    dangerousFormulaBlocked: false,
  };
}

export const csvStudentRowZodSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Nom trop court')
      .max(120, 'Nom trop long')
      .refine((v) => !containsXssPayload(v), 'Charge XSS détectée dans le nom')
      .refine((v) => /^[\p{L}\p{N}\s.'()-]+$/u.test(v), 'Caractères interdits dans le nom'),
    email: z
      .string()
      .min(5)
      .max(254)
      .email('Adresse e-mail invalide')
      .refine((v) => !containsXssPayload(v) && !/[<>"'\\`\s]/.test(v), 'E-mail non sécurisé')
      .transform((v) => v.toLowerCase()),
    phone: z
      .string()
      .max(30)
      .refine(
        (v) => v === '' || /^\+?[0-9][0-9\s().-]{5,24}$/.test(v),
        'Numéro de téléphone invalide'
      ),
    city: z
      .string()
      .min(1)
      .max(80)
      .refine((v) => !containsXssPayload(v), 'Charge XSS détectée dans la ville')
      .refine((v) => /^[\p{L}\p{N}\s.'()-]+$/u.test(v), 'Caractères interdits dans la ville'),
    wilaya: z
      .string()
      .min(1)
      .max(80)
      .refine((v) => !containsXssPayload(v), 'Charge XSS détectée dans la wilaya')
      .refine((v) => /^[\p{L}\p{N}\s.'()-]+$/u.test(v), 'Caractères interdits dans la wilaya'),
  })
  .strict();
