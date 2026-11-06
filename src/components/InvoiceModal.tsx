/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Printer, Download, ShieldCheck, CheckCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { translatePaymentMethod } from '../i18n/index.js';
import { ensureWesternDigits, formatDate, formatDzd, formatNumber } from '../i18n/format.js';
import type { Invoice } from '../types/index.js';

interface InvoiceModalProps {
  invoice: Invoice;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ invoice, onClose }) => {
  const { t } = useTranslation();
  const { language, isRtl } = useAuth();
  const [logoFailed, setLogoFailed] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const seller = invoice.sellerSnapshot;
  const buyer = invoice.buyerSnapshot;
  const isRefunded = invoice.status === 'REFUNDED';

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      await api.downloadInvoicePdf(invoice.id, `${invoice.invoiceNumber}.pdf`);
    } catch (err) {
      console.error('Invoice PDF download error:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formattedIssued = formatDate(invoice.issuedAt, language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div
      id="printable-invoice-modal"
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div
        id="printable-invoice-card"
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-800 my-auto"
      >
        {/* Establishment top bar */}
        <div className="h-2 w-full bg-[var(--tenant-primary)]" />

        {/* Actions bar (hidden in print) */}
        <div className="flex items-center justify-between gap-3 px-6 py-3 bg-slate-100 border-b border-slate-200 print:hidden no-print">
          <span className="text-xs font-semibold text-slate-700 truncate">
            {t('billing.invoices.modalHeader', {
              number: ensureWesternDigits(invoice.invoiceNumber),
            })}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-lg transition-opacity whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('billing.invoices.downloadOfficialPdf')}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span>{t('billing.invoices.printInvoiceBtn')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Invoice Body */}
        <div className="p-8 space-y-6">
          {isRefunded && (
            <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl flex items-start gap-2.5 text-purple-900 text-xs">
              <AlertTriangle className="w-4 h-4 text-purple-700 shrink-0 mt-0.5" />
              <span>
                {t('billing.invoices.refundedBanner', {
                  date: invoice.refundedAt
                    ? formatDate(invoice.refundedAt, language)
                    : formattedIssued,
                  creditNote: ensureWesternDigits(invoice.creditNoteNumber || 'AVO'),
                  reason: invoice.refundReason || '—',
                })}
              </span>
            </div>
          )}

          {/* Header: Establishment & Sequential Invoice Number */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b border-slate-200 pb-6">
            <div className="flex items-start gap-3.5">
              {seller.logoUrl && !logoFailed ? (
                <img
                  src={seller.logoUrl}
                  alt={seller.name}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoFailed(true)}
                  className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-[var(--tenant-primary)] text-white font-bold text-sm flex items-center justify-center shrink-0 ltr-num">
                  {seller.shortName || 'NL'}
                </div>
              )}

              <div className="space-y-0.5 text-start">
                <h1 className="text-lg font-bold tracking-tight text-[var(--tenant-primary)]">
                  {seller.name}
                </h1>
                <p className="text-xs text-slate-600">
                  {seller.address}, {seller.city} (
                  <span className="ltr-num">{ensureWesternDigits(seller.wilaya)}</span>)
                </p>
                <p className="text-[11px] text-slate-500 font-mono">
                  <span className="ltr-num">{seller.email}</span>
                  {' · '}
                  <span className="ltr-num">{ensureWesternDigits(seller.phone)}</span>
                </p>
                {seller.accreditationNumber && (
                  <p className="text-[11px] text-slate-500 font-mono ltr-num">
                    {ensureWesternDigits(seller.accreditationNumber)}
                  </p>
                )}
              </div>
            </div>

            <div className="sm:text-end shrink-0 space-y-0.5">
              <p
                className={`text-xs font-extrabold tracking-wide ${
                  isRefunded ? 'text-purple-700' : 'text-[var(--tenant-primary)]'
                }`}
              >
                {isRefunded
                  ? t('billing.invoices.creditNoteTitle')
                  : t('billing.invoices.invoiceTitle')}
              </p>
              <p className="text-xs text-slate-500">{t('billing.invoices.sequentialNo')}</p>
              <p className="text-base font-bold font-mono tabular-nums text-slate-900 ltr-num">
                {ensureWesternDigits(invoice.invoiceNumber)}
              </p>
              {invoice.creditNoteNumber && (
                <p className="text-xs font-mono font-bold text-purple-700 ltr-num">
                  {t('billing.invoices.creditNoteNo')}{' '}
                  {ensureWesternDigits(invoice.creditNoteNumber)}
                </p>
              )}
              <p className="text-xs text-slate-500 pt-0.5">
                {t('billing.invoices.issuedDate')}{' '}
                <span className="font-mono tabular-nums ltr-num">{formattedIssued}</span>
              </p>
              <p className="text-[11px] text-slate-400">
                {t('billing.invoices.fiscalYear')}{' '}
                <span className="font-mono tabular-nums ltr-num">
                  {ensureWesternDigits(String(invoice.fiscalYear))}
                </span>
              </p>
            </div>
          </div>

          {/* Two-Column Seller Fiscal IDs (NIF / NIS / RC / AI) & Buyer Snapshot */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-start">
            <div className="space-y-1">
              <p className="text-slate-500 font-semibold mb-1.5">
                {t('billing.invoices.sellerTitle')}
              </p>
              <p className="text-slate-700 flex justify-between gap-2">
                <span className="text-slate-500">{t('billing.invoices.nifLabel')} :</span>
                <span className="font-mono font-semibold text-slate-900 ltr-num">
                  {seller.nif ? ensureWesternDigits(seller.nif) : t('common.notProvided')}
                </span>
              </p>
              <p className="text-slate-700 flex justify-between gap-2">
                <span className="text-slate-500">{t('billing.invoices.nisLabel')} :</span>
                <span className="font-mono font-semibold text-slate-900 ltr-num">
                  {seller.nis ? ensureWesternDigits(seller.nis) : t('common.notProvided')}
                </span>
              </p>
              <p className="text-slate-700 flex justify-between gap-2">
                <span className="text-slate-500">{t('billing.invoices.rcLabel')} :</span>
                <span className="font-mono font-semibold text-slate-900 ltr-num">
                  {seller.rc ? ensureWesternDigits(seller.rc) : t('common.notProvided')}
                </span>
              </p>
              <p className="text-slate-700 flex justify-between gap-2">
                <span className="text-slate-500">{t('billing.invoices.aiLabel')} :</span>
                <span className="font-mono font-semibold text-slate-900 ltr-num">
                  {seller.articleImposition
                    ? ensureWesternDigits(seller.articleImposition)
                    : t('common.notProvided')}
                </span>
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-slate-500 font-semibold mb-1.5">
                {t('billing.invoices.buyerTitle')}
              </p>
              <p className="font-bold text-slate-900 text-sm">{buyer.name}</p>
              <p className="text-slate-600 font-mono ltr-num">{buyer.email}</p>
              {buyer.studentIdNumber && (
                <p className="text-slate-600">
                  {t('receipt.matriculeLabel')}{' '}
                  <span className="font-mono font-semibold text-slate-900 ltr-num">
                    {ensureWesternDigits(buyer.studentIdNumber)}
                  </span>
                </p>
              )}
              <p className="text-slate-600 pt-1">
                {t('receipt.methodLabel')}{' '}
                <span className="font-semibold text-slate-900">
                  {translatePaymentMethod(t, invoice.paymentMethod)}
                </span>
              </p>
              <p className="text-slate-600">
                {t('receipt.referenceLabel')}{' '}
                <span className="font-mono text-slate-900 ltr-num">
                  {ensureWesternDigits(invoice.transactionReference)}
                </span>
              </p>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 text-start">{t('billing.invoices.designationCol')}</th>
                  <th className="py-2.5 px-3 text-center">{t('billing.invoices.qtyCol')}</th>
                  <th className="py-2.5 px-3 text-end">{t('billing.invoices.unitHtCol')}</th>
                  <th className="py-2.5 px-3 text-center">{t('billing.invoices.tvaRateCol')}</th>
                  <th className="py-2.5 px-4 text-end">{t('billing.invoices.totalTtcCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {invoice.lineItems.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-3 px-4 text-start">
                      <p className="font-semibold text-slate-900">
                        {ensureWesternDigits(item.description)}
                      </p>
                      {item.courseCode && (
                        <p className="text-[11px] font-mono text-slate-500 ltr-num">
                          {ensureWesternDigits(item.courseCode)}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center font-mono tabular-nums ltr-num">
                      {formatNumber(item.quantity, language)}
                    </td>
                    <td className="py-3 px-3 text-end font-mono tabular-nums ltr-num">
                      {formatDzd(item.unitPriceHtDzd, language)}
                    </td>
                    <td className="py-3 px-3 text-center font-mono tabular-nums ltr-num">
                      {formatNumber(item.tvaRatePercent, language)}%
                    </td>
                    <td className="py-3 px-4 text-end font-mono font-bold tabular-nums text-slate-900 ltr-num">
                      {formatDzd(item.totalTtcDzd, language)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={4} className="py-2 px-4 text-end text-slate-600 font-medium">
                    {t('billing.invoices.subtotalHt')}
                  </td>
                  <td className="py-2 px-4 text-end font-mono font-semibold tabular-nums text-slate-800 ltr-num">
                    {formatDzd(invoice.amountHtDzd, language)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} className="py-2 px-4 text-end text-slate-600 font-medium">
                    {invoice.tvaApplicable && invoice.tvaRatePercent > 0
                      ? t('billing.invoices.tvaLine', {
                          rate: formatNumber(invoice.tvaRatePercent, language),
                        })
                      : t('billing.invoices.tvaExemptLine')}
                  </td>
                  <td className="py-2 px-4 text-end font-mono font-semibold tabular-nums text-slate-800 ltr-num">
                    {formatDzd(invoice.tvaAmountDzd, language)}
                  </td>
                </tr>
                <tr className="border-t border-slate-200 bg-slate-100/80">
                  <td colSpan={4} className="py-3 px-4 text-end text-slate-900 font-bold">
                    {t('billing.invoices.totalTtc')}
                  </td>
                  <td className="py-3 px-4 text-end text-base font-bold font-mono tabular-nums text-[var(--tenant-primary)] ltr-num">
                    {formatDzd(invoice.amountTtcDzd, language)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Legal Footer & Certification */}
          <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4 pt-4 border-t border-slate-200 text-xs">
            <div className="text-slate-500 max-w-md space-y-1.5 text-start">
              <p className="flex items-center gap-1.5 text-[var(--tenant-accent)] font-semibold">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{t('receipt.certifiedAccounting', { school: seller.name })}</span>
              </p>
              {invoice.footerNote && (
                <p className="text-[11px] leading-relaxed">{invoice.footerNote}</p>
              )}
            </div>

            <div className="text-center p-3 border border-dashed border-slate-300 rounded-lg bg-slate-50 w-48 shrink-0">
              <ShieldCheck className="w-6 h-6 text-[var(--tenant-secondary)] mx-auto mb-1" />
              <p className="text-[10px] font-bold text-slate-700">{t('receipt.schoolStamp')}</p>
              <p className="text-[10px] text-slate-500 font-mono truncate ltr-num">
                {seller.shortName} · {seller.city.toUpperCase()}
              </p>
              <p
                className={`text-[10px] font-semibold mt-1 ${
                  isRefunded ? 'text-purple-700' : 'text-emerald-700'
                }`}
              >
                {isRefunded ? t('receipt.stampRefunded') : t('receipt.stampPaid')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
