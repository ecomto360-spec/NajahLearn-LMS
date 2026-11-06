/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Printer, CheckCircle, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { translatePaymentMethod } from '../i18n/index.js';
import { formatDate, formatNumber, ensureWesternDigits } from '../i18n/format.js';
import type { Payment } from '../types/index.js';

interface ReceiptModalProps {
  payment: Payment;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ payment, onClose }) => {
  const { t } = useTranslation();
  const { tenant: contextTenant, fullTenant, language, isRtl } = useAuth();
  const [logoFailed, setLogoFailed] = useState(false);

  const receiptTenant: any = payment.tenant || fullTenant || contextTenant || {};
  const schoolName = receiptTenant.name || 'Académie NajahLearn';
  const schoolShortName = receiptTenant.shortName || 'NL';
  const schoolTagline = receiptTenant.tagline || t('receipt.defaultTagline');
  const schoolLogoUrl = receiptTenant.logoUrl || '';
  const schoolAddress = receiptTenant.address || t('common.algiers');
  const schoolCity = receiptTenant.city || t('common.algiers');
  const schoolWilaya = receiptTenant.wilaya || '16 - Alger';
  const schoolEmail = receiptTenant.contactEmail || 'scolarite@najahlearn.dz';
  const schoolPhone = receiptTenant.contactPhone || '+213 21 00 00 00';
  const schoolAccreditation =
    receiptTenant.accreditationNumber || t('receipt.defaultAccreditation');
  const schoolTaxId = receiptTenant.taxId || '';
  const footerNote =
    language === 'ar'
      ? t('receipt.defaultFooterNote')
      : receiptTenant.receiptFooterNote ||
        receiptTenant.settings?.receiptFooterNote ||
        t('receipt.defaultFooterNote');

  const handlePrint = () => {
    window.print();
  };

  const formattedDate = formatDate(payment.paymentDate, language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const currencyCode = payment.currency || 'DZD';
  const formattedAmount = `${formatNumber(payment.amountDzd, language)} ${currencyCode}`;
  const matricule = ensureWesternDigits((payment as any).studentIdNumber || payment.studentId);

  return (
    <div
      id="printable-receipt-modal"
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div
        id="printable-receipt-card"
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-800"
      >
        {/* Top establishment identity stripe */}
        <div className="h-2 w-full bg-[var(--tenant-primary)]" />

        {/* Actions bar (hidden in print) */}
        <div className="flex items-center justify-between gap-3 px-6 py-3 bg-slate-100 border-b border-slate-200 print:hidden no-print">
          <span className="text-xs font-semibold text-slate-700 truncate">
            {t('receipt.headerBarTitle', { school: schoolName })}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span>{t('receipt.printBtn')}</span>
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

        {/* Receipt Content */}
        <div className="p-8 space-y-6">
          {/* Establishment Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b border-slate-200 pb-6">
            <div className="flex items-start gap-3.5">
              {schoolLogoUrl && !logoFailed ? (
                <img
                  src={schoolLogoUrl}
                  alt={schoolName}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoFailed(true)}
                  className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-[var(--tenant-primary)] text-white font-bold text-sm flex items-center justify-center shrink-0 ltr-num">
                  {schoolShortName}
                </div>
              )}

              <div className="space-y-0.5 text-start">
                <h1 className="text-lg font-bold tracking-tight text-[var(--tenant-primary)]">
                  {schoolName}
                </h1>
                <p className="text-xs text-slate-600">{schoolTagline}</p>
                <p className="text-xs text-slate-500">
                  {schoolAddress}, {schoolCity} (<span className="ltr-num">{schoolWilaya}</span>)
                </p>
                <p className="text-[11px] text-slate-500 font-mono">
                  <span className="ltr-num">{schoolAccreditation}</span>
                  {schoolTaxId ? (
                    <>
                      {' · '}
                      {t('receipt.taxIdPrefix')} : <span className="ltr-num">{schoolTaxId}</span>
                    </>
                  ) : null}
                </p>
                <p className="text-[11px] text-slate-500 font-mono">
                  <span className="ltr-num">{schoolEmail}</span>
                  {' · '}
                  <span className="ltr-num">{schoolPhone}</span>
                </p>
              </div>
            </div>

            <div className="sm:text-end shrink-0">
              <p
                className={`text-xs font-bold mb-1 ${
                  payment.status === 'CONFIRMED'
                    ? 'text-emerald-700'
                    : payment.status === 'REFUNDED'
                    ? 'text-purple-700'
                    : payment.status === 'FAILED' || payment.status === 'REJECTED'
                    ? 'text-red-700'
                    : 'text-amber-700'
                }`}
              >
                {payment.status === 'CONFIRMED'
                  ? t('receipt.statusPaid')
                  : payment.status === 'REFUNDED'
                  ? t('receipt.statusRefunded')
                  : payment.status === 'FAILED' || payment.status === 'REJECTED'
                  ? t('receipt.statusFailed')
                  : t('receipt.statusPending')}
              </p>
              <p className="text-xs text-slate-500">{t('receipt.officialReceiptNo')}</p>
              <p className="text-base font-bold font-mono tabular-nums text-slate-900 ltr-num">
                {ensureWesternDigits(payment.receiptNumber)}
              </p>
              {payment.invoiceNumber && (
                <p className="text-[11px] text-slate-600 font-mono tabular-nums ltr-num mt-0.5">
                  {t('billing.invoices.sequentialNo')} {ensureWesternDigits(payment.invoiceNumber)}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                {t('receipt.issuedOn')}{' '}
                <span className="font-mono tabular-nums ltr-num">{formattedDate}</span>
              </p>
            </div>
          </div>

          {/* Student & Payment Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-start">
            <div>
              <p className="text-slate-500 font-medium mb-1">{t('receipt.beneficiaryLabel')}</p>
              <p className="font-semibold text-slate-900 text-sm">
                {(payment as any).studentName || t('common.studentFallback')}
              </p>
              <p className="text-slate-600 ltr-num">{(payment as any).studentEmail || ''}</p>
              <p className="text-slate-500 mt-0.5">
                {t('receipt.matriculeLabel')}{' '}
                <span className="font-mono font-semibold text-slate-800 ltr-num">{matricule}</span>
              </p>
            </div>

            <div>
              <p className="text-slate-500 font-medium mb-1">{t('receipt.paymentDetailsLabel')}</p>
              <p className="text-slate-700">
                {t('receipt.methodLabel')}{' '}
                <span className="font-semibold text-slate-900">
                  {translatePaymentMethod(t, payment.paymentMethod)}
                </span>
              </p>
              <p className="text-slate-700">
                {t('receipt.referenceLabel')}{' '}
                <span className="font-mono text-slate-900 ltr-num">
                  {ensureWesternDigits(payment.transactionReference)}
                </span>
              </p>
              <p className="text-slate-700">
                {t('receipt.currencyLabel')}{' '}
                <span className="font-semibold">
                  {t('common.dinarAlgerian')} (<span className="ltr-num">{currencyCode}</span>)
                </span>
              </p>
            </div>
          </div>

          {/* Table of items */}
          <table className="w-full text-start text-xs border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 text-start">{t('receipt.designationCol')}</th>
                <th className="py-2.5 px-4 text-center">{t('receipt.schoolCol')}</th>
                <th className="py-2.5 px-4 text-end">
                  {t('receipt.amountCol', { currency: currencyCode })}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              <tr>
                <td className="py-3 px-4 text-start">
                  <p className="font-semibold text-slate-900">
                    {(payment as any).courseTitle || t('receipt.defaultCourseTitle')}
                  </p>
                  <p className="text-slate-500 text-[11px]">{t('receipt.courseAccessDesc')}</p>
                </td>
                <td className="py-3 px-4 text-center font-mono text-slate-600 ltr-num">
                  {schoolShortName}
                </td>
                <td className="py-3 px-4 text-end font-mono font-bold tabular-nums text-slate-900">
                  <span className="ltr-num">{formattedAmount}</span>
                </td>
              </tr>
            </tbody>
            <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
              <tr>
                <td colSpan={2} className="py-3 px-4 text-end text-slate-700">
                  {t('receipt.netTotalPaid')}
                </td>
                <td className="py-3 px-4 text-end text-base font-bold font-mono tabular-nums text-[var(--tenant-primary)]">
                  <span className="ltr-num">{formattedAmount}</span>
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Footer & Stamp */}
          <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4 pt-4 border-t border-slate-200 text-xs">
            <div className="text-slate-500 max-w-md space-y-1.5 text-start">
              <p className="flex items-center gap-1.5 text-[var(--tenant-accent)] font-semibold">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{t('receipt.certifiedAccounting', { school: schoolName })}</span>
              </p>
              <p className="text-[11px] leading-relaxed">{footerNote}</p>
            </div>

            <div className="text-center p-3 border border-dashed border-slate-300 rounded-lg bg-slate-50 w-48 shrink-0">
              <ShieldCheck className="w-6 h-6 text-[var(--tenant-secondary)] mx-auto mb-1" />
              <p className="text-[10px] font-bold text-slate-700">{t('receipt.schoolStamp')}</p>
              <p className="text-[10px] text-slate-500 font-mono truncate ltr-num">
                {schoolShortName} · {schoolCity.toUpperCase()}
              </p>
              <p
                className={`text-[10px] font-semibold mt-1 ${
                  payment.status === 'CONFIRMED'
                    ? 'text-emerald-700'
                    : payment.status === 'REFUNDED'
                    ? 'text-purple-700'
                    : payment.status === 'FAILED' || payment.status === 'REJECTED'
                    ? 'text-red-700'
                    : 'text-amber-700'
                }`}
              >
                {payment.status === 'CONFIRMED'
                  ? t('receipt.stampPaid')
                  : payment.status === 'REFUNDED'
                  ? t('receipt.stampRefunded')
                  : payment.status === 'FAILED' || payment.status === 'REJECTED'
                  ? t('receipt.stampFailed')
                  : t('receipt.stampPending')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
