/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EmailTemplateType, NotificationCategory, Tenant } from '../src/types/index.ts';

export interface EmailBrandContext {
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  city: string;
  wilaya: string;
  website?: string;
  appOrigin: string;
}

export interface RenderedTransactionalTemplate {
  locale: 'fr' | 'ar';
  templateType: EmailTemplateType;
  category: NotificationCategory;
  subject: string;
  htmlBody: string;
  textBody: string;
  inAppTitle: string;
  inAppMessage: string;
  inAppType: 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT';
  inAppLink: string;
}

const EASTERN_ARABIC_DIGITS = /[٠-٩]/g;
const EXTENDED_ARABIC_DIGITS = /[۰-۹]/g;

/**
 * Ensures numbers, dates, amounts, tokens, and matricules always use readable Western digits (0-9).
 */
export function forceWesternDigits(value: unknown): string {
  return String(value ?? '')
    .replace(EASTERN_ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatAmountDzdWestern(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  const formatted = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} DZD`;
}

export function toEmailBrandContext(
  tenant: Tenant | null | undefined,
  appOrigin?: string
): EmailBrandContext {
  const cleanOrigin = (
    appOrigin ||
    (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
      ? process.env.APP_URL
      : 'http://localhost:3000')
  ).replace(/\/+$/, '');

  return {
    name: tenant?.name || 'NajahLearn Académie',
    shortName: tenant?.shortName || 'NL',
    primaryColor: /^#[0-9A-Fa-f]{6}$/.test(tenant?.primaryColor || '')
      ? tenant!.primaryColor
      : '#101B33',
    secondaryColor: /^#[0-9A-Fa-f]{6}$/.test(tenant?.secondaryColor || '')
      ? tenant!.secondaryColor
      : '#2457C5',
    accentColor: /^#[0-9A-Fa-f]{6}$/.test(tenant?.accentColor || '')
      ? tenant!.accentColor
      : '#16845B',
    contactEmail: tenant?.contactEmail || 'scolarite@najahlearn.dz',
    contactPhone: tenant?.contactPhone || '+213 21 60 00 00',
    address: tenant?.address || 'Alger',
    city: tenant?.city || 'Alger',
    wilaya: tenant?.wilaya || '16 - Alger',
    website: tenant?.website || undefined,
    appOrigin: cleanOrigin,
  };
}

function wrapEmailLayout(params: {
  locale: 'fr' | 'ar';
  brand: EmailBrandContext;
  preheader: string;
  kicker: string;
  heading: string;
  greeting: string;
  paragraphsHtml: string[];
  detailRows?: Array<{ label: string; value: string; isLtrValue?: boolean }>;
  calloutBox?: { title: string; body: string; tone?: 'neutral' | 'warning' | 'security' };
  ctaLabel?: string;
  ctaUrl?: string;
  secondaryNote?: string;
}): string {
  const isAr = params.locale === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const align = isAr ? 'right' : 'left';
  const oppAlign = isAr ? 'left' : 'right';
  const fontStack = isAr
    ? "'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif"
    : "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

  const rowsHtml =
    params.detailRows && params.detailRows.length > 0
      ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 22px 0; border: 1px solid #E2E8F0; border-radius: 10px; border-collapse: separate; overflow: hidden; background-color: #F8FAFC;">
        <tbody>
          ${params.detailRows
            .map(
              (row, idx) => `
            <tr>
              <td style="padding: 11px 16px; font-size: 13px; color: #64748B; text-align: ${align}; ${
                idx > 0 ? 'border-top: 1px solid #E2E8F0;' : ''
              }">${escapeHtml(row.label)}</td>
              <td style="padding: 11px 16px; font-size: 13px; font-weight: 600; color: #0F172A; text-align: ${oppAlign}; ${
                idx > 0 ? 'border-top: 1px solid #E2E8F0;' : ''
              }">
                ${
                  row.isLtrValue
                    ? `<span dir="ltr" style="display: inline-block; font-family: 'IBM Plex Mono', Consolas, monospace;">${escapeHtml(
                        forceWesternDigits(row.value)
                      )}</span>`
                    : escapeHtml(forceWesternDigits(row.value))
                }
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`
      : '';

  let calloutBg = '#F1F5F9';
  let calloutBorder = '#CBD5E1';
  let calloutTitleColor = '#0F172A';
  if (params.calloutBox?.tone === 'warning') {
    calloutBg = '#FFFBEB';
    calloutBorder = '#FDE68A';
    calloutTitleColor = '#92400E';
  } else if (params.calloutBox?.tone === 'security') {
    calloutBg = '#FEF2F2';
    calloutBorder = '#FECACA';
    calloutTitleColor = '#991B1B';
  }

  const calloutHtml = params.calloutBox
    ? `
      <div style="margin: 20px 0; padding: 14px 16px; background-color: ${calloutBg}; border: 1px solid ${calloutBorder}; border-radius: 10px; text-align: ${align};">
        <div style="font-size: 13px; font-weight: 700; color: ${calloutTitleColor}; margin-bottom: 4px;">
          ${escapeHtml(forceWesternDigits(params.calloutBox.title))}
        </div>
        <div style="font-size: 13px; line-height: 1.6; color: #334155;">
          ${params.calloutBox.body}
        </div>
      </div>`
    : '';

  const ctaHtml =
    params.ctaLabel && params.ctaUrl
      ? `
      <div style="margin: 26px 0 18px 0; text-align: ${align};">
        <a href="${escapeHtml(params.ctaUrl)}" target="_blank" rel="noopener noreferrer"
           style="display: inline-block; background-color: ${escapeHtml(
             params.brand.secondaryColor
           )}; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
          ${escapeHtml(params.ctaLabel)}
        </a>
      </div>`
      : '';

  const footerSupportLabel = isAr
    ? 'مصلحة الدراسة والدعم البيداغوجي'
    : 'Service Scolarité & Support Pédagogique';
  const autoNotice = isAr
    ? 'تم إرسال هذه الرسالة تلقائياً وفق تفضيلات الإشعارات الخاصة بحسابك.'
    : 'Cet e-mail transactionnel vous est adressé conformément aux préférences de notification de votre compte.';

  return `<!DOCTYPE html>
<html lang="${params.locale}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(forceWesternDigits(params.heading))}</title>
</head>
<body dir="${dir}" style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: ${fontStack}; color: #1E293B;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
    ${escapeHtml(forceWesternDigits(params.preheader))}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F1F5F9; padding: 32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: ${escapeHtml(
              params.brand.primaryColor
            )}; padding: 22px 28px; text-align: ${align};">
              <div style="font-size: 12px; color: #CBD5E1; margin-bottom: 4px;">
                ${escapeHtml(params.kicker)}
              </div>
              <div style="font-size: 19px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.01em;">
                ${escapeHtml(params.brand.name)}
              </div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 28px; text-align: ${align};">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; line-height: 1.35; font-weight: 700; color: #0F172A;">
                ${escapeHtml(forceWesternDigits(params.heading))}
              </h1>
              <p style="margin: 0 0 14px 0; font-size: 15px; font-weight: 600; color: #1E293B;">
                ${escapeHtml(params.greeting)}
              </p>
              ${params.paragraphsHtml
                .map(
                  (p) =>
                    `<p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.65; color: #334155;">${p}</p>`
                )
                .join('')}
              ${rowsHtml}
              ${calloutHtml}
              ${ctaHtml}
              ${
                params.secondaryNote
                  ? `<p style="margin: 18px 0 0 0; font-size: 12px; line-height: 1.6; color: #64748B;">${escapeHtml(
                      forceWesternDigits(params.secondaryNote)
                    )}</p>`
                  : ''
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 28px; background-color: #F8FAFC; border-top: 1px solid #E2E8F0; text-align: ${align};">
              <div style="font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">
                ${escapeHtml(params.brand.name)} — ${escapeHtml(footerSupportLabel)}
              </div>
              <div style="font-size: 12px; color: #64748B; margin-bottom: 8px;">
                ${escapeHtml(params.brand.address)}, ${escapeHtml(params.brand.city)} (${escapeHtml(
                  forceWesternDigits(params.brand.wilaya)
                )}) ·
                <span dir="ltr" style="display: inline-block;">${escapeHtml(
                  forceWesternDigits(params.brand.contactPhone)
                )}</span> ·
                <span dir="ltr" style="display: inline-block;">${escapeHtml(
                  params.brand.contactEmail
                )}</span>
              </div>
              <div style="font-size: 11px; color: #94A3B8;">
                ${escapeHtml(autoNotice)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Renders any of the 5 transactional email templates in French (`fr`) or Arabic (`ar` RTL)
 * with readable Western numerals (`0-9`) for all amounts, dates, codes, and matricules.
 */
export function renderTransactionalTemplate(params: {
  templateType: EmailTemplateType;
  locale: 'fr' | 'ar';
  recipientName: string;
  recipientEmail: string;
  brand: EmailBrandContext;
  variables: Record<string, any>;
}): RenderedTransactionalTemplate {
  const locale: 'fr' | 'ar' = params.locale === 'ar' ? 'ar' : 'fr';
  const isAr = locale === 'ar';
  const nameSafe = params.recipientName?.trim() || (isAr ? 'المستخدم' : 'Utilisateur');
  const greeting = isAr ? `مرحباً ${nameSafe}،` : `Bonjour ${nameSafe},`;
  const v = params.variables || {};
  const brand = params.brand;

  // ---------------------------------------------------------------------------
  // 1. PASSWORD_RESET (Réinitialisation de mot de passe)
  // ---------------------------------------------------------------------------
  if (params.templateType === 'PASSWORD_RESET') {
    const resetToken = forceWesternDigits(v.resetToken || 'rst_demo_token');
    const expiresMinutes = forceWesternDigits(v.expiresMinutes ?? 60);
    const resetUrl =
      v.resetUrl || `${brand.appOrigin}/?reset_token=${encodeURIComponent(resetToken)}`;

    const subject = isAr
      ? `[${brand.name}] إعادة تعيين كلمة المرور الخاصة بحسابك`
      : `[${brand.name}] Réinitialisation sécurisée de votre mot de passe`;

    const htmlBody = wrapEmailLayout({
      locale,
      brand,
      preheader: subject,
      kicker: isAr ? 'حماية الحساب والمصادقة' : 'Sécurité du compte & Authentification',
      heading: isAr ? 'طلب إعادة تعيين كلمة المرور' : 'Réinitialisation de votre mot de passe',
      greeting,
      paragraphsHtml: isAr
        ? [
            `تلقينا طلباً لإعادة تعيين كلمة المرور المرتبطة بحسابك (<span dir="ltr">${escapeHtml(
              params.recipientEmail
            )}</span>) لدى <strong>${escapeHtml(brand.name)}</strong>.`,
            `استخدم الزر أدناه أو رمز التحقق لمرة واحدة لإعداد كلمة مرور جديدة خلال <span dir="ltr"><strong>${escapeHtml(
              expiresMinutes
            )}</strong></span> دقيقة.`,
          ]
        : [
            `Nous avons reçu une demande de réinitialisation du mot de passe associé à votre compte (<strong>${escapeHtml(
              params.recipientEmail
            )}</strong>) auprès de <strong>${escapeHtml(brand.name)}</strong>.`,
            `Cliquez sur le bouton ci-dessous ou saisissez le code à usage unique dans les <strong>${escapeHtml(
              expiresMinutes
            )} minutes</strong> afin de définir un nouveau mot de passe conforme à la politique Argon2id.`,
          ],
      detailRows: [
        {
          label: isAr ? 'الحساب المعني' : 'Compte concerné',
          value: params.recipientEmail,
          isLtrValue: true,
        },
        {
          label: isAr ? 'رمز التحقق المؤقت' : 'Code / Jeton à usage unique',
          value: resetToken,
          isLtrValue: true,
        },
        {
          label: isAr ? 'مدة الصلاحية' : 'Durée de validité',
          value: isAr ? `${expiresMinutes} دقيقة` : `${expiresMinutes} minutes`,
        },
      ],
      calloutBox: {
        tone: 'security',
        title: isAr ? 'تنبيه أمني هام' : 'Avis de sécurité important',
        body: escapeHtml(
          isAr
            ? 'إذا لم تكن صاحب هذا الطلب، يرجى تجاهل هذه الرسالة؛ ستبقى كلمة مرورك الحالية محمية دون أي تغيير.'
            : "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message : votre mot de passe actuel demeure inchangé."
        ),
      },
      ctaLabel: isAr ? 'إعادة تعيين كلمة المرور الآن' : 'Réinitialiser mon mot de passe',
      ctaUrl: resetUrl,
    });

    const textBody = isAr
      ? `${greeting}\n\nطلب إعادة تعيين كلمة المرور لدى ${brand.name}\nالحساب: ${params.recipientEmail}\nالرمز المؤقت: ${resetToken}\nالصلاحية: ${expiresMinutes} دقيقة\nالرابط: ${resetUrl}\n\nإذا لم تطلب ذلك، يرجى تجاهل هذه الرسالة.`
      : `${greeting}\n\nRéinitialisation de mot de passe (${brand.name})\nCompte : ${params.recipientEmail}\nJeton à usage unique : ${resetToken}\nValidité : ${expiresMinutes} minutes\nLien : ${resetUrl}\n\nSi vous n'avez pas demandé cette opération, ignorez cet e-mail.`;

    return {
      locale,
      templateType: 'PASSWORD_RESET',
      category: 'PASSWORD_RESET',
      subject,
      htmlBody,
      textBody,
      inAppTitle: isAr ? 'طلب إعادة تعيين كلمة المرور' : 'Demande de réinitialisation de mot de passe',
      inAppMessage: isAr
        ? `تم إنشاء رمز إعادة تعيين كلمة المرور لحسابك (صالح لمدة ${expiresMinutes} دقيقة).`
        : `Un lien de réinitialisation de mot de passe valable ${expiresMinutes} minutes a été généré pour votre compte.`,
      inAppType: 'WARNING',
      inAppLink: '/security',
    };
  }

  // ---------------------------------------------------------------------------
  // 2. PAYMENT_CONFIRMATION (Confirmation de paiement & Facture)
  // ---------------------------------------------------------------------------
  if (params.templateType === 'PAYMENT_CONFIRMATION') {
    const amountStr = formatAmountDzdWestern(Number(v.amountDzd) || 0);
    const courseTitle = String(v.courseTitle || (isAr ? 'التكوين المسجل' : 'Formation inscrite'));
    const receiptNumber = forceWesternDigits(v.receiptNumber || 'REC-2026-0001');
    const invoiceNumber = forceWesternDigits(v.invoiceNumber || 'FAC-2026-00001');
    const paymentMethod = String(v.paymentMethod || 'CIB / Edahabia');
    const subscriptionEndDate = forceWesternDigits(v.subscriptionEndDate || '');
    const portalUrl = `${brand.appOrigin}/`;

    const subject = isAr
      ? `[${brand.name}] تأكيد الدفع والفاتورة رقم ${invoiceNumber}`
      : `[${brand.name}] Confirmation de paiement & Facture ${invoiceNumber}`;

    const htmlBody = wrapEmailLayout({
      locale,
      brand,
      preheader: subject,
      kicker: isAr ? 'مصلحة المالية والفوترة' : 'Service Financier & Facturation',
      heading: isAr ? 'تم تأكيد دفعتك وتفعيل اشتراكك بنجاح' : 'Paiement confirmé et abonnement activé',
      greeting,
      paragraphsHtml: isAr
        ? [
            `يسرنا إبلاغك بتأكيد عملية الدفع بمبلغ <span dir="ltr"><strong>${escapeHtml(
              amountStr
            )}</strong></span> الخاصة بتكوين <strong>${escapeHtml(courseTitle)}</strong>.`,
            `أصبحت إمكانية الوصول إلى الدروس والحصص المباشرة مفعّلة فوراً، ويمكنك تحميل فاتورتك الرسمية بصيغة PDF من فضاء الطالب.`,
          ]
        : [
            `Nous vous confirmons la validation de votre règlement de <strong>${escapeHtml(
              amountStr
            )}</strong> au titre de la formation <strong>${escapeHtml(courseTitle)}</strong>.`,
            `Vos accès pédagogiques ainsi que la participation aux séances en direct sont actifs immédiatement. Votre facture fiscale numérotée est téléchargeable au format PDF depuis votre espace.`,
          ],
      detailRows: [
        { label: isAr ? 'التكوين' : 'Formation', value: courseTitle },
        { label: isAr ? 'المبلغ المؤكد' : 'Montant réglé', value: amountStr, isLtrValue: true },
        { label: isAr ? 'وسيلة الدفع' : 'Mode de règlement', value: paymentMethod, isLtrValue: true },
        { label: isAr ? 'رقم الوصل' : 'N° de reçu', value: receiptNumber, isLtrValue: true },
        { label: isAr ? 'رقم الفاتورة' : 'N° de facture fiscale', value: invoiceNumber, isLtrValue: true },
        ...(subscriptionEndDate
          ? [
              {
                label: isAr ? 'صلاحية الاشتراك حتى' : 'Abonnement actif jusqu au',
                value: subscriptionEndDate,
                isLtrValue: true,
              },
            ]
          : []),
      ],
      ctaLabel: isAr ? 'عرض الفاتورة والوصول إلى الدروس' : 'Télécharger ma facture & Accéder aux cours',
      ctaUrl: portalUrl,
    });

    const textBody = isAr
      ? `${greeting}\n\nتم تأكيد دفعتك بمبلغ ${amountStr} لتكوين "${courseTitle}".\nرقم الوصل: ${receiptNumber}\nرقم الفاتورة: ${invoiceNumber}\nصلاحية الاشتراك: ${subscriptionEndDate}\nالرابط: ${portalUrl}`
      : `${greeting}\n\nConfirmation de votre paiement de ${amountStr} pour "${courseTitle}".\nReçu : ${receiptNumber}\nFacture : ${invoiceNumber}\nAbonnement actif jusqu'au : ${subscriptionEndDate}\nPortail : ${portalUrl}`;

    return {
      locale,
      templateType: 'PAYMENT_CONFIRMATION',
      category: 'PAYMENT_CONFIRMATION',
      subject,
      htmlBody,
      textBody,
      inAppTitle: isAr ? 'تم تأكيد الدفع وإصدار الفاتورة' : 'Paiement confirmé & Facture disponible',
      inAppMessage: isAr
        ? `تم تأكيد دفعتك (${amountStr}) للتكوين "${courseTitle}" — الفاتورة ${invoiceNumber} متاحة للتحميل.`
        : `Votre paiement de ${amountStr} pour "${courseTitle}" est validé (Facture ${invoiceNumber}). Accès actif${
            subscriptionEndDate ? ` jusqu'au ${subscriptionEndDate}` : ''
          }.`,
      inAppType: 'SUCCESS',
      inAppLink: '/student/subscriptions',
    };
  }

  // ---------------------------------------------------------------------------
  // 3. SUBSCRIPTION_EXPIRING_7D (Abonnement qui expire dans 7 jours)
  // ---------------------------------------------------------------------------
  if (params.templateType === 'SUBSCRIPTION_EXPIRING_7D') {
    const courseTitle = String(v.courseTitle || (isAr ? 'التكوين الحالي' : 'Votre formation'));
    const endDate = forceWesternDigits(v.endDate || '');
    const daysRemaining = forceWesternDigits(v.daysRemaining ?? 7);
    const renewalAmountStr = v.renewalAmountDzd
      ? formatAmountDzdWestern(Number(v.renewalAmountDzd))
      : undefined;
    const portalUrl = `${brand.appOrigin}/`;

    const subject = isAr
      ? `[${brand.name}] تنبيه: اشتراكك ينتهي خلال ${daysRemaining} أيام (${endDate})`
      : `[${brand.name}] Votre abonnement expire dans ${daysRemaining} jours (${endDate})`;

    const htmlBody = wrapEmailLayout({
      locale,
      brand,
      preheader: subject,
      kicker: isAr ? 'متابعة الاشتراكات البيداغوجية' : 'Suivi des Abonnements Pédagogiques',
      heading: isAr
        ? `ينتهي اشتراكك خلال ${daysRemaining} أيام`
        : `Votre abonnement arrive à échéance dans ${daysRemaining} jours`,
      greeting,
      paragraphsHtml: isAr
        ? [
            `نود تذكيرك بأن اشتراكك في تكوين <strong>${escapeHtml(
              courseTitle
            )}</strong> سينتهي بتاريخ <span dir="ltr"><strong>${escapeHtml(endDate)}</strong></span>.`,
            `لتفادي أي انقطاع في حضور الحصص المباشرة والوصول إلى الموارد المحمية، يمكنك تجديد اشتراكك عبر البطاقة البنكية <strong>CIB / Edahabia</strong> أو عبر <strong>CCP / BaridiMob</strong>.`,
          ]
        : [
            `Nous vous informons que votre abonnement à la formation <strong>${escapeHtml(
              courseTitle
            )}</strong> arrivera à expiration le <strong>${escapeHtml(endDate)}</strong> (dans ${escapeHtml(
              daysRemaining
            )} jours).`,
            `Afin de conserver un accès continu aux séances en direct et aux supports de cours, vous pouvez renouveler dès maintenant en ligne par carte <strong>CIB / Edahabia</strong> ou par versement <strong>CCP / BaridiMob</strong>.`,
          ],
      detailRows: [
        { label: isAr ? 'التكوين المعني' : 'Formation concernée', value: courseTitle },
        { label: isAr ? 'تاريخ انتهاء الصلاحية' : 'Date d expiration', value: endDate, isLtrValue: true },
        {
          label: isAr ? 'المدة المتبقية' : 'Échéance restante',
          value: isAr ? `${daysRemaining} أيام` : `${daysRemaining} jours`,
        },
        ...(renewalAmountStr
          ? [
              {
                label: isAr ? 'قيمة التجديد' : 'Montant de renouvellement',
                value: renewalAmountStr,
                isLtrValue: true,
              },
            ]
          : []),
      ],
      calloutBox: {
        tone: 'warning',
        title: isAr ? 'استمرارية الوصول إلى الحصص المباشرة' : 'Continuité de vos accès pédagogiques',
        body: escapeHtml(
          isAr
            ? 'يتيح التجديد قبل تاريخ الانتهاء تمديد اشتراكك تلقائياً دون تعليق حسابك.'
            : "Tout renouvellement effectué avant la date d'échéance prolonge automatiquement votre période d'accès sans interruption."
        ),
      },
      ctaLabel: isAr ? 'تجديد اشتراكي الآن' : 'Renouveler mon abonnement',
      ctaUrl: portalUrl,
    });

    const textBody = isAr
      ? `${greeting}\n\nتنبيه انتهاء الاشتراك لدى ${brand.name}\nالتكوين: ${courseTitle}\nتاريخ الانتهاء: ${endDate} (خلال ${daysRemaining} أيام)\nجدد اشتراكك عبر CIB/Edahabia أو CCP/BaridiMob: ${portalUrl}`
      : `${greeting}\n\nVotre abonnement à "${courseTitle}" (${brand.name}) expire dans ${daysRemaining} jours (le ${endDate}).\nRenouvelez en ligne (CIB/Edahabia) ou via CCP/BaridiMob : ${portalUrl}`;

    return {
      locale,
      templateType: 'SUBSCRIPTION_EXPIRING_7D',
      category: 'SUBSCRIPTION_EXPIRING_7D',
      subject,
      htmlBody,
      textBody,
      inAppTitle: isAr
        ? `اشتراكك ينتهي خلال ${daysRemaining} أيام`
        : `Abonnement expirant dans ${daysRemaining} jours`,
      inAppMessage: isAr
        ? `ينتهي اشتراكك في "${courseTitle}" بتاريخ ${endDate}. بادر بالتجديد لضمان استمرار الوصول للحصص المباشرة.`
        : `Votre abonnement à "${courseTitle}" expire le ${endDate} (J-${daysRemaining}). Renouvelez par CIB/Edahabia ou CCP/BaridiMob pour éviter toute coupure.`,
      inAppType: 'WARNING',
      inAppLink: '/student/subscriptions',
    };
  }

  // ---------------------------------------------------------------------------
  // 4. SESSION_REMINDER (Rappel de séance en direct)
  // ---------------------------------------------------------------------------
  if (params.templateType === 'SESSION_REMINDER') {
    const sessionTitle = String(v.sessionTitle || (isAr ? 'حصة مباشرة' : 'Séance en direct'));
    const courseTitle = String(v.courseTitle || '');
    const className = String(v.className || '');
    const teacherName = String(v.teacherName || '');
    const scheduledDisplay = forceWesternDigits(v.scheduledDisplay || v.scheduledAt || '');
    const durationMinutes = forceWesternDigits(v.durationMinutes || 90);
    const videoProvider = String(v.videoProvider || 'ZOOM');
    const sessionLink = v.joinPortalUrl || `${brand.appOrigin}/`;

    const subject = isAr
      ? `[${brand.name}] تذكير بحصة مباشرة: ${sessionTitle}`
      : `[${brand.name}] Rappel de séance en direct : ${sessionTitle}`;

    const htmlBody = wrapEmailLayout({
      locale,
      brand,
      preheader: subject,
      kicker: isAr ? 'تذكير بالحصص التفاعلية المباشرة' : 'Planning des Séances en Direct',
      heading: isAr ? `حصة مباشرة قادمة: ${sessionTitle}` : `Rappel de cours en direct : ${sessionTitle}`,
      greeting,
      paragraphsHtml: isAr
        ? [
            `نذكركم بموعد الحصة التفاعلية المباشرة <strong>${escapeHtml(
              sessionTitle
            )}</strong>${courseTitle ? ` ضمن تكوين <strong>${escapeHtml(courseTitle)}</strong>` : ''}.`,
            `يرجى تسجيل الدخول قبل الموعد ببضع دقائق للتأكد من جاهزية الصوت والفيديو.`,
          ]
        : [
            `Nous vous rappelons la tenue prochaine de votre séance en direct <strong>${escapeHtml(
              sessionTitle
            )}</strong>${
              courseTitle ? ` dans le cadre de la formation <strong>${escapeHtml(courseTitle)}</strong>` : ''
            }.`,
            `Nous vous invitons à rejoindre votre espace quelques minutes avant le début afin de vérifier votre équipement audio/vidéo.`,
          ],
      detailRows: [
        { label: isAr ? 'عنوان الحصة' : 'Intitulé de la séance', value: sessionTitle },
        ...(className ? [{ label: isAr ? 'الفوج / القسم' : 'Classe / Groupe', value: className }] : []),
        ...(teacherName ? [{ label: isAr ? 'الأستاذ المؤطر' : 'Enseignant', value: teacherName }] : []),
        {
          label: isAr ? 'التاريخ والتوقيت (الجزائر)' : 'Date & Heure (Alger)',
          value: scheduledDisplay,
          isLtrValue: true,
        },
        {
          label: isAr ? 'المدة الزمنية' : 'Durée prévue',
          value: isAr ? `${durationMinutes} دقيقة` : `${durationMinutes} min`,
        },
        {
          label: isAr ? 'منصة البث' : 'Plateforme visio',
          value: videoProvider,
          isLtrValue: true,
        },
      ],
      ctaLabel: isAr ? 'الانضمام إلى الحصة المباشرة' : 'Accéder à la salle de cours en direct',
      ctaUrl: sessionLink,
    });

    const textBody = isAr
      ? `${greeting}\n\nتذكير بحصة مباشرة: ${sessionTitle}\nالتوقيت: ${scheduledDisplay} (${durationMinutes} دقيقة)\nالمنصة: ${videoProvider}\nالرابط: ${sessionLink}`
      : `${greeting}\n\nRappel de séance en direct : ${sessionTitle}\nDate & Heure : ${scheduledDisplay} (${durationMinutes} min)\nPlateforme : ${videoProvider}\nAccès : ${sessionLink}`;

    return {
      locale,
      templateType: 'SESSION_REMINDER',
      category: 'SESSION_REMINDER',
      subject,
      htmlBody,
      textBody,
      inAppTitle: isAr ? 'تذكير بحصة مباشرة قادمة' : 'Rappel de séance en direct',
      inAppMessage: isAr
        ? `حصتك "${sessionTitle}" مبرمجة في ${scheduledDisplay} (${durationMinutes} دقيقة).`
        : `Votre séance "${sessionTitle}" est programmée le ${scheduledDisplay} (${durationMinutes} min).`,
      inAppType: 'INFO',
      inAppLink: v.sessionId ? `/sessions/${v.sessionId}` : '/student/sessions',
    };
  }

  // ---------------------------------------------------------------------------
  // 5. ACCOUNT_CREATED (Création de compte & Bienvenue)
  // ---------------------------------------------------------------------------
  const roleCode = String(v.role || 'STUDENT');
  const roleLabel = isAr
    ? roleCode === 'TEACHER'
      ? 'أستاذ مكون'
      : roleCode === 'ADMIN'
        ? 'مدير المؤسسة'
        : roleCode === 'MANAGER'
          ? 'مسير إداري'
          : 'طالب مسجل'
    : roleCode === 'TEACHER'
      ? 'Enseignant'
      : roleCode === 'ADMIN'
        ? 'Administrateur d établissement'
        : roleCode === 'MANAGER'
          ? 'Gestionnaire administratif'
          : 'Étudiant';

  const matricule = v.matricule ? forceWesternDigits(v.matricule) : '';
  const temporaryPassword = v.temporaryPassword ? String(v.temporaryPassword) : '';
  const loginUrl = `${brand.appOrigin}/`;

  const subject = isAr
    ? `[${brand.name}] مرحباً بك — تم إنشاء حسابك بنجاح`
    : `[${brand.name}] Bienvenue — Création de votre compte`;

  const htmlBody = wrapEmailLayout({
    locale,
    brand,
    preheader: subject,
    kicker: isAr ? 'التسجيل والقبول الأكاديمي' : 'Inscription & Scolarité',
    heading: isAr
      ? `مرحباً بك في ${brand.name}`
      : `Bienvenue au sein de ${brand.name}`,
    greeting,
    paragraphsHtml: isAr
      ? [
          `تم إنشاء وتفعيل حسابك الرسمي بصفتك <strong>${escapeHtml(
            roleLabel
          )}</strong> على المنصة الرقمية الخاصة بـ <strong>${escapeHtml(brand.name)}</strong>.`,
          `تجد أدناه بيانات الدخول الخاصة بك للولوج إلى الدروس، الجداول الزمنية، الفواتير والإشعارات.`,
        ]
      : [
          `Votre compte officiel en qualité d'<strong>${escapeHtml(
            roleLabel
          )}</strong> vient d'être créé et activé sur l'espace numérique de <strong>${escapeHtml(
            brand.name
          )}</strong>.`,
          `Retrouvez ci-dessous vos identifiants de connexion pour accéder à vos cours, séances en direct, factures et notifications.`,
        ],
    detailRows: [
      { label: isAr ? 'الصفة' : 'Profil / Rôle', value: roleLabel },
      {
        label: isAr ? 'البريد الإلكتروني للدخول' : 'Identifiant (E-mail)',
        value: params.recipientEmail,
        isLtrValue: true,
      },
      ...(matricule
        ? [
            {
              label: isAr ? 'رقم التسجيل' : 'Matricule officiel',
              value: matricule,
              isLtrValue: true,
            },
          ]
        : []),
      ...(temporaryPassword
        ? [
            {
              label: isAr ? 'كلمة المرور المؤقتة' : 'Mot de passe initial',
              value: temporaryPassword,
              isLtrValue: true,
            },
          ]
        : []),
    ],
    ...(temporaryPassword
      ? {
          calloutBox: {
            tone: 'neutral' as const,
            title: isAr ? 'توصية أمنية عند أول دخول' : 'Recommandation de sécurité à la première connexion',
            body: escapeHtml(
              isAr
                ? 'ننصحك بتغيير كلمة المرور المؤقتة فور تسجيل الدخول الأول من قسم الأمان في حسابك.'
                : 'Pour votre sécurité, nous vous recommandons de personnaliser ce mot de passe dès votre première connexion depuis votre espace Sécurité.'
            ),
          },
        }
      : {}),
    ctaLabel: isAr ? 'تسجيل الدخول إلى فضائي الرقمي' : 'Accéder à mon espace personnel',
    ctaUrl: loginUrl,
  });

  const textBody = isAr
    ? `${greeting}\n\nمرحباً بك في ${brand.name} (${roleLabel})\nالبريد الإلكتروني: ${params.recipientEmail}${
        matricule ? `\nرقم التسجيل: ${matricule}` : ''
      }${temporaryPassword ? `\nكلمة المرور المؤقتة: ${temporaryPassword}` : ''}\nرابط الدخول: ${loginUrl}`
    : `${greeting}\n\nBienvenue chez ${brand.name} (${roleLabel})\nIdentifiant : ${params.recipientEmail}${
        matricule ? `\nMatricule : ${matricule}` : ''
      }${temporaryPassword ? `\nMot de passe initial : ${temporaryPassword}` : ''}\nConnexion : ${loginUrl}`;

  return {
    locale,
    templateType: 'ACCOUNT_CREATED',
    category: 'ACCOUNT_CREATED',
    subject,
    htmlBody,
    textBody,
    inAppTitle: isAr ? `مرحباً بك في ${brand.name}` : `Bienvenue chez ${brand.name}`,
    inAppMessage: isAr
      ? `تم تفعيل حسابك (${roleLabel})${matricule ? ` برقم التسجيل ${matricule}` : ''} بنجاح.`
      : `Votre compte ${roleLabel}${matricule ? ` (matricule ${matricule})` : ''} est désormais actif.`,
    inAppType: 'SUCCESS',
    inAppLink: '/',
  };
}
