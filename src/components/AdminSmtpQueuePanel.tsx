/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Eye, Mail, Play, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { ensureWesternDigits, formatDateTime, formatNumber } from '../i18n/format.js';
import type {
  EmailQueueItem,
  EmailQueueStats,
  EmailQueueStatus,
  EmailTemplateType,
  IntegrationSetting,
} from '../types/index.js';

interface AdminSmtpQueuePanelProps {
  smtpIntegration?: IntegrationSetting;
  onBanner: (banner: { type: 'success' | 'error'; message: string } | null) => void;
  onConfigSaved?: () => void;
}

const TEMPLATE_TYPES: EmailTemplateType[] = [
  'PASSWORD_RESET',
  'PAYMENT_CONFIRMATION',
  'SUBSCRIPTION_EXPIRING_7D',
  'SESSION_REMINDER',
  'ACCOUNT_CREATED',
];

const QUEUE_STATUSES: Array<'ALL' | EmailQueueStatus> = [
  'ALL',
  'SENT',
  'PENDING',
  'RETRY_SCHEDULED',
  'FAILED',
  'PROCESSING',
];

export const AdminSmtpQueuePanel: React.FC<AdminSmtpQueuePanelProps> = ({
  smtpIntegration,
  onBanner,
  onConfigSaved,
}) => {
  const { t } = useTranslation();
  const { user, tenant, inspectedTenantId, language } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  // SMTP Configuration Form State
  const [smtpEnabled, setSmtpEnabled] = useState<boolean>(true);
  const [smtpTestMode, setSmtpTestMode] = useState<boolean>(true);
  const [smtpHost, setSmtpHost] = useState<string>('smtp.najahlearn.dz');
  const [smtpPort, setSmtpPort] = useState<string>('587');
  const [smtpSecure, setSmtpSecure] = useState<boolean>(false);
  const [smtpUser, setSmtpUser] = useState<string>('');
  const [smtpPass, setSmtpPass] = useState<string>('');
  const [smtpFromName, setSmtpFromName] = useState<string>('');
  const [smtpFromEmail, setSmtpFromEmail] = useState<string>('');
  const [smtpReplyTo, setSmtpReplyTo] = useState<string>('');
  const [savingSmtp, setSavingSmtp] = useState<boolean>(false);

  // Template Tester State
  const [testTemplateType, setTestTemplateType] = useState<EmailTemplateType>('PAYMENT_CONFIRMATION');
  const [testLocale, setTestLocale] = useState<'fr' | 'ar'>(language === 'ar' ? 'ar' : 'fr');
  const [testRecipient, setTestRecipient] = useState<string>(user?.email || '');
  const [sendingTest, setSendingTest] = useState<boolean>(false);

  // Queue State
  const [queueItems, setQueueItems] = useState<EmailQueueItem[]>([]);
  const [queueStats, setQueueStats] = useState<EmailQueueStats>({
    total: 0,
    pendingCount: 0,
    processingCount: 0,
    sentCount: 0,
    retryScheduledCount: 0,
    failedCount: 0,
  });
  const [statusFilter, setStatusFilter] = useState<'ALL' | EmailQueueStatus>('ALL');
  const [templateFilter, setTemplateFilter] = useState<'ALL' | EmailTemplateType>('ALL');
  const [loadingQueue, setLoadingQueue] = useState<boolean>(false);
  const [processingQueue, setProcessingQueue] = useState<boolean>(false);
  const [runningSweeps, setRunningSweeps] = useState<boolean>(false);

  // Preview Modal State
  const [previewItem, setPreviewItem] = useState<EmailQueueItem | null>(null);
  const [previewTab, setPreviewTab] = useState<'html' | 'text'>('html');

  useEffect(() => {
    if (smtpIntegration) {
      const cfg = smtpIntegration.config || {};
      setSmtpEnabled(smtpIntegration.isEnabled ?? true);
      setSmtpTestMode(smtpIntegration.isTestMode ?? true);
      setSmtpHost(cfg.host || 'smtp.najahlearn.dz');
      setSmtpPort(String(cfg.port || 587));
      setSmtpSecure(Boolean(cfg.secure));
      setSmtpUser(cfg.user || '');
      setSmtpPass(cfg.pass || cfg.smtpPass || '');
      setSmtpFromName(cfg.fromName || tenant?.name || 'NajahLearn Académie');
      setSmtpFromEmail(cfg.fromEmail || cfg.senderEmail || tenant?.contactEmail || '');
      setSmtpReplyTo(cfg.replyTo || tenant?.contactEmail || '');
    }
  }, [smtpIntegration, tenant?.name, tenant?.contactEmail]);

  useEffect(() => {
    if (user?.email && !testRecipient) {
      setTestRecipient(user.email);
    }
  }, [user?.email, testRecipient]);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const res = await api.getEmailQueue({
        status: statusFilter,
        templateType: templateFilter,
        limit: 80,
      });
      setQueueItems(res.items || []);
      if (res.stats) setQueueStats(res.stats);
    } catch {
      // Quietly handle if unauthorized or transient
    } finally {
      setLoadingQueue(false);
    }
  }, [statusFilter, templateFilter]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue, tenant?.id, inspectedTenantId]);

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingSmtp(true);
    onBanner(null);
    try {
      await api.updateIntegration('EMAIL_SMTP', {
        isEnabled: smtpEnabled,
        isTestMode: smtpTestMode,
        config: {
          host: smtpHost.trim(),
          port: Number(smtpPort) || 587,
          secure: smtpSecure,
          user: smtpUser.trim(),
          pass: smtpPass,
          fromName: smtpFromName.trim(),
          fromEmail: smtpFromEmail.trim(),
          replyTo: smtpReplyTo.trim(),
        },
      });
      onBanner({
        type: 'success',
        message: t('smtpQueue.smtpSavedMsg'),
      });
      onConfigSaved?.();
      loadQueue();
    } catch (err: any) {
      onBanner({ type: 'error', message: err.message });
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleSendTestTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSendingTest(true);
    onBanner(null);
    try {
      const res = await api.sendTestEmailTemplate({
        templateType: testTemplateType,
        locale: testLocale,
        recipientEmail: testRecipient.trim() || undefined,
      });
      await loadQueue();
      if (res.item) {
        setPreviewItem(res.item);
        setPreviewTab('html');
      }
      onBanner({
        type: 'success',
        message: t('smtpQueue.testSentMsg'),
      });
    } catch (err: any) {
      onBanner({ type: 'error', message: err.message });
    } finally {
      setSendingTest(false);
    }
  };

  const handleProcessNow = async () => {
    setProcessingQueue(true);
    onBanner(null);
    try {
      const res = await api.processEmailQueue({ forceDueNow: true, limit: 30 });
      await loadQueue();
      onBanner({
        type: 'success',
        message: t('smtpQueue.queueProcessedMsg', {
          sent: formatNumber(res.sentCount, language),
          retry: formatNumber(res.retryScheduledCount, language),
          failed: formatNumber(res.failedPermanentlyCount, language),
        }),
      });
    } catch (err: any) {
      onBanner({ type: 'error', message: err.message });
    } finally {
      setProcessingQueue(false);
    }
  };

  const handleRunSweeps = async () => {
    setRunningSweeps(true);
    onBanner(null);
    try {
      const res = await api.runEmailSweeps();
      await loadQueue();
      onBanner({
        type: 'success',
        message: t('smtpQueue.sweepsDoneMsg', {
          subQueued: formatNumber(res.subscriptionsSweep.emailsQueued, language),
          sesQueued: formatNumber(res.sessionsSweep.emailsQueued, language),
        }),
      });
    } catch (err: any) {
      onBanner({ type: 'error', message: err.message });
    } finally {
      setRunningSweeps(false);
    }
  };

  const handleOpenPreview = async (itemId: string) => {
    try {
      const res = await api.getEmailQueueItem(itemId);
      setPreviewItem(res.item);
      setPreviewTab('html');
    } catch (err: any) {
      onBanner({ type: 'error', message: err.message });
    }
  };

  const handleRetryItem = async (itemId: string) => {
    onBanner(null);
    try {
      await api.retryEmailQueueItem(itemId);
      await loadQueue();
      onBanner({
        type: 'success',
        message: t('smtpQueue.retriedMsg'),
      });
    } catch (err: any) {
      onBanner({ type: 'error', message: err.message });
    }
  };

  const statusTextColor = (status: EmailQueueStatus) => {
    switch (status) {
      case 'SENT':
        return 'text-emerald-700 font-semibold';
      case 'RETRY_SCHEDULED':
        return 'text-amber-700 font-semibold';
      case 'FAILED':
        return 'text-red-700 font-semibold';
      case 'PROCESSING':
        return 'text-blue-700 font-semibold';
      default:
        return 'text-slate-600 font-semibold';
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. SMTP SERVER CONFIGURATION & BILINGUAL TEMPLATE GENERATOR */}
      {isAdmin && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-900">
                {t('smtpQueue.smtpSectionTitle')}
              </h3>
              <p className="text-xs text-slate-500">{t('smtpQueue.smtpSectionSubtitle')}</p>
            </div>
            <span
              className={`text-xs font-mono font-bold ${
                !smtpEnabled
                  ? 'text-slate-500'
                  : smtpTestMode
                    ? 'text-blue-700'
                    : 'text-emerald-700'
              }`}
            >
              {!smtpEnabled
                ? t('smtpQueue.statusDisabled')
                : smtpTestMode
                  ? t('smtpQueue.statusSandbox')
                  : t('smtpQueue.statusLive')}
            </span>
          </div>

          <form onSubmit={handleSaveSmtp} className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center gap-6">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtpEnabled}
                  onChange={(e) => setSmtpEnabled(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span className="font-medium text-slate-800">{t('smtpQueue.enableCheck')}</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtpTestMode}
                  onChange={(e) => setSmtpTestMode(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span className="text-slate-700">{t('smtpQueue.sandboxCheck')}</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.hostLabel')}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.portLabel')}
                </label>
                <input
                  type="number"
                  dir="ltr"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smtpSecure}
                    onChange={(e) => setSmtpSecure(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span className="text-slate-700">{t('smtpQueue.secureCheck')}</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.userLabel')}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="apikey / scolarite@ecole.dz"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.passLabel')}
                </label>
                <input
                  type="password"
                  dir="ltr"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.fromNameLabel')}
                </label>
                <input
                  type="text"
                  value={smtpFromName}
                  onChange={(e) => setSmtpFromName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.fromEmailLabel')}
                </label>
                <input
                  type="email"
                  dir="ltr"
                  value={smtpFromEmail}
                  onChange={(e) => setSmtpFromEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.replyToLabel')}
                </label>
                <input
                  type="email"
                  dir="ltr"
                  value={smtpReplyTo}
                  onChange={(e) => setSmtpReplyTo(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={savingSmtp}
                className="px-4 py-2 text-xs font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-opacity disabled:opacity-50 cursor-pointer"
              >
                {savingSmtp ? t('common.saving') : t('smtpQueue.saveSmtpBtn')}
              </button>
            </div>
          </form>

          {/* Interactive 5-Template FR/AR Generator & Tester */}
          <div className="pt-5 border-t border-slate-100 space-y-3">
            <div>
              <h4 className="text-xs font-bold text-slate-900">{t('smtpQueue.testerTitle')}</h4>
              <p className="text-[11px] text-slate-500">{t('smtpQueue.testerSubtitle')}</p>
            </div>

            <form
              onSubmit={handleSendTestTemplate}
              className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end text-xs"
            >
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.templateLabel')}
                </label>
                <select
                  value={testTemplateType}
                  onChange={(e) => setTestTemplateType(e.target.value as EmailTemplateType)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  {TEMPLATE_TYPES.map((tpl) => (
                    <option key={tpl} value={tpl}>
                      {t(`smtpQueue.templates.${tpl}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.localeLabel')}
                </label>
                <select
                  value={testLocale}
                  onChange={(e) => setTestLocale(e.target.value as 'fr' | 'ar')}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  <option value="fr">{t('smtpQueue.localeFr')}</option>
                  <option value="ar">{t('smtpQueue.localeAr')}</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('smtpQueue.recipientLabel')}
                </label>
                <input
                  type="email"
                  dir="ltr"
                  required
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                />
              </div>

              <div>
                <button
                  type="submit"
                  disabled={sendingTest}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 rtl-flip" />
                  <span>
                    {sendingTest ? t('smtpQueue.sendingTestBtn') : t('smtpQueue.sendTestBtn')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. PERSISTENT TRANSACTIONAL EMAIL OUTBOX QUEUE & RETRY WORKER */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-slate-900">{t('smtpQueue.queueTitle')}</h3>
            <p className="text-xs text-slate-500">{t('smtpQueue.queueSubtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRunSweeps}
              disabled={runningSweeps}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{t('smtpQueue.runSweepsBtn')}</span>
            </button>

            <button
              type="button"
              onClick={handleProcessNow}
              disabled={processingQueue}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-opacity disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 rtl-flip" />
              <span>{t('smtpQueue.processNowBtn')}</span>
            </button>

            <button
              type="button"
              onClick={loadQueue}
              className="p-2 text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingQueue ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Queue Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-slate-500 block">{t('smtpQueue.statTotal')}</span>
            <span className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5 block ltr-num">
              {formatNumber(queueStats.total, language)}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-slate-500 block">{t('smtpQueue.statSent')}</span>
            <span className="text-base font-bold font-mono tabular-nums text-emerald-700 mt-0.5 block ltr-num">
              {formatNumber(queueStats.sentCount, language)}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-slate-500 block">{t('smtpQueue.statPending')}</span>
            <span className="text-base font-bold font-mono tabular-nums text-slate-800 mt-0.5 block ltr-num">
              {formatNumber(queueStats.pendingCount + queueStats.processingCount, language)}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-slate-500 block">{t('smtpQueue.statRetry')}</span>
            <span className="text-base font-bold font-mono tabular-nums text-amber-700 mt-0.5 block ltr-num">
              {formatNumber(queueStats.retryScheduledCount, language)}
            </span>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-slate-500 block">{t('smtpQueue.statFailed')}</span>
            <span className="text-base font-bold font-mono tabular-nums text-red-700 mt-0.5 block ltr-num">
              {formatNumber(queueStats.failedCount, language)}
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | EmailQueueStatus)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
          >
            {QUEUE_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st === 'ALL' ? t('smtpQueue.filterStatusAll') : t(`smtpQueue.statuses.${st}`)}
              </option>
            ))}
          </select>

          <select
            value={templateFilter}
            onChange={(e) => setTemplateFilter(e.target.value as 'ALL' | EmailTemplateType)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
          >
            <option value="ALL">{t('smtpQueue.filterTemplateAll')}</option>
            {TEMPLATE_TYPES.map((tpl) => (
              <option key={tpl} value={tpl}>
                {t(`smtpQueue.templates.${tpl}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Outbox Table */}
        {queueItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-100">
            {t('smtpQueue.emptyQueue')}
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold text-start">
                    {t('smtpQueue.colRecipient')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-start">
                    {t('smtpQueue.colTemplate')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-start">
                    {t('smtpQueue.colSubject')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-start">
                    {t('smtpQueue.colAttempts')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-start">
                    {t('smtpQueue.colStatus')}
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-end">
                    {t('smtpQueue.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queueItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 align-top">
                      <span className="font-semibold text-slate-900 block">
                        {ensureWesternDigits(item.recipientName)}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 ltr-num">
                        {item.recipientEmail}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="text-slate-800 block">
                        {t(`smtpQueue.templates.${item.templateType}`)}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono uppercase ltr-num">
                        {item.locale.toUpperCase()} · {formatDateTime(item.createdAt, language)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top max-w-xs">
                      <span className="text-slate-800 font-medium line-clamp-2">
                        {ensureWesternDigits(item.subject)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top font-mono tabular-nums ltr-num text-slate-700">
                      {formatNumber(item.attempts, language)} /{' '}
                      {formatNumber(item.maxAttempts, language)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={statusTextColor(item.status)}>
                            {t(`smtpQueue.statuses.${item.status}`)}
                          </span>
                          {item.deliveryMode && (
                            <>
                              <span aria-hidden="true" className="text-slate-400">
                                ·
                              </span>
                              <span className="text-[11px] text-slate-500">
                                {item.deliveryMode === 'SMTP_LIVE'
                                  ? t('smtpQueue.deliveryLive')
                                  : t('smtpQueue.deliverySandbox')}
                              </span>
                            </>
                          )}
                        </div>
                        {item.status === 'RETRY_SCHEDULED' && (
                          <span className="text-[11px] text-amber-700 block font-mono ltr-num">
                            {t('smtpQueue.nextAttemptAt', {
                              date: formatDateTime(item.nextAttemptAt, language),
                            })}
                          </span>
                        )}
                        {item.lastError && (
                          <span className="text-[11px] text-red-600 block line-clamp-2">
                            {t('smtpQueue.lastErrorLabel', {
                              error: ensureWesternDigits(item.lastError),
                            })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-end">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenPreview(item.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{t('smtpQueue.previewBtn')}</span>
                        </button>
                        {(item.status === 'FAILED' ||
                          item.status === 'RETRY_SCHEDULED' ||
                          item.status === 'PENDING') && (
                          <button
                            type="button"
                            onClick={() => handleRetryItem(item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{t('smtpQueue.retryBtn')}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sandboxed HTML Email Preview Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4 shrink-0">
              <div className="space-y-0.5 min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">
                  {t('smtpQueue.previewModalTitle')} — {ensureWesternDigits(previewItem.subject)}
                </h3>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className="font-mono ltr-num">{previewItem.recipientEmail}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t(`smtpQueue.templates.${previewItem.templateType}`)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono uppercase ltr-num">{previewItem.locale}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPreviewTab('html')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    previewTab === 'html'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t('smtpQueue.previewTabHtml')}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('text')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    previewTab === 'text'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t('smtpQueue.previewTabText')}
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto flex-1 bg-slate-100/70">
              {previewTab === 'html' ? (
                <iframe
                  sandbox=""
                  srcDoc={previewItem.htmlBody || ''}
                  title={previewItem.subject}
                  className="w-full h-[500px] bg-white rounded-xl border border-slate-200"
                />
              ) : (
                <pre
                  dir={previewItem.locale === 'ar' ? 'rtl' : 'ltr'}
                  className="w-full p-4 bg-white rounded-xl border border-slate-200 text-xs text-slate-800 whitespace-pre-wrap font-mono leading-relaxed"
                >
                  {previewItem.textBody || ''}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
