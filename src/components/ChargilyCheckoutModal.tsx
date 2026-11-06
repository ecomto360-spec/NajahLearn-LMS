/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  X,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { ensureWesternDigits, formatDate, formatDzd } from '../i18n/format.js';
import type {
  Course,
  ChargilyCardMethod,
  ChargilyCheckout,
  InstallmentItem,
} from '../types/index.js';

interface ChargilyCheckoutModalProps {
  courses: Course[];
  initialCourseId?: string;
  installmentItem?: InstallmentItem | null;
  allowInstallments?: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export const ChargilyCheckoutModal: React.FC<ChargilyCheckoutModalProps> = ({
  courses,
  initialCourseId,
  installmentItem,
  allowInstallments = true,
  onSuccess,
  onClose,
}) => {
  const { t } = useTranslation();
  const { language, isRtl } = useAuth();

  const [courseId, setCourseId] = useState<string>(
    installmentItem?.courseId || initialCourseId || courses[0]?.id || ''
  );
  const [cardMethod, setCardMethod] = useState<ChargilyCardMethod>('edahabia');
  const [installmentsCount, setInstallmentsCount] = useState<number>(1);

  const [creating, setCreating] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [checkout, setCheckout] = useState<ChargilyCheckout | null>(null);
  const [paidInvoiceNumber, setPaidInvoiceNumber] = useState<string | null>(null);
  const [lastPaidEventId, setLastPaidEventId] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sessionIdempotencySeed = useMemo(
    () => `idem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    []
  );

  const selectedCourse = courses.find((c) => c.id === courseId) || courses[0];
  const fullPrice = selectedCourse?.priceDzd || 6500;
  const amountDueNow = installmentItem
    ? installmentItem.amountDzd
    : installmentsCount > 1
    ? Math.floor(fullPrice / installmentsCount)
    : fullPrice;

  const idempotencyKey = `${sessionIdempotencySeed}_${courseId}_${cardMethod}_${installmentItem?.id || installmentsCount}`;

  const handleInitCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId) return;
    setErrorMsg(null);
    setDuplicateInfo(null);
    setCreating(true);
    try {
      const res = await api.createChargilyCheckout({
        courseId,
        cardMethod,
        ...(installmentItem ? { installmentItemId: installmentItem.id } : {}),
        ...(!installmentItem && installmentsCount > 1 ? { installmentsCount } : {}),
        idempotencyKey,
        locale: language,
      });
      setCheckout(res.checkout);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur Chargily Pay');
    } finally {
      setCreating(false);
    }
  };

  const handleSandboxOutcome = async (outcome: 'paid' | 'failed') => {
    if (!checkout) return;
    setErrorMsg(null);
    setDuplicateInfo(null);
    setSimulating(true);
    try {
      const res = await api.simulateChargilySandbox(checkout.id, {
        outcome,
        ...(outcome === 'failed'
          ? { failureReason: 'Solde insuffisant ou plafond carte atteint (Code SATIM 51)' }
          : {}),
      });
      if (outcome === 'paid') {
        setPaidInvoiceNumber(res.invoiceNumber || null);
        setLastPaidEventId(res.eventId || null);
        setCheckout({ ...checkout, status: 'PAID' });
        onSuccess();
      } else {
        setCheckout({ ...checkout, status: 'FAILED' });
        setErrorMsg(
          t('billing.chargilyModal.failedMsg', {
            reason: 'Solde insuffisant ou plafond carte atteint (SATIM 51)',
          })
        );
        onSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSimulating(false);
    }
  };

  const handleTestDuplicateWebhook = async () => {
    if (!checkout || !lastPaidEventId) return;
    setSimulating(true);
    setErrorMsg(null);
    try {
      const res = await api.simulateChargilySandbox(checkout.id, {
        outcome: 'paid',
        eventIdOverride: lastPaidEventId,
      });
      if (res.duplicate) {
        setDuplicateInfo(t('billing.chargilyModal.duplicateIgnoredMsg'));
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-800 my-auto">
        <div className="h-1.5 w-full bg-[var(--tenant-secondary)]" />

        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[var(--tenant-secondary)] shrink-0" />
              <span>{t('billing.chargilyModal.title')}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{t('billing.chargilyModal.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {!checkout ? (
            <form onSubmit={handleInitCheckout} className="space-y-4">
              {installmentItem ? (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 font-medium">
                  {t('billing.chargilyModal.payingInstallmentBanner', {
                    num: installmentItem.installmentNumber,
                    total: installmentItem.totalInstallments,
                    dueDate: formatDate(installmentItem.dueDate, language),
                  })}
                </div>
              ) : (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('billing.chargilyModal.courseLabel')}
                  </label>
                  <select
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 font-medium"
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} — {formatDzd(c.priceDzd, language)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Card network selector: Edahabia vs CIB */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">
                  {t('billing.chargilyModal.cardNetworkLabel')}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCardMethod('edahabia')}
                    className={`p-3.5 rounded-xl border text-start transition-all ${
                      cardMethod === 'edahabia'
                        ? 'border-[var(--tenant-secondary)] bg-blue-50/60 ring-1 ring-[var(--tenant-secondary)]'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <span className="font-bold text-slate-900 block">
                      {t('billing.chargilyModal.edahabiaTitle')}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-0.5 block">
                      {t('billing.chargilyModal.edahabiaDesc')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCardMethod('cib')}
                    className={`p-3.5 rounded-xl border text-start transition-all ${
                      cardMethod === 'cib'
                        ? 'border-[var(--tenant-secondary)] bg-blue-50/60 ring-1 ring-[var(--tenant-secondary)]'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <span className="font-bold text-slate-900 block">
                      {t('billing.chargilyModal.cibTitle')}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-0.5 block">
                      {t('billing.chargilyModal.cibDesc')}
                    </span>
                  </button>
                </div>
              </div>

              {/* Payment schedule selector: 1x or 2x/3x/4x */}
              {!installmentItem && allowInstallments && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('billing.chargilyModal.scheduleModeLabel')}
                  </label>
                  <select
                    value={installmentsCount}
                    onChange={(e) => setInstallmentsCount(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 font-medium"
                  >
                    <option value={1}>{t('billing.chargilyModal.oneTimeOption')}</option>
                    <option value={2}>{t('billing.chargilyModal.installment2x')}</option>
                    <option value={3}>{t('billing.chargilyModal.installment3x')}</option>
                    <option value={4}>{t('billing.chargilyModal.installment4x')}</option>
                  </select>
                </div>
              )}

              {/* Summary box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-4">
                <div>
                  <span className="text-slate-500 block">
                    {t('billing.chargilyModal.amountDueNow')}
                  </span>
                  {!installmentItem && installmentsCount > 1 && (
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {t('billing.chargilyModal.totalCoursePrice', {
                        amount: formatDzd(fullPrice, language),
                      })}
                    </span>
                  )}
                </div>
                <span className="text-lg font-extrabold font-mono tabular-nums text-[var(--tenant-primary)] ltr-num">
                  {formatDzd(amountDueNow, language)}
                </span>
              </div>

              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-opacity disabled:opacity-60 shadow-xs"
                >
                  {creating
                    ? t('billing.chargilyModal.initializing')
                    : t('billing.chargilyModal.initCheckoutBtn', {
                        amount: formatDzd(amountDueNow, language),
                      })}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {/* Checkout Created Header */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      {checkout.isLiveApi
                        ? t('billing.chargilyModal.liveBadge')
                        : t('billing.chargilyModal.sandboxBadge')}
                    </span>
                  </span>
                  <span className="font-mono font-bold text-slate-900 text-sm ltr-num">
                    {formatDzd(checkout.amountDzd, language)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono space-y-0.5">
                  <p>
                    {t('billing.chargilyModal.checkoutIdLabel')}{' '}
                    <span className="text-slate-800 ltr-num">
                      {ensureWesternDigits(checkout.id)}
                    </span>
                  </p>
                  {checkout.idempotencyKey && (
                    <p>
                      {t('billing.chargilyModal.idempotencyLabel')}{' '}
                      <span className="text-slate-700 ltr-num">
                        {ensureWesternDigits(checkout.idempotencyKey)}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {checkout.status === 'PAID' ? (
                <div className="space-y-4">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1.5 text-emerald-900">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <span>{t('billing.chargilyModal.paidSuccessTitle')}</span>
                    </div>
                    <p className="text-xs leading-relaxed">
                      {t('billing.chargilyModal.paidSuccessDesc')}
                    </p>
                    {paidInvoiceNumber && (
                      <p className="font-mono font-bold text-emerald-800 pt-1 ltr-num">
                        {t('billing.invoices.sequentialNo')} {ensureWesternDigits(paidInvoiceNumber)}
                      </p>
                    )}
                  </div>

                  {duplicateInfo && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs">
                      {duplicateInfo}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                    {lastPaidEventId && !checkout.isLiveApi && (
                      <button
                        type="button"
                        disabled={simulating}
                        onClick={handleTestDuplicateWebhook}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>{t('billing.chargilyModal.testDuplicateBtn')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-5 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors ms-auto"
                    >
                      {t('common.close')}
                    </button>
                  </div>
                </div>
              ) : checkout.isLiveApi ? (
                <div className="space-y-4">
                  <a
                    href={checkout.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 px-4 flex items-center justify-center gap-2 font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-opacity"
                  >
                    <span>{t('billing.chargilyModal.openExternalCheckout')}</span>
                    <ExternalLink className="w-4 h-4 rtl-flip" />
                  </a>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-slate-600 leading-relaxed">
                    {t('billing.chargilyModal.sandboxExplain')}
                  </p>

                  {errorMsg && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={simulating}
                      onClick={() => handleSandboxOutcome('paid')}
                      className="py-2.5 px-4 font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors disabled:opacity-60"
                    >
                      {simulating
                        ? t('billing.chargilyModal.processingWebhook')
                        : t('billing.chargilyModal.confirmPaidBtn')}
                    </button>

                    <button
                      type="button"
                      disabled={simulating}
                      onClick={() => handleSandboxOutcome('failed')}
                      className="py-2.5 px-4 font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors disabled:opacity-60"
                    >
                      {t('billing.chargilyModal.simulateFailBtn')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
