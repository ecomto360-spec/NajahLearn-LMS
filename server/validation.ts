/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError } from 'zod';

// =============================================================================
// XSS & CONTROL-CHARACTER DETECTION / SANITIZATION PRIMITIVES
// =============================================================================

const HTML_TAG_PATTERN = /<\s*\/?\s*[a-z!/?][^>]*>/i;
const DANGEROUS_TAG_OPEN_PATTERN =
  /<\s*\/?\s*(?:script|iframe|object|embed|svg|math|img|style|link|meta|base|form|input|button|textarea|body|html|details|video|audio|source|marquee|applet)\b/i;
const EVENT_HANDLER_PATTERN =
  /\bon(?:error|load|click|dblclick|mouseover|mouseout|mouseenter|mouseleave|mousemove|mousedown|mouseup|focus|blur|change|submit|reset|keyup|keydown|keypress|input|toggle|animationstart|animationend|transitionend|pointerenter|pointerover|wheel|copy|paste|cut|drag|drop|contextmenu)\s*=/i;
const DANGEROUS_PROTOCOL_PATTERN =
  /(?:javascript|vbscript|livescript)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml|application\/javascript|application\/xhtml\+xml)/i;
const ENCODED_SCRIPT_PATTERN = /(?:javascript\s*&#|expression\s*\(|&#x0*3c;|&#0*60;)/i;

export function stripControlChars(input: string, allowNewlines: boolean = false): string {
  if (allowNewlines) {
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
  return input.replace(/[\x00-\x1F\x7F]/g, ' ');
}

export function containsXssPayload(input: string): boolean {
  if (!input) return false;
  return (
    HTML_TAG_PATTERN.test(input) ||
    DANGEROUS_TAG_OPEN_PATTERN.test(input) ||
    EVENT_HANDLER_PATTERN.test(input) ||
    DANGEROUS_PROTOCOL_PATTERN.test(input) ||
    ENCODED_SCRIPT_PATTERN.test(input)
  );
}

// =============================================================================
// REUSABLE ZOD ATOMIC SCHEMAS
// =============================================================================

export const safeIdSchema = (label: string = 'Identifiant') =>
  z
    .string({ error: `${label} invalide.` })
    .trim()
    .min(1, `${label} requis.`)
    .max(128, `${label} trop long.`)
    .regex(/^[a-zA-Z0-9_.:-]+$/, `${label} contient des caractères non autorisés.`);

export const safeEmailSchema = z
  .string({ error: 'Adresse e-mail requise.' })
  .trim()
  .min(5, 'Adresse e-mail trop courte.')
  .max(254, 'Adresse e-mail trop longue.')
  .email('Format d adresse e-mail invalide.')
  .refine((v) => !containsXssPayload(v) && !/[<>"'\\`\s]/.test(v), {
    message: 'Adresse e-mail contenant des caractères interdits.',
  })
  .transform((v) => v.toLowerCase());

export const safePasswordInputSchema = (label: string = 'Mot de passe') =>
  z
    .string({ error: `${label} requis.` })
    .min(1, `${label} requis.`)
    .max(256, `${label} trop long (maximum 256 caractères).`)
    .refine((v) => !v.includes('\x00'), `${label} contient un octet nul interdit.`);

export const safeTextSchema = (minLen: number, maxLen: number, label: string) =>
  z
    .string({ error: `${label} doit être une chaîne de caractères.` })
    .transform((v) => stripControlChars(v, false).trim())
    .pipe(
      z
        .string()
        .min(minLen, `${label} doit contenir au moins ${minLen} caractère(s).`)
        .max(maxLen, `${label} ne peut pas dépasser ${maxLen} caractères.`)
        .refine((v) => !containsXssPayload(v), {
          message: `Contenu HTML/script dangereux détecté dans "${label}".`,
        })
    );

export const safePersonNameSchema = (label: string = 'Nom complet') =>
  safeTextSchema(2, 120, label).refine(
    (v) => /^[\p{L}\p{N}\s.'()-]+$/u.test(v),
    `${label} contient des symboles non autorisés.`
  );

export const safeOptionalTextSchema = (maxLen: number, label: string) =>
  z
    .string({ error: `${label} doit être une chaîne de caractères.` })
    .transform((v) => stripControlChars(v, false).trim())
    .pipe(
      z
        .string()
        .max(maxLen, `${label} ne peut pas dépasser ${maxLen} caractères.`)
        .refine((v) => !containsXssPayload(v), {
          message: `Contenu HTML/script dangereux détecté dans "${label}".`,
        })
    )
    .optional();

export const safePhoneSchema = z
  .string()
  .transform((v) => stripControlChars(v, false).trim())
  .pipe(
    z
      .string()
      .max(30, 'Numéro de téléphone trop long.')
      .refine(
        (v) => v === '' || /^\+?[0-9][0-9\s().-]{5,24}$/.test(v),
        'Format de numéro de téléphone invalide.'
      )
  )
  .optional();

export const isoDateOnlySchema = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} doit être au format AAAA-MM-JJ.`);

export const isoDateTimeSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(10, `${label} invalide.`)
    .max(64, `${label} trop long.`)
    .refine((v) => !Number.isNaN(Date.parse(v)) && !containsXssPayload(v), {
      message: `${label} doit être une date/heure ISO valide.`,
    });

export const emptyStrictObjectSchema = z.object({}).strict();

export const emptyBodySchema = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? {} : val),
  z.object({}).strict()
);

// =============================================================================
// ROUTE-SPECIFIC ZOD SCHEMAS (BODY, PARAMS, QUERY)
// =============================================================================

export const idParamSchema = z
  .object({
    id: safeIdSchema('Identifiant de ressource'),
  })
  .strict();

export const sessionIdParamSchema = z
  .object({
    sessionId: safeIdSchema('Identifiant de séance'),
  })
  .strict();

export const providerParamSchema = z
  .object({
    provider: z.enum(['ZOOM', 'PAYMENT_GATEWAY', 'EMAIL_SMTP']),
  })
  .strict();

export const courseLessonParamSchema = z
  .object({
    courseId: safeIdSchema('Identifiant de formation'),
    lessonId: safeIdSchema('Identifiant de leçon'),
  })
  .strict();

export const checkoutIdParamSchema = z
  .object({
    checkoutId: safeIdSchema('Identifiant Checkout Chargily'),
  })
  .strict();

export const safeSlugSchema = z
  .string({ error: 'Slug requis.' })
  .trim()
  .min(3, 'Le slug doit contenir au moins 3 caractères.')
  .max(64, 'Le slug ne peut pas dépasser 64 caractères.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Le slug ne peut contenir que des lettres minuscules, chiffres et tirets.'
  );

export const webhookTenantSlugParamSchema = z
  .object({
    tenantSlug: safeSlugSchema.optional(),
  })
  .strict();

// --- AUTH SCHEMAS ---

export const loginBodySchema = z
  .object({
    email: safeEmailSchema,
    password: safePasswordInputSchema('Mot de passe'),
    expectedRole: z.enum(['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT']).optional(),
    rememberMe: z.boolean().optional(),
  })
  .strict();

export const firebaseLoginBodySchema = z
  .object({
    idToken: z.string().trim().min(10).max(8192).optional(),
  })
  .strict();

export const forgotPasswordBodySchema = z
  .object({
    email: safeEmailSchema,
  })
  .strict();

export const resetPasswordBodySchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(10, 'Jeton de réinitialisation invalide.')
      .max(256, 'Jeton de réinitialisation trop long.')
      .regex(/^[a-zA-Z0-9_.-]+$/, 'Format de jeton invalide.'),
    newPassword: safePasswordInputSchema('Nouveau mot de passe'),
  })
  .strict();

export const changePasswordBodySchema = z
  .object({
    currentPassword: safePasswordInputSchema('Mot de passe actuel'),
    newPassword: safePasswordInputSchema('Nouveau mot de passe'),
  })
  .strict();

export const demoSwitchBodySchema = z
  .object({
    targetRole: z.enum(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']).optional(),
    userId: safeIdSchema('Identifiant utilisateur').optional(),
    tenantId: safeIdSchema('Identifiant établissement').optional(),
  })
  .strict()
  .refine((data) => Boolean(data.targetRole || data.userId), {
    message: 'Veuillez fournir targetRole ou userId.',
  });

export const updateLanguagePreferenceBodySchema = z
  .object({
    preferredLanguage: z.enum(['fr', 'ar']),
  })
  .strict();

// --- STUDENTS SCHEMAS ---

export const studentsQuerySchema = z
  .object({
    query: safeOptionalTextSchema(100, 'Recherche'),
    classId: z
      .union([z.literal('ALL'), safeIdSchema('Identifiant de classe')])
      .optional(),
    status: z.enum(['ALL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
    wilaya: safeOptionalTextSchema(80, 'Wilaya'),
  })
  .strict();

export const createStudentBodySchema = z
  .object({
    name: safePersonNameSchema('Nom complet'),
    email: safeEmailSchema,
    password: safePasswordInputSchema('Mot de passe initial').optional(),
    phone: safePhoneSchema,
    city: safeOptionalTextSchema(80, 'Ville'),
    wilaya: safeOptionalTextSchema(80, 'Wilaya'),
    academicLevel: safeOptionalTextSchema(120, 'Niveau académique'),
    classId: z
      .string()
      .trim()
      .max(128)
      .refine((v) => v === '' || /^[a-zA-Z0-9_.:-]+$/.test(v), 'Identifiant de classe invalide.')
      .optional(),
    courseId: safeIdSchema('Identifiant de formation').optional(),
    createPendingPayment: z.boolean().optional(),
  })
  .strict();

export const updateStudentStatusBodySchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
    administrativeNotes: safeOptionalTextSchema(500, 'Notes administratives'),
  })
  .strict();

export const importCsvBodySchema = z
  .object({
    csvText: z
      .string({ error: 'Contenu CSV requis.' })
      .min(1, 'Contenu CSV vide.')
      .max(1_000_000, 'Fichier CSV trop volumineux (max 1 Mo).')
      .refine((v) => !v.includes('\x00'), 'Octet nul interdit dans le CSV.'),
    dryRun: z.boolean().optional().default(false),
  })
  .strict();

// --- CLASSES SCHEMAS ---

export const createClassBodySchema = z
  .object({
    name: safeTextSchema(2, 140, 'Nom de la classe'),
    code: z
      .string()
      .trim()
      .min(2, 'Code classe trop court.')
      .max(40, 'Code classe trop long.')
      .regex(/^[A-Za-z0-9_-]+$/, 'Le code classe ne peut contenir que lettres, chiffres, - et _.'),
    courseId: safeIdSchema('Identifiant de formation'),
    teacherId: safeIdSchema('Identifiant enseignant'),
    capacity: z.coerce.number().int().min(1).max(500).optional().default(25),
    startDate: isoDateOnlySchema('Date de début').optional(),
    endDate: isoDateOnlySchema('Date de fin').optional(),
  })
  .strict();

// --- SESSIONS SCHEMAS ---

export const sessionsQuerySchema = z
  .object({
    classId: safeIdSchema('Identifiant de classe').optional(),
    teacherId: safeIdSchema('Identifiant enseignant').optional(),
  })
  .strict();

export const createSessionBodySchema = z
  .object({
    courseId: safeIdSchema('Identifiant de formation'),
    classId: safeIdSchema('Identifiant de classe'),
    teacherId: safeIdSchema('Identifiant enseignant').optional(),
    title: safeTextSchema(3, 180, 'Titre de la séance'),
    description: safeOptionalTextSchema(1000, 'Description de la séance'),
    scheduledAt: isoDateTimeSchema('Horaire de la séance'),
    durationMinutes: z.coerce.number().int().min(15).max(480).optional().default(90),
  })
  .strict();

export const updateSessionBodySchema = z
  .object({
    title: safeTextSchema(3, 180, 'Titre de la séance').optional(),
    description: safeOptionalTextSchema(1000, 'Description de la séance'),
    scheduledAt: isoDateTimeSchema('Horaire de la séance').optional(),
    durationMinutes: z.coerce.number().int().min(15).max(480).optional(),
    status: z.enum(['SCHEDULED', 'LIVE', 'COMPLETED', 'POSTPONED', 'CANCELLED']).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.scheduledAt !== undefined ||
      data.durationMinutes !== undefined ||
      data.status !== undefined,
    { message: 'Au moins un champ à modifier est requis.' }
  );

// --- ATTENDANCE SCHEMAS ---

export const attendanceEntrySchema = z
  .object({
    studentId: safeIdSchema('Identifiant étudiant'),
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
    minutesLate: z.coerce.number().int().min(0).max(240).optional().default(0),
    teacherComment: safeOptionalTextSchema(500, 'Commentaire enseignant'),
  })
  .strict();

export const saveAttendanceBodySchema = z
  .object({
    entries: z
      .array(attendanceEntrySchema)
      .min(1, 'Au moins une entrée de présence est requise.')
      .max(200, 'Trop d entrées dans une seule requête.'),
  })
  .strict();

// --- PAYMENTS & SUBSCRIPTIONS SCHEMAS ---

export const createPaymentBodySchema = z
  .object({
    studentId: safeIdSchema('Identifiant étudiant').optional(),
    courseId: safeIdSchema('Identifiant de formation'),
    installmentItemId: safeIdSchema('Identifiant d échéance').optional(),
    amountDzd: z.coerce
      .number()
      .int('Le montant en DZD doit être un nombre entier.')
      .min(100, 'Le montant minimum est de 100 DZD.')
      .max(5_000_000, 'Le montant dépasse le plafond autorisé (5 000 000 DZD).'),
    paymentMethod: z.enum([
      'CASH',
      'BANK_TRANSFER',
      'BARIDIMOB_CCP',
      'CHEQUE',
      'ONLINE_CARD',
    ]),
    transactionReference: safeTextSchema(2, 120, 'Référence de transaction').optional(),
    administrativeNotes: safeOptionalTextSchema(500, 'Notes administratives'),
    receiptUploadId: safeIdSchema('Identifiant du justificatif').optional(),
  })
  .strict();

export const confirmPaymentBodySchema = z
  .object({
    administrativeNotes: safeOptionalTextSchema(500, 'Notes administratives'),
  })
  .strict();

export const refundPaymentBodySchema = z
  .object({
    reason: safeTextSchema(3, 300, 'Motif du remboursement'),
    amountDzd: z.coerce
      .number()
      .int('Le montant remboursé doit être un nombre entier en DZD.')
      .min(1, 'Le montant remboursé doit être supérieur à 0 DZD.')
      .max(5_000_000)
      .optional(),
  })
  .strict();

export const createChargilyCheckoutBodySchema = z
  .object({
    courseId: safeIdSchema('Identifiant de formation'),
    cardMethod: z.enum(['edahabia', 'cib']).default('edahabia'),
    installmentItemId: safeIdSchema('Identifiant d échéance').optional(),
    installmentsCount: z.coerce.number().int().min(1).max(12).optional(),
    idempotencyKey: safeIdSchema('Clé d idempotence').optional(),
    locale: z.enum(['fr', 'ar']).optional(),
  })
  .strict();

export const simulateChargilySandboxBodySchema = z
  .object({
    outcome: z.enum(['paid', 'failed', 'canceled', 'expired']),
    eventIdOverride: safeIdSchema('Identifiant d événement').optional(),
    failureReason: safeOptionalTextSchema(240, 'Motif d échec'),
  })
  .strict();

export const chargilyWebhookBodySchema = z
  .object({
    id: safeIdSchema('Identifiant d événement Chargily'),
    entity: z.string().trim().max(32).optional(),
    livemode: z.union([z.boolean(), z.string()]).optional(),
    type: z.enum([
      'checkout.paid',
      'checkout.failed',
      'checkout.canceled',
      'checkout.expired',
      'checkout.refunded',
    ]),
    data: z.record(z.string(), z.unknown()),
    created_at: z.number().optional(),
    updated_at: z.number().optional(),
  })
  .passthrough();

export const installmentsQuerySchema = z
  .object({
    studentId: safeIdSchema('Identifiant étudiant').optional(),
  })
  .strict();

export const createInstallmentPlanBodySchema = z
  .object({
    studentId: safeIdSchema('Identifiant étudiant').optional(),
    courseId: safeIdSchema('Identifiant de formation'),
    totalAmountDzd: z.coerce.number().int().min(200).max(5_000_000).optional(),
    installmentsCount: z.coerce.number().int().min(2).max(12),
    intervalDays: z.coerce.number().int().min(7).max(90).optional().default(30),
    firstDueDate: isoDateOnlySchema('Date de 1ère échéance').optional(),
    title: safeOptionalTextSchema(160, 'Intitulé de l échéancier'),
    notes: safeOptionalTextSchema(500, 'Notes de l échéancier'),
  })
  .strict();

export const runRemindersBodySchema = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? {} : val),
  z
    .object({
      referenceDateYmd: isoDateOnlySchema('Date de référence').optional(),
    })
    .strict()
);

export const invoicesQuerySchema = z
  .object({
    studentId: safeIdSchema('Identifiant étudiant').optional(),
  })
  .strict();

export const subscriptionsQuerySchema = z
  .object({
    studentId: safeIdSchema('Identifiant étudiant').optional(),
  })
  .strict();

// --- AUDIT & SETTINGS SCHEMAS ---

export const auditLogsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

const safeIntegrationStringValueSchema = z
  .string()
  .transform((v) => stripControlChars(v, false).trim())
  .pipe(
    z
      .string()
      .max(512)
      .refine((v) => !containsXssPayload(v), 'Valeur de configuration dangereuse rejetée.')
  );

const safeIntegrationConfigValueSchema = z.union([
  safeIntegrationStringValueSchema,
  z.number().finite(),
  z.boolean(),
  z.array(safeIntegrationStringValueSchema).max(20),
]);

export const updateIntegrationBodySchema = z
  .object({
    isEnabled: z.boolean().optional(),
    isTestMode: z.boolean().optional(),
    config: z.record(z.string().regex(/^[a-zA-Z0-9_]{1,64}$/), safeIntegrationConfigValueSchema).optional(),
  })
  .strict();

// --- NOTIFICATIONS, PREFERENCES & TRANSACTIONAL EMAIL QUEUE SCHEMAS ---

export const notificationsQuerySchema = z
  .object({
    unreadOnly: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    category: z
      .enum([
        'ALL',
        'GENERAL',
        'PASSWORD_RESET',
        'PAYMENT_CONFIRMATION',
        'SUBSCRIPTION_EXPIRING_7D',
        'SESSION_REMINDER',
        'ACCOUNT_CREATED',
        'BILLING_REMINDER',
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const updateNotificationPreferencesBodySchema = z
  .object({
    emailPaymentConfirmation: z.boolean().optional(),
    inAppPaymentConfirmation: z.boolean().optional(),
    emailSubscriptionExpiring: z.boolean().optional(),
    inAppSubscriptionExpiring: z.boolean().optional(),
    emailSessionReminder: z.boolean().optional(),
    inAppSessionReminder: z.boolean().optional(),
    emailAccountCreated: z.boolean().optional(),
    inAppAccountCreated: z.boolean().optional(),
    emailInstallmentReminder: z.boolean().optional(),
    inAppInstallmentReminder: z.boolean().optional(),
  })
  .strict();

export const emailQueueQuerySchema = z
  .object({
    status: z
      .enum(['ALL', 'PENDING', 'PROCESSING', 'SENT', 'RETRY_SCHEDULED', 'FAILED'])
      .optional(),
    templateType: z
      .enum([
        'ALL',
        'PASSWORD_RESET',
        'PAYMENT_CONFIRMATION',
        'SUBSCRIPTION_EXPIRING_7D',
        'SESSION_REMINDER',
        'ACCOUNT_CREATED',
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export const processEmailQueueBodySchema = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? {} : val),
  z
    .object({
      limit: z.coerce.number().int().min(1).max(50).optional(),
      forceDueNow: z.boolean().optional(),
    })
    .strict()
);

export const runEmailSweepsBodySchema = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? {} : val),
  z
    .object({
      referenceDateYmd: isoDateOnlySchema('Date de référence abonnements').optional(),
      referenceTimeIso: z
        .string()
        .trim()
        .max(40)
        .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Horodatage ISO invalide.')
        .optional(),
      windowHours: z.coerce.number().int().min(1).max(72).optional(),
    })
    .strict()
);

export const sendTestEmailBodySchema = z
  .object({
    templateType: z.enum([
      'PASSWORD_RESET',
      'PAYMENT_CONFIRMATION',
      'SUBSCRIPTION_EXPIRING_7D',
      'SESSION_REMINDER',
      'ACCOUNT_CREATED',
    ]),
    locale: z.enum(['fr', 'ar']),
    recipientEmail: safeEmailSchema.optional(),
    simulateTransientFailuresCount: z.coerce.number().int().min(0).max(5).optional(),
  })
  .strict();

// --- UPLOADS SCHEMAS ---

export const uploadMetadataBodySchema = z
  .object({
    category: z.enum(['PAYMENT_RECEIPT', 'COURSE_MATERIAL']),
    courseId: safeIdSchema('Identifiant de formation').optional(),
    paymentId: safeIdSchema('Identifiant de paiement').optional(),
    description: safeOptionalTextSchema(300, 'Description du fichier'),
  })
  .strict();

export const uploadsListQuerySchema = z
  .object({
    category: z.enum(['PAYMENT_RECEIPT', 'COURSE_MATERIAL']).optional(),
    courseId: safeIdSchema('Identifiant de formation').optional(),
    paymentId: safeIdSchema('Identifiant de paiement').optional(),
  })
  .strict();

// --- MULTI-TENANT & SUPER ADMIN SAAS SCHEMAS ---

export const hexColorSchema = (label: string) =>
  z
    .string({ error: `${label} requise.` })
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, `${label} doit être un code couleur hexadécimal (#RRGGBB).`);

export const safeUrlOrAssetPathSchema = (label: string) =>
  z
    .string()
    .transform((v) => stripControlChars(v, false).trim())
    .pipe(
      z
        .string()
        .max(512, `${label} trop long.`)
        .refine(
          (v) =>
            v === '' ||
            (!containsXssPayload(v) &&
              (v.startsWith('/') || v.startsWith('https://') || v.startsWith('http://'))),
          `${label} doit être une URL valide ou un chemin d asset local.`
        )
    )
    .optional();

export const publicTenantQuerySchema = z
  .object({
    tenantId: safeIdSchema('Identifiant établissement').optional(),
    tenantSlug: safeSlugSchema.optional(),
  })
  .strict();

export const updateTenantBrandingBodySchema = z
  .object({
    name: safeTextSchema(3, 140, 'Nom de l établissement').optional(),
    shortName: safeTextSchema(2, 8, 'Sigle court').optional(),
    tagline: safeTextSchema(3, 220, 'Slogan / Devise').optional(),
    logoUrl: safeUrlOrAssetPathSchema('URL du logo'),
    primaryColor: hexColorSchema('Couleur principale').optional(),
    secondaryColor: hexColorSchema('Couleur secondaire').optional(),
    accentColor: hexColorSchema('Couleur d accentuation').optional(),
    contactEmail: safeEmailSchema.optional(),
    contactPhone: safePhoneSchema,
    address: safeTextSchema(3, 220, 'Adresse postale').optional(),
    city: safeTextSchema(2, 80, 'Ville').optional(),
    wilaya: safeTextSchema(2, 80, 'Wilaya').optional(),
    website: safeUrlOrAssetPathSchema('Site web'),
    accreditationNumber: safeOptionalTextSchema(80, 'Numéro d agrément'),
    taxId: safeOptionalTextSchema(80, 'Identifiant fiscal (NIF)'),
    nif: safeOptionalTextSchema(40, 'Numéro d Identification Fiscale (NIF)'),
    nis: safeOptionalTextSchema(40, 'Numéro d Identification Statistique (NIS)'),
    rc: safeOptionalTextSchema(40, 'Registre du Commerce (RC)'),
    articleImposition: safeOptionalTextSchema(40, 'Article d Imposition (AI)'),
    tvaApplicable: z.boolean().optional(),
    tvaRatePercent: z.coerce.number().int().min(0).max(50).optional(),
    invoicePrefix: z
      .string()
      .trim()
      .min(2, 'Préfixe de facture trop court.')
      .max(16, 'Préfixe de facture trop long.')
      .regex(/^[A-Z0-9-]+$/, 'Le préfixe de facture ne peut contenir que A-Z, 0-9 et -.')
      .optional(),
    invoiceFooterNote: safeOptionalTextSchema(400, 'Mention légale de pied de facture'),
    settings: z
      .object({
        receiptPrefix: z
          .string()
          .trim()
          .min(2, 'Préfixe de reçu trop court.')
          .max(16, 'Préfixe de reçu trop long.')
          .regex(/^[A-Z0-9-]+$/, 'Le préfixe de reçu ne peut contenir que A-Z, 0-9 et -.')
          .optional(),
        receiptFooterNote: safeTextSchema(5, 400, 'Mention légale de pied de reçu').optional(),
        supportHours: safeTextSchema(3, 140, 'Horaires de scolarité').optional(),
        enforceSingleStudentSession: z.boolean().optional(),
        allowManualPayments: z.boolean().optional(),
        allowInstallments: z.boolean().optional(),
        autoRemindersEnabled: z.boolean().optional(),
        reminderDaysBeforeDue: z.coerce.number().int().min(1).max(30).optional(),
        reminderDaysAfterOverdue: z.coerce.number().int().min(1).max(30).optional(),
        reminderFinalDaysAfterOverdue: z.coerce.number().int().min(2).max(90).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const createTenantBodySchema = z
  .object({
    name: safeTextSchema(3, 140, 'Nom de l établissement'),
    slug: safeSlugSchema,
    shortName: safeTextSchema(2, 8, 'Sigle court'),
    tagline: safeTextSchema(3, 220, 'Slogan institutionnel').optional(),
    logoUrl: safeUrlOrAssetPathSchema('URL du logo'),
    primaryColor: hexColorSchema('Couleur principale').optional().default('#101B33'),
    secondaryColor: hexColorSchema('Couleur secondaire').optional().default('#2457C5'),
    accentColor: hexColorSchema('Couleur d accentuation').optional().default('#16845B'),
    contactEmail: safeEmailSchema,
    contactPhone: z
      .string()
      .trim()
      .min(6, 'Téléphone requis.')
      .max(30, 'Téléphone trop long.')
      .refine((v) => !containsXssPayload(v), 'Caractères interdits dans le téléphone.'),
    address: safeTextSchema(3, 220, 'Adresse de l établissement'),
    city: safeTextSchema(2, 80, 'Ville'),
    wilaya: safeTextSchema(2, 80, 'Wilaya'),
    website: safeUrlOrAssetPathSchema('Site web'),
    accreditationNumber: safeOptionalTextSchema(80, 'Numéro d agrément'),
    taxId: safeOptionalTextSchema(80, 'Identifiant fiscal (NIF)'),
    receiptPrefix: z
      .string()
      .trim()
      .min(2)
      .max(16)
      .regex(/^[A-Z0-9-]+$/, 'Préfixe de reçu invalide.')
      .optional(),
    subscriptionPlan: z.enum(['STARTER', 'PRO', 'ENTERPRISE']).default('PRO'),
    billingCycle: z.enum(['MONTHLY', 'ANNUAL']).default('ANNUAL'),
    monthlyFeeDzd: z.coerce.number().int().min(0).max(5_000_000).optional(),
    maxStudents: z.coerce.number().int().min(10).max(50_000).optional(),
    maxTeachers: z.coerce.number().int().min(1).max(5_000).optional(),
    subscriptionEndDate: isoDateOnlySchema('Date d échéance SaaS').optional(),
    adminName: safePersonNameSchema('Nom de l administrateur initial'),
    adminEmail: safeEmailSchema,
    adminPassword: safePasswordInputSchema('Mot de passe administrateur initial'),
  })
  .strict();

export const updateSuperAdminTenantBodySchema = z
  .object({
    name: safeTextSchema(3, 140, 'Nom de l établissement').optional(),
    shortName: safeTextSchema(2, 8, 'Sigle court').optional(),
    tagline: safeTextSchema(3, 220, 'Slogan').optional(),
    logoUrl: safeUrlOrAssetPathSchema('URL du logo'),
    primaryColor: hexColorSchema('Couleur principale').optional(),
    secondaryColor: hexColorSchema('Couleur secondaire').optional(),
    accentColor: hexColorSchema('Couleur d accentuation').optional(),
    contactEmail: safeEmailSchema.optional(),
    contactPhone: safePhoneSchema,
    address: safeTextSchema(3, 220, 'Adresse').optional(),
    city: safeTextSchema(2, 80, 'Ville').optional(),
    wilaya: safeTextSchema(2, 80, 'Wilaya').optional(),
    accreditationNumber: safeOptionalTextSchema(80, 'Numéro d agrément'),
    taxId: safeOptionalTextSchema(80, 'Identifiant fiscal (NIF)'),
    subscriptionPlan: z.enum(['STARTER', 'PRO', 'ENTERPRISE']).optional(),
    subscriptionStatus: z.enum(['ACTIVE', 'TRIAL', 'PAST_DUE', 'SUSPENDED', 'EXPIRED']).optional(),
    subscriptionEndDate: isoDateOnlySchema('Date de fin d abonnement').optional(),
    monthlyFeeDzd: z.coerce.number().int().min(0).max(5_000_000).optional(),
    billingNotes: safeOptionalTextSchema(500, 'Notes de facturation'),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
    maxStudents: z.coerce.number().int().min(10).max(50_000).optional(),
    maxTeachers: z.coerce.number().int().min(1).max(5_000).optional(),
  })
  .strict();

export const createTenantSubscriptionBodySchema = z
  .object({
    planCode: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
    billingCycle: z.enum(['MONTHLY', 'ANNUAL']),
    amountDzd: z.coerce.number().int().min(0).max(50_000_000),
    maxStudents: z.coerce.number().int().min(10).max(50_000).optional(),
    maxTeachers: z.coerce.number().int().min(1).max(5_000).optional(),
    startDate: isoDateOnlySchema('Date de début').optional(),
    endDate: isoDateOnlySchema('Date d échéance'),
    paymentMethod: z
      .enum(['CASH', 'BANK_TRANSFER', 'BARIDIMOB_CCP', 'CHEQUE', 'ONLINE_CARD'])
      .default('BANK_TRANSFER'),
    notes: safeOptionalTextSchema(500, 'Notes contractuelles'),
  })
  .strict();

// =============================================================================
// EXPRESS ZOD VALIDATION MIDDLEWARE
// =============================================================================

export interface RequestSchemas {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
}

function formatZodIssues(err: ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'root',
    message: issue.message,
  }));
}

/**
 * Pre-validates `req.params` and `req.query` strictly before multipart stream parsing (`multer`).
 */
export function validateParamsAndQuery(
  schemas: Pick<RequestSchemas, 'params' | 'query'> = {}
): RequestHandler {
  const paramsSchema = schemas.params ?? emptyStrictObjectSchema;
  const querySchema = schemas.query ?? emptyStrictObjectSchema;

  return (req: Request, res: Response, next: NextFunction) => {
    const paramsResult = paramsSchema.safeParse(req.params ?? {});
    if (!paramsResult.success) {
      const issues = formatZodIssues(paramsResult.error);
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        target: 'params',
        issues,
        message: issues[0]?.message || 'Paramètres d URL invalides.',
      });
    }

    const queryResult = querySchema.safeParse(req.query ?? {});
    if (!queryResult.success) {
      const issues = formatZodIssues(queryResult.error);
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        target: 'query',
        issues,
        message: issues[0]?.message || 'Paramètres de requête invalides.',
      });
    }

    req.params = paramsResult.data as any;
    Object.defineProperty(req, 'query', {
      value: queryResult.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return next();
  };
}

/**
 * Validates `req.params`, `req.query`, and `req.body` against strict Zod schemas.
 * Defaults to `emptyStrictObjectSchema` / `emptyBodySchema` when omitted so that
 * unexpected parameters or mass-assignment fields are systematically rejected.
 */
export function validateRequest(schemas: RequestSchemas = {}): RequestHandler {
  const paramsSchema = schemas.params ?? emptyStrictObjectSchema;
  const querySchema = schemas.query ?? emptyStrictObjectSchema;
  const bodySchema = schemas.body ?? emptyBodySchema;

  return (req: Request, res: Response, next: NextFunction) => {
    const paramsResult = paramsSchema.safeParse(req.params ?? {});
    if (!paramsResult.success) {
      const issues = formatZodIssues(paramsResult.error);
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        target: 'params',
        issues,
        message: issues[0]?.message || 'Paramètres d URL invalides.',
      });
    }

    const queryResult = querySchema.safeParse(req.query ?? {});
    if (!queryResult.success) {
      const issues = formatZodIssues(queryResult.error);
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        target: 'query',
        issues,
        message: issues[0]?.message || 'Paramètres de requête invalides.',
      });
    }

    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      const issues = formatZodIssues(bodyResult.error);
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        target: 'body',
        issues,
        message: issues[0]?.message || 'Données du corps de requête invalides.',
      });
    }

    req.params = paramsResult.data as any;
    Object.defineProperty(req, 'query', {
      value: queryResult.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    req.body = bodyResult.data;

    return next();
  };
}
