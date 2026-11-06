/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Invoice } from '../src/types/index.ts';

/**
 * Converts arbitrary UTF-8 strings into WinAnsi-compatible Latin-1 characters
 * supported by StandardFonts.Helvetica in pdf-lib (preserving French accents and Western numerals 0-9).
 */
export function toPdfSafeText(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  const raw = String(input)
    .replace(/[\u00A0\u202F\u2007\u2009]/g, ' ')
    .replace(/[—–]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/…/g, '...');

  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    // Printable ASCII + Latin-1 Supplement (0x20..0x7E, 0xA1..0xFF)
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff)) {
      out += raw[i];
    } else if (code === 0x0152) {
      out += 'OE';
    } else if (code === 0x0153) {
      out += 'oe';
    } else if (code >= 0x0600 && code <= 0x06ff) {
      // Skip raw RTL glyphs in WinAnsi fallback (Western digits & Latin fields remain intact)
      continue;
    } else {
      out += ' ';
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Formats an integer DZD amount using Western numerals (0-9) and regular ASCII spaces.
 */
export function formatDzdPdf(amount: number, currency = 'DZD'): string {
  const sign = amount < 0 ? '-' : '';
  const absStr = Math.abs(Math.round(amount)).toString();
  const grouped = absStr.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped} ${toPdfSafeText(currency || 'DZD')}`;
}

function parseHexColor(hex?: string): { r: number; g: number; b: number } {
  const clean = (hex || '#101B33').replace('#', '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16) / 255,
      g: parseInt(clean.slice(2, 4), 16) / 255,
      b: parseInt(clean.slice(4, 6), 16) / 255,
    };
  }
  return { r: 16 / 255, g: 27 / 255, b: 51 / 255 };
}

function formatPaymentMethodLabel(method: string): string {
  switch (method) {
    case 'CHARGILY_EDAHABIA':
      return 'Paiement en ligne Chargily Pay - Carte Edahabia';
    case 'CHARGILY_CIB':
      return 'Paiement en ligne Chargily Pay - Carte CIB';
    case 'BARIDIMOB_CCP':
      return 'Virement CCP / Application BaridiMob';
    case 'BANK_TRANSFER':
      return 'Virement Bancaire (RIB)';
    case 'CASH':
      return 'Especes au secretariat';
    case 'CHEQUE':
      return 'Cheque bancaire certifie';
    case 'ONLINE_CARD':
      return 'Carte bancaire en ligne';
    default:
      return toPdfSafeText(method);
  }
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const safe = toPdfSafeText(text);
  if (!safe) return [''];
  const words = safe.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generates an official A4 sequentially numbered fiscal invoice PDF (%PDF-1.7)
 * containing Algerian legal mentions (NIF, NIS, RC, AI) and configurable TVA breakdown.
 */
export async function generateInvoicePdfBuffer(invoice: Invoice): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Facture ${toPdfSafeText(invoice.invoiceNumber)}`);
  pdfDoc.setAuthor(toPdfSafeText(invoice.sellerSnapshot.name));
  pdfDoc.setSubject('Facture fiscale numerotee sequentiellement');

  const page: PDFPage = pdfDoc.addPage([595.28, 841.89]); // Standard A4
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const brand = parseHexColor(invoice.sellerSnapshot.primaryColor);
  const brandColor = rgb(brand.r, brand.g, brand.b);
  const slate900 = rgb(0.08, 0.11, 0.18);
  const slate600 = rgb(0.35, 0.41, 0.49);
  const slate400 = rgb(0.58, 0.64, 0.72);
  const slate100 = rgb(0.95, 0.96, 0.98);
  const borderGray = rgb(0.86, 0.89, 0.93);
  const emeraldBg = rgb(0.91, 0.98, 0.94);
  const emeraldText = rgb(0.06, 0.48, 0.31);
  const roseBg = rgb(0.99, 0.93, 0.94);
  const roseText = rgb(0.72, 0.11, 0.21);

  const marginX = 42;
  const contentWidth = width - marginX * 2;

  // 1. Header Banner
  const headerHeight = 98;
  page.drawRectangle({
    x: 0,
    y: height - headerHeight,
    width,
    height: headerHeight,
    color: brandColor,
  });

  const sellerName = toPdfSafeText(invoice.sellerSnapshot.name) || 'Etablissement NajahLearn';
  page.drawText(sellerName.toUpperCase(), {
    x: marginX,
    y: height - 42,
    size: 15,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  const docTitle =
    invoice.status === 'REFUNDED' ? 'FACTURE FISCALE / AVOIR' : 'FACTURE FISCALE OFFICIELLE';
  page.drawText(docTitle, {
    x: marginX,
    y: height - 62,
    size: 10,
    font: fontBold,
    color: rgb(0.82, 0.89, 1),
  });

  if (invoice.sellerSnapshot.accreditationNumber) {
    page.drawText(`Agrement : ${toPdfSafeText(invoice.sellerSnapshot.accreditationNumber)}`, {
      x: marginX,
      y: height - 78,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.85, 0.9, 0.96),
    });
  }

  // Right side of header: Invoice Number & Issue Date
  const invNumLabel = `N° ${toPdfSafeText(invoice.invoiceNumber)}`;
  const invNumWidth = fontBold.widthOfTextAtSize(invNumLabel, 13);
  page.drawText(invNumLabel, {
    x: width - marginX - invNumWidth,
    y: height - 42,
    size: 13,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  const issueDateStr = toPdfSafeText(invoice.issuedAt.split('T')[0]);
  const dateLabel = `Date d'emission : ${issueDateStr}`;
  const dateWidth = fontRegular.widthOfTextAtSize(dateLabel, 9);
  page.drawText(dateLabel, {
    x: width - marginX - dateWidth,
    y: height - 60,
    size: 9,
    font: fontRegular,
    color: rgb(0.9, 0.94, 1),
  });

  const seqLabel = `Exercice ${invoice.fiscalYear} - Sequence #${String(invoice.sequenceNumber).padStart(5, '0')}`;
  const seqWidth = fontRegular.widthOfTextAtSize(seqLabel, 8.5);
  page.drawText(seqLabel, {
    x: width - marginX - seqWidth,
    y: height - 76,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.82, 0.88, 0.96),
  });

  // 2. Status Ribbon Bar
  let cursorY = height - headerHeight - 28;
  const isRefunded = invoice.status === 'REFUNDED';
  page.drawRectangle({
    x: marginX,
    y: cursorY - 8,
    width: contentWidth,
    height: 26,
    color: isRefunded ? roseBg : emeraldBg,
    borderColor: isRefunded ? roseText : emeraldText,
    borderWidth: 0.6,
  });

  const statusHeadline = isRefunded
    ? `STATUT : REMBOURSEE${invoice.creditNoteNumber ? `  |  AVOIR N° ${toPdfSafeText(invoice.creditNoteNumber)}` : ''}`
    : `STATUT : ACQUITTEE / PAYEE  |  MODE : ${formatPaymentMethodLabel(invoice.paymentMethod)}`;
  page.drawText(statusHeadline, {
    x: marginX + 10,
    y: cursorY + 1,
    size: 8.5,
    font: fontBold,
    color: isRefunded ? roseText : emeraldText,
  });

  // 3. Seller (Emetteur + Mentions Fiscales NIF/NIS/RC/AI) & Buyer (Client/Etudiant) Boxes
  cursorY -= 26;
  const boxHeight = 142;
  const colWidth = (contentWidth - 16) / 2;

  // Seller Box
  page.drawRectangle({
    x: marginX,
    y: cursorY - boxHeight,
    width: colWidth,
    height: boxHeight,
    color: slate100,
    borderColor: borderGray,
    borderWidth: 0.8,
  });

  // Buyer Box
  const rightColX = marginX + colWidth + 16;
  page.drawRectangle({
    x: rightColX,
    y: cursorY - boxHeight,
    width: colWidth,
    height: boxHeight,
    color: rgb(1, 1, 1),
    borderColor: borderGray,
    borderWidth: 0.8,
  });

  let leftY = cursorY - 18;
  page.drawText('ETABLISSEMENT EMETTEUR', {
    x: marginX + 12,
    y: leftY,
    size: 8,
    font: fontBold,
    color: slate600,
  });
  leftY -= 15;
  page.drawText(toPdfSafeText(invoice.sellerSnapshot.name).slice(0, 42), {
    x: marginX + 12,
    y: leftY,
    size: 10,
    font: fontBold,
    color: slate900,
  });
  leftY -= 13;
  page.drawText(
    toPdfSafeText(
      `${invoice.sellerSnapshot.address}, ${invoice.sellerSnapshot.city} (${invoice.sellerSnapshot.wilaya})`
    ).slice(0, 52),
    {
      x: marginX + 12,
      y: leftY,
      size: 8,
      font: fontRegular,
      color: slate600,
    }
  );
  leftY -= 12;
  page.drawText(
    toPdfSafeText(`${invoice.sellerSnapshot.phone}  |  ${invoice.sellerSnapshot.email}`).slice(
      0,
      54
    ),
    {
      x: marginX + 12,
      y: leftY,
      size: 8,
      font: fontRegular,
      color: slate600,
    }
  );

  // Fiscal Identifiers Block inside Seller Box
  leftY -= 16;
  page.drawLine({
    start: { x: marginX + 12, y: leftY + 6 },
    end: { x: marginX + colWidth - 12, y: leftY + 6 },
    thickness: 0.5,
    color: borderGray,
  });

  const nifVal = toPdfSafeText(invoice.sellerSnapshot.nif) || 'Non renseigne';
  const nisVal = toPdfSafeText(invoice.sellerSnapshot.nis) || 'Non renseigne';
  const rcVal = toPdfSafeText(invoice.sellerSnapshot.rc) || 'Non renseigne';
  const aiVal = toPdfSafeText(invoice.sellerSnapshot.articleImposition) || 'Non renseigne';

  page.drawText(`NIF : ${nifVal}`, {
    x: marginX + 12,
    y: leftY - 5,
    size: 8,
    font: fontBold,
    color: slate900,
  });
  page.drawText(`NIS : ${nisVal}`, {
    x: marginX + 12,
    y: leftY - 17,
    size: 8,
    font: fontBold,
    color: slate900,
  });
  page.drawText(`RC  : ${rcVal}`, {
    x: marginX + 12,
    y: leftY - 29,
    size: 8,
    font: fontBold,
    color: slate900,
  });
  page.drawText(`AI  : ${aiVal}`, {
    x: marginX + 12,
    y: leftY - 41,
    size: 8,
    font: fontRegular,
    color: slate600,
  });

  // Buyer Content
  let rightY = cursorY - 18;
  page.drawText('FACTURE A (APPRENANT / CLIENT)', {
    x: rightColX + 12,
    y: rightY,
    size: 8,
    font: fontBold,
    color: slate600,
  });
  rightY -= 15;
  page.drawText(toPdfSafeText(invoice.buyerSnapshot.name || 'Etudiant').slice(0, 42), {
    x: rightColX + 12,
    y: rightY,
    size: 10,
    font: fontBold,
    color: slate900,
  });
  rightY -= 14;
  if (invoice.buyerSnapshot.studentIdNumber) {
    page.drawText(`Matricule : ${toPdfSafeText(invoice.buyerSnapshot.studentIdNumber)}`, {
      x: rightColX + 12,
      y: rightY,
      size: 8.5,
      font: fontBold,
      color: brandColor,
    });
    rightY -= 13;
  }
  page.drawText(`Email : ${toPdfSafeText(invoice.buyerSnapshot.email)}`.slice(0, 50), {
    x: rightColX + 12,
    y: rightY,
    size: 8,
    font: fontRegular,
    color: slate600,
  });
  rightY -= 12;
  if (invoice.buyerSnapshot.phone) {
    page.drawText(`Tel : ${toPdfSafeText(invoice.buyerSnapshot.phone)}`, {
      x: rightColX + 12,
      y: rightY,
      size: 8,
      font: fontRegular,
      color: slate600,
    });
    rightY -= 12;
  }
  if (invoice.buyerSnapshot.city || invoice.buyerSnapshot.wilaya) {
    page.drawText(
      `Localite : ${toPdfSafeText([invoice.buyerSnapshot.city, invoice.buyerSnapshot.wilaya].filter(Boolean).join(' - '))}`,
      {
        x: rightColX + 12,
        y: rightY,
        size: 8,
        font: fontRegular,
        color: slate600,
      }
    );
    rightY -= 14;
  }
  page.drawText(`Ref. Transaction : ${toPdfSafeText(invoice.transactionReference)}`.slice(0, 48), {
    x: rightColX + 12,
    y: cursorY - boxHeight + 14,
    size: 8,
    font: fontBold,
    color: slate900,
  });

  // 4. Line Items Table
  cursorY = cursorY - boxHeight - 28;
  const tableHeaderH = 24;
  page.drawRectangle({
    x: marginX,
    y: cursorY - tableHeaderH,
    width: contentWidth,
    height: tableHeaderH,
    color: brandColor,
  });

  const colDescX = marginX + 10;
  const colQtyX = marginX + 255;
  const colHtX = marginX + 295;
  const colTvaRateX = marginX + 375;
  const colTtcX = marginX + 430;

  page.drawText('DESIGNATION DE LA PRESTATION', {
    x: colDescX,
    y: cursorY - 15,
    size: 8,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText('QTE', {
    x: colQtyX,
    y: cursorY - 15,
    size: 8,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText('MONTANT HT', {
    x: colHtX,
    y: cursorY - 15,
    size: 8,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText('TVA', {
    x: colTvaRateX,
    y: cursorY - 15,
    size: 8,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText('TOTAL TTC', {
    x: colTtcX,
    y: cursorY - 15,
    size: 8,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  cursorY -= tableHeaderH;

  const items =
    Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
      ? invoice.lineItems
      : [
          {
            description: 'Formation academique NajahLearn',
            quantity: 1,
            unitPriceHtDzd: invoice.amountHtDzd,
            tvaRatePercent: invoice.tvaRatePercent,
            tvaAmountDzd: invoice.tvaAmountDzd,
            totalTtcDzd: invoice.amountTtcDzd,
          },
        ];

  for (const item of items) {
    const descLines = wrapText(item.description, fontBold, 9, 235);
    const rowHeight = Math.max(36, descLines.length * 13 + 16);

    page.drawRectangle({
      x: marginX,
      y: cursorY - rowHeight,
      width: contentWidth,
      height: rowHeight,
      color: rgb(1, 1, 1),
      borderColor: borderGray,
      borderWidth: 0.6,
    });

    let lineY = cursorY - 15;
    for (const dLine of descLines) {
      page.drawText(dLine, {
        x: colDescX,
        y: lineY,
        size: 9,
        font: fontBold,
        color: slate900,
      });
      lineY -= 12;
    }

    page.drawText(String(item.quantity || 1), {
      x: colQtyX + 4,
      y: cursorY - 16,
      size: 8.5,
      font: fontRegular,
      color: slate900,
    });

    page.drawText(formatDzdPdf(item.unitPriceHtDzd, invoice.currency), {
      x: colHtX,
      y: cursorY - 16,
      size: 8.5,
      font: fontRegular,
      color: slate900,
    });

    page.drawText(`${item.tvaRatePercent}%`, {
      x: colTvaRateX,
      y: cursorY - 16,
      size: 8.5,
      font: fontRegular,
      color: slate600,
    });

    page.drawText(formatDzdPdf(item.totalTtcDzd, invoice.currency), {
      x: colTtcX,
      y: cursorY - 16,
      size: 9,
      font: fontBold,
      color: slate900,
    });

    cursorY -= rowHeight;
  }

  // 5. Financial Totals Summary Box (HT, TVA, TTC)
  cursorY -= 18;
  const summaryWidth = 235;
  const summaryX = width - marginX - summaryWidth;
  const summaryHeight = 86;

  page.drawRectangle({
    x: summaryX,
    y: cursorY - summaryHeight,
    width: summaryWidth,
    height: summaryHeight,
    color: slate100,
    borderColor: borderGray,
    borderWidth: 0.8,
  });

  // Total HT
  page.drawText('Total Hors Taxes (HT) :', {
    x: summaryX + 12,
    y: cursorY - 18,
    size: 8.5,
    font: fontRegular,
    color: slate600,
  });
  const htStr = formatDzdPdf(invoice.amountHtDzd, invoice.currency);
  page.drawText(htStr, {
    x: summaryX + summaryWidth - 12 - fontBold.widthOfTextAtSize(htStr, 8.5),
    y: cursorY - 18,
    size: 8.5,
    font: fontBold,
    color: slate900,
  });

  // TVA line
  const tvaLabel = invoice.tvaApplicable
    ? `TVA (${invoice.tvaRatePercent}%) :`
    : 'TVA (Exonere 0%) :';
  page.drawText(tvaLabel, {
    x: summaryX + 12,
    y: cursorY - 36,
    size: 8.5,
    font: fontRegular,
    color: slate600,
  });
  const tvaStr = formatDzdPdf(invoice.tvaAmountDzd, invoice.currency);
  page.drawText(tvaStr, {
    x: summaryX + summaryWidth - 12 - fontBold.widthOfTextAtSize(tvaStr, 8.5),
    y: cursorY - 36,
    size: 8.5,
    font: fontBold,
    color: slate900,
  });

  // Divider inside summary
  page.drawLine({
    start: { x: summaryX + 10, y: cursorY - 48 },
    end: { x: summaryX + summaryWidth - 10, y: cursorY - 48 },
    thickness: 0.8,
    color: borderGray,
  });

  // Total TTC
  page.drawText('TOTAL TTC :', {
    x: summaryX + 12,
    y: cursorY - 68,
    size: 10.5,
    font: fontBold,
    color: brandColor,
  });
  const ttcStr = formatDzdPdf(invoice.amountTtcDzd, invoice.currency);
  page.drawText(ttcStr, {
    x: summaryX + summaryWidth - 12 - fontBold.widthOfTextAtSize(ttcStr, 11),
    y: cursorY - 68,
    size: 11,
    font: fontBold,
    color: brandColor,
  });

  // Left side next to summary: Installment & Refund info if applicable
  let noteLeftY = cursorY - 16;
  if (invoice.installmentNumber && invoice.totalInstallments) {
    page.drawText(
      `Reglement d'echeancier : Echeance ${invoice.installmentNumber} / ${invoice.totalInstallments}`,
      {
        x: marginX,
        y: noteLeftY,
        size: 8.5,
        font: fontBold,
        color: brandColor,
      }
    );
    noteLeftY -= 14;
  }

  if (invoice.status === 'REFUNDED') {
    page.drawText(
      `Facture annulee par avoir N° ${toPdfSafeText(invoice.creditNoteNumber || '')}`,
      {
        x: marginX,
        y: noteLeftY,
        size: 8.5,
        font: fontBold,
        color: roseText,
      }
    );
    noteLeftY -= 13;
    if (invoice.refundReason) {
      const reasonLines = wrapText(`Motif : ${invoice.refundReason}`, fontRegular, 8, 250);
      for (const rLine of reasonLines.slice(0, 2)) {
        page.drawText(rLine, {
          x: marginX,
          y: noteLeftY,
          size: 8,
          font: fontRegular,
          color: roseText,
        });
        noteLeftY -= 11;
      }
    }
  } else if (!invoice.tvaApplicable) {
    page.drawText('Exoneration de TVA - Article du Code des Taxes sur le Chiffre d Affaires.', {
      x: marginX,
      y: noteLeftY,
      size: 8,
      font: fontRegular,
      color: slate600,
    });
  }

  // 6. Footer Legal & Sequential Guarantee
  const footerY = 66;
  page.drawLine({
    start: { x: marginX, y: footerY + 24 },
    end: { x: width - marginX, y: footerY + 24 },
    thickness: 0.6,
    color: borderGray,
  });

  const footerNote =
    invoice.footerNote ||
    'Facture fiscale officielle numerotee sequentiellement et conservee de maniere inalterable.';
  const wrappedFooter = wrapText(footerNote, fontRegular, 8, contentWidth);
  let fy = footerY + 10;
  for (const fl of wrappedFooter.slice(0, 2)) {
    page.drawText(fl, {
      x: marginX,
      y: fy,
      size: 8,
      font: fontRegular,
      color: slate600,
    });
    fy -= 11;
  }

  page.drawText(
    `Document genere electroniquement - ${toPdfSafeText(invoice.invoiceNumber)} - Devise : ${toPdfSafeText(invoice.currency)} (Chiffres occidentaux 0-9)`,
    {
      x: marginX,
      y: 32,
      size: 7.5,
      font: fontRegular,
      color: slate400,
    }
  );

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
