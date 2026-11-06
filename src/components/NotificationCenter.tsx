/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Check, CheckCheck, Trash2, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { ensureWesternDigits, formatDateTime, formatNumber } from '../i18n/format.js';
import type {
  NotificationCategory,
  NotificationEntity,
  UserNotificationPreferences,
} from '../types/index.js';

const CATEGORY_ORDER: Array<'ALL' | NotificationCategory> = [
  'ALL',
  'PAYMENT_CONFIRMATION',
  'SUBSCRIPTION_EXPIRING_7D',
  'SESSION_REMINDER',
  'ACCOUNT_CREATED',
  'BILLING_REMINDER',
  'PASSWORD_RESET',
  'GENERAL',
];

export const NotificationCenter: React.FC = () => {
  const { t } = useTranslation();
  const { user, tenant, inspectedTenantId, language } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'inbox' | 'preferences'>('inbox');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | NotificationCategory>('ALL');

  const [notifications, setNotifications] = useState<NotificationEntity[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loadingList, setLoadingList] = useState<boolean>(false);

  const [preferences, setPreferences] = useState<UserNotificationPreferences | null>(null);
  const [savingPrefs, setSavingPrefs] = useState<boolean>(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoadingList(true);
    try {
      const res = await api.getNotifications({
        unreadOnly,
        category: categoryFilter,
        limit: 50,
      });
      setNotifications(res.notifications || []);
      setUnreadCount(typeof res.unreadCount === 'number' ? res.unreadCount : 0);
    } catch {
      // Quietly ignore background polling transient issues
    } finally {
      setLoadingList(false);
    }
  }, [user, unreadOnly, categoryFilter]);

  const fetchPreferences = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.getNotificationPreferences();
      setPreferences(res.preferences);
    } catch {
      // Ignore
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(() => {
      fetchNotifications();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications, tenant?.id, inspectedTenantId]);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
      fetchPreferences();
      setFeedbackBanner(null);
    }
  }, [isOpen, fetchNotifications, fetchPreferences]);

  const handleMarkRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, read: true, readAt: new Date().toISOString() } : item
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', message: err.message });
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      const nowIso = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((item) => ({ ...item, read: true, readAt: item.readAt || nowIso }))
      );
      setUnreadCount(0);
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', message: err.message });
    }
  };

  const handleDelete = async (notif: NotificationEntity) => {
    try {
      await api.deleteNotification(notif.id);
      setNotifications((prev) => prev.filter((item) => item.id !== notif.id));
      if (!notif.read) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', message: err.message });
    }
  };

  const togglePrefField = (
    key: keyof Omit<
      UserNotificationPreferences,
      'userId' | 'tenantId' | 'emailPasswordReset' | 'updatedAt'
    >
  ) => {
    if (!preferences) return;
    setPreferences({
      ...preferences,
      [key]: !preferences[key],
    });
    setFeedbackBanner(null);
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preferences) return;
    setSavingPrefs(true);
    setFeedbackBanner(null);
    try {
      const res = await api.updateNotificationPreferences({
        emailPaymentConfirmation: preferences.emailPaymentConfirmation,
        inAppPaymentConfirmation: preferences.inAppPaymentConfirmation,
        emailSubscriptionExpiring: preferences.emailSubscriptionExpiring,
        inAppSubscriptionExpiring: preferences.inAppSubscriptionExpiring,
        emailSessionReminder: preferences.emailSessionReminder,
        inAppSessionReminder: preferences.inAppSessionReminder,
        emailAccountCreated: preferences.emailAccountCreated,
        inAppAccountCreated: preferences.inAppAccountCreated,
        emailInstallmentReminder: preferences.emailInstallmentReminder,
        inAppInstallmentReminder: preferences.inAppInstallmentReminder,
      });
      setPreferences(res.preferences);
      setFeedbackBanner({
        type: 'success',
        message: t('notificationsCenter.preferences.savedMsg'),
      });
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', message: err.message });
    } finally {
      setSavingPrefs(false);
    }
  };

  const translateCategory = (cat?: NotificationCategory) => {
    const key = cat || 'GENERAL';
    return t(`notificationsCenter.categories.${key}`, {
      defaultValue: t('notificationsCenter.categories.GENERAL'),
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={
          unreadCount > 0
            ? t('notificationsCenter.unreadAria', { count: formatNumber(unreadCount, language) })
            : t('notificationsCenter.triggerLabel')
        }
        title={t('notificationsCenter.triggerLabel')}
        className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        <Bell className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden md:inline">{t('notificationsCenter.triggerLabel')}</span>
        {unreadCount > 0 && (
          <span className="px-1.5 py-0.2 bg-amber-400 text-slate-950 font-mono font-bold text-[11px] rounded-md tabular-nums ltr-num">
            {formatNumber(unreadCount, language)}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/55 backdrop-blur-xs"
          onClick={() => setIsOpen(false)}
        >
          <aside
            className="w-full max-w-lg bg-white h-full shadow-2xl border-s border-slate-200 flex flex-col text-slate-900 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4 shrink-0">
              <div className="space-y-0.5">
                <h2 className="text-base font-bold text-slate-900">
                  {t('notificationsCenter.title')}
                </h2>
                <p className="text-xs text-slate-500">{t('notificationsCenter.subtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label={t('notificationsCenter.closeBtn')}
                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Segmented Mode Control: Inbox vs Preferences */}
            <div className="px-6 pt-4 pb-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap shrink-0">
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActiveTab('inbox')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    activeTab === 'inbox'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t('notificationsCenter.tabInbox')}
                  {unreadCount > 0 ? (
                    <span className="ms-1.5 font-mono tabular-nums ltr-num text-blue-700">
                      ({formatNumber(unreadCount, language)})
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preferences')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    activeTab === 'preferences'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>{t('notificationsCenter.tabPreferences')}</span>
                </button>
              </div>

              {activeTab === 'inbox' && (
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>{t('notificationsCenter.markAllReadBtn')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={fetchNotifications}
                    title={t('notificationsCenter.refreshBtn')}
                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              )}
            </div>

            {feedbackBanner && (
              <div
                className={`mx-6 mt-3 px-3.5 py-2.5 rounded-xl border text-xs font-medium shrink-0 ${
                  feedbackBanner.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                {feedbackBanner.message}
              </div>
            )}

            {/* TAB 1: INBOX STREAM */}
            {activeTab === 'inbox' && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Filter Bar */}
                <div className="px-6 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 shrink-0">
                  <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setUnreadOnly(false)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        !unreadOnly
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {t('notificationsCenter.filterAll')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnreadOnly(true)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        unreadOnly
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {t('notificationsCenter.filterUnread', {
                        count: formatNumber(unreadCount, language),
                      })}
                    </button>
                  </div>

                  <select
                    value={categoryFilter}
                    onChange={(e) =>
                      setCategoryFilter(e.target.value as 'ALL' | NotificationCategory)
                    }
                    className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-blue-500"
                  >
                    {CATEGORY_ORDER.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat === 'ALL'
                          ? t('notificationsCenter.categoryAll')
                          : translateCategory(cat)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Notifications List */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="p-10 text-center text-xs text-slate-500">
                      {unreadOnly
                        ? t('notificationsCenter.emptyUnread')
                        : t('notificationsCenter.emptyAll')}
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`px-6 py-4 transition-colors ${
                          notif.read ? 'bg-white' : 'bg-blue-50/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0 flex-1">
                            {/* Clean unboxed metadata row */}
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                              <span
                                className={
                                  notif.read
                                    ? 'text-slate-500'
                                    : 'font-semibold text-blue-700'
                                }
                              >
                                {notif.read
                                  ? t('notificationsCenter.readState')
                                  : t('notificationsCenter.unreadState')}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{translateCategory(notif.category)}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums ltr-num">
                                {formatDateTime(notif.createdAt, language)}
                              </span>
                            </div>

                            <h3
                              className={`text-xs leading-snug ${
                                notif.read
                                  ? 'font-semibold text-slate-800'
                                  : 'font-bold text-slate-950'
                              }`}
                            >
                              {ensureWesternDigits(notif.title)}
                            </h3>

                            <p className="text-xs text-slate-600 leading-relaxed">
                              {ensureWesternDigits(notif.message)}
                            </p>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {!notif.read && (
                              <button
                                type="button"
                                onClick={() => handleMarkRead(notif.id)}
                                title={t('notificationsCenter.markReadBtn')}
                                className="p-1.5 text-blue-700 hover:bg-blue-100/70 rounded-lg transition-colors cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDelete(notif)}
                              title={t('notificationsCenter.deleteBtn')}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: PER-USER NOTIFICATION PREFERENCES */}
            {activeTab === 'preferences' && preferences && (
              <form
                onSubmit={handleSavePreferences}
                className="flex-1 overflow-y-auto p-6 space-y-5 text-xs"
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    {t('notificationsCenter.preferences.title')}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {t('notificationsCenter.preferences.subtitle')}
                  </p>
                </div>

                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                  {/* Row 1: Password Reset (Always active for security) */}
                  <div className="p-4 bg-slate-50/70 flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-900 block">
                        {t('notificationsCenter.preferences.rows.passwordResetTitle')}
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        {t('notificationsCenter.preferences.rows.passwordResetDesc')}
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500 shrink-0">
                      {t('notificationsCenter.preferences.alwaysOnSecurity')}
                    </span>
                  </div>

                  {/* Row 2: Payment Confirmation */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-900 block">
                        {t('notificationsCenter.preferences.rows.paymentConfirmationTitle')}
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        {t('notificationsCenter.preferences.rows.paymentConfirmationDesc')}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.emailPaymentConfirmation}
                          onChange={() => togglePrefField('emailPaymentConfirmation')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelEmail')}
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.inAppPaymentConfirmation}
                          onChange={() => togglePrefField('inAppPaymentConfirmation')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelInApp')}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Row 3: Subscription Expiring in 7 Days */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-900 block">
                        {t('notificationsCenter.preferences.rows.subscriptionExpiringTitle')}
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        {t('notificationsCenter.preferences.rows.subscriptionExpiringDesc')}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.emailSubscriptionExpiring}
                          onChange={() => togglePrefField('emailSubscriptionExpiring')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelEmail')}
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.inAppSubscriptionExpiring}
                          onChange={() => togglePrefField('inAppSubscriptionExpiring')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelInApp')}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Row 4: Session Reminder */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-900 block">
                        {t('notificationsCenter.preferences.rows.sessionReminderTitle')}
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        {t('notificationsCenter.preferences.rows.sessionReminderDesc')}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.emailSessionReminder}
                          onChange={() => togglePrefField('emailSessionReminder')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelEmail')}
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.inAppSessionReminder}
                          onChange={() => togglePrefField('inAppSessionReminder')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelInApp')}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Row 5: Account Created */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-900 block">
                        {t('notificationsCenter.preferences.rows.accountCreatedTitle')}
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        {t('notificationsCenter.preferences.rows.accountCreatedDesc')}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.emailAccountCreated}
                          onChange={() => togglePrefField('emailAccountCreated')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelEmail')}
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.inAppAccountCreated}
                          onChange={() => togglePrefField('inAppAccountCreated')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelInApp')}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Row 6: Installment & Billing Reminders */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-900 block">
                        {t('notificationsCenter.preferences.rows.installmentReminderTitle')}
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        {t('notificationsCenter.preferences.rows.installmentReminderDesc')}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.emailInstallmentReminder}
                          onChange={() => togglePrefField('emailInstallmentReminder')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelEmail')}
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.inAppInstallmentReminder}
                          onChange={() => togglePrefField('inAppInstallmentReminder')}
                          className="rounded text-blue-600"
                        />
                        <span className="text-slate-700">
                          {t('notificationsCenter.preferences.channelInApp')}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingPrefs}
                    className="px-5 py-2.5 text-xs font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-opacity disabled:opacity-50 cursor-pointer"
                  >
                    {savingPrefs
                      ? t('common.saving')
                      : t('notificationsCenter.preferences.saveBtn')}
                  </button>
                </div>
              </form>
            )}
          </aside>
        </div>
      )}
    </>
  );
};
