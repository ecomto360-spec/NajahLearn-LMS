/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Users,
  CreditCard,
  BookOpen,
  BarChart3,
  Upload,
  Download,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  RotateCcw,
  Search,
  Settings,
  Video,
  ShieldCheck,
  Check,
  Building,
  GraduationCap,
  TrendingUp,
  Clock,
  Activity,
  ChevronRight,
  RefreshCw,
  FileText,
  Bell,
  Copy,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { ReceiptModal } from './ReceiptModal.js';
import { InvoiceModal } from './InvoiceModal.js';
import { LiveClassroomModal } from './LiveClassroomModal.js';
import { AdminSmtpQueuePanel } from './AdminSmtpQueuePanel.js';
import {
  formatDzd,
  formatNumber,
  formatPercent,
  formatDate,
  formatDateTime,
  formatTime,
  ensureWesternDigits,
} from '../i18n/format.js';
import { translatePaymentMethod, translateStatus } from '../i18n/index.js';
import type {
  DashboardStats,
  Course,
  Payment,
  SessionEntity,
  AutomatedTestCaseResult,
  AuditLog,
  IntegrationSetting,
  Tenant,
  TenantSubscription,
  InstallmentPlan,
  PaymentReminder,
  Invoice,
} from '../types/index.js';

export const AdminPortal: React.FC = () => {
  const { t } = useTranslation();
  const { user, tenant, inspectedTenantId, refreshUser, refreshPublicTenants, language } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'courses' | 'payments' | 'sessions' | 'branding' | 'security' | 'tests'>('dashboard');
  const [dashboardMetricTab, setDashboardMetricTab] = useState<'revenue' | 'enrollments'>('revenue');

  // Core Data
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sessions, setSessions] = useState<SessionEntity[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationSetting[]>([]);
  const [installmentPlans, setInstallmentPlans] = useState<InstallmentPlan[]>([]);
  const [reminders, setReminders] = useState<PaymentReminder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentSubTab, setPaymentSubTab] = useState<'transactions' | 'installments' | 'reminders' | 'invoices'>('transactions');
  const [loading, setLoading] = useState<boolean>(true);

  // Search & Filter
  const [studentSearch, setStudentSearch] = useState('');
  const [studentStatusFilter, setStudentStatusFilter] = useState('ALL');

  // Modals state
  const [selectedReceipt, setSelectedReceipt] = useState<Payment | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [refundTargetPayment, setRefundTargetPayment] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundReason, setRefundReason] = useState<string>('');
  const [refundSubmitting, setRefundSubmitting] = useState<boolean>(false);
  const [showCreatePlanModal, setShowCreatePlanModal] = useState<boolean>(false);
  const [planStudentId, setPlanStudentId] = useState<string>('');
  const [planCourseId, setPlanCourseId] = useState<string>('');
  const [planCount, setPlanCount] = useState<string>('3');
  const [planIntervalDays, setPlanIntervalDays] = useState<string>('30');
  const [planFirstDueDate, setPlanFirstDueDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [planTotalAmount, setPlanTotalAmount] = useState<string>('');
  const [planNotes, setPlanNotes] = useState<string>('');
  const [runningReminders, setRunningReminders] = useState<boolean>(false);
  const [showCreateStudentModal, setShowCreateStudentModal] = useState(false);
  const [showCreatePaymentModal, setShowCreatePaymentModal] = useState(false);
  const [showCreateSessionModal, setShowCreateSessionModal] = useState(false);
  const [showImportCsvModal, setShowImportCsvModal] = useState(false);
  const [selectedStudentDrawer, setSelectedStudentDrawer] = useState<any | null>(null);

  // Live video modal
  const [activeLiveSession, setActiveLiveSession] = useState<{ session: SessionEntity; joinData: any } | null>(null);

  // Test Suite State
  const [testResults, setTestResults] = useState<{
    success: boolean;
    totalPassed: number;
    totalTests: number;
    durationMs: number;
    results: AutomatedTestCaseResult[];
  } | null>(null);
  const [runningTests, setRunningTests] = useState<boolean>(false);
  const [adminBanner, setAdminBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // CSV Import State
  const [csvContent, setCsvContent] = useState<string>('');
  const [csvPreviewReport, setCsvPreviewReport] = useState<any | null>(null);

  // New Student Form
  const [newStuName, setNewStuName] = useState('');
  const [newStuEmail, setNewStuEmail] = useState('');
  const [newStuPhone, setNewStuPhone] = useState('');
  const [newStuWilaya, setNewStuWilaya] = useState('16 - Alger');
  const [newStuCity, setNewStuCity] = useState('Alger');
  const [newStuClassId, setNewStuClassId] = useState('');

  // New Payment Form
  const [newPayStudentId, setNewPayStudentId] = useState('');
  const [newPayCourseId, setNewPayCourseId] = useState('');
  const [newPayAmount, setNewPayAmount] = useState('17500');
  const [newPayMethod, setNewPayMethod] = useState('BARIDIMOB_CCP');
  const [newPayRef, setNewPayRef] = useState('');

  // New Session Form
  const [newSesTitle, setNewSesTitle] = useState('');
  const [newSesClassId, setNewSesClassId] = useState('');
  const [newSesCourseId, setNewSesCourseId] = useState('');
  const [newSesDate, setNewSesDate] = useState('');
  const [newSesDuration, setNewSesDuration] = useState('90');

  // Integrations Form State
  const [zoomAccountId, setZoomAccountId] = useState('');
  const [zoomClientId, setZoomClientId] = useState('');
  const [zoomClientSecret, setZoomClientSecret] = useState('');
  const [zoomTestMode, setZoomTestMode] = useState(true);

  // Chargily Pay V2 Integration Form State
  const [chargilyEnabled, setChargilyEnabled] = useState(true);
  const [chargilyTestMode, setChargilyTestMode] = useState(true);
  const [chargilyPublicKey, setChargilyPublicKey] = useState('');
  const [chargilySecretKey, setChargilySecretKey] = useState('');
  const [chargilyWebhookSecret, setChargilyWebhookSecret] = useState('');
  const [chargilyWebhookUrl, setChargilyWebhookUrl] = useState('');
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);

  // Establishment Branding & Settings State
  const [tenantDetails, setTenantDetails] = useState<Tenant | null>(null);
  const [tenantUsage, setTenantUsage] = useState<{
    studentsCount: number;
    maxStudents: number;
    teachersCount: number;
    maxTeachers: number;
    coursesCount: number;
  } | null>(null);
  const [tenantContracts, setTenantContracts] = useState<TenantSubscription[]>([]);
  const [savingBranding, setSavingBranding] = useState(false);
  const [headerLogoFailed, setHeaderLogoFailed] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [brandShortName, setBrandShortName] = useState('');
  const [brandTagline, setBrandTagline] = useState('');
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandPrimaryColor, setBrandPrimaryColor] = useState('#101B33');
  const [brandSecondaryColor, setBrandSecondaryColor] = useState('#2457C5');
  const [brandAccentColor, setBrandAccentColor] = useState('#16845B');
  const [brandEmail, setBrandEmail] = useState('');
  const [brandPhone, setBrandPhone] = useState('');
  const [brandAddress, setBrandAddress] = useState('');
  const [brandCity, setBrandCity] = useState('');
  const [brandWilaya, setBrandWilaya] = useState('');
  const [brandWebsite, setBrandWebsite] = useState('');
  const [brandAccreditation, setBrandAccreditation] = useState('');
  const [brandTaxId, setBrandTaxId] = useState('');
  const [brandNif, setBrandNif] = useState('');
  const [brandNis, setBrandNis] = useState('');
  const [brandRc, setBrandRc] = useState('');
  const [brandArticleImposition, setBrandArticleImposition] = useState('');
  const [brandTvaApplicable, setBrandTvaApplicable] = useState(false);
  const [brandTvaRatePercent, setBrandTvaRatePercent] = useState(0);
  const [brandInvoicePrefix, setBrandInvoicePrefix] = useState('FAC-NL');
  const [brandInvoiceFooter, setBrandInvoiceFooter] = useState('');
  const [brandReceiptPrefix, setBrandReceiptPrefix] = useState('REC');
  const [brandReceiptFooter, setBrandReceiptFooter] = useState('');
  const [brandSupportHours, setBrandSupportHours] = useState('');
  const [brandEnforceSingleSession, setBrandEnforceSingleSession] = useState(true);
  const [brandAllowManualPayments, setBrandAllowManualPayments] = useState(true);
  const [brandAllowInstallments, setBrandAllowInstallments] = useState(true);
  const [brandAutoRemindersEnabled, setBrandAutoRemindersEnabled] = useState(true);
  const [brandReminderDaysBeforeDue, setBrandReminderDaysBeforeDue] = useState(3);
  const [brandReminderDaysAfterOverdue, setBrandReminderDaysAfterOverdue] = useState(1);

  const loadAllData = async () => {
    setLoading(true);
    setHeaderLogoFailed(false);
    try {
      const [statsRes, stuRes, clsRes, crsRes, payRes, sesRes, logRes, intRes, tntRes, instRes, remRes, invRes] = await Promise.all([
        api.getDashboardStats(),
        api.getStudents(),
        api.getClasses(),
        api.getCourses(),
        api.getPayments(),
        api.getSessionsList(),
        api.getAuditLogs(),
        api.getIntegrations(),
        api.getTenantSettings().catch(() => null),
        api.getInstallments().catch(() => ({ plans: [] })),
        api.getPaymentReminders().catch(() => ({ reminders: [] })),
        api.getInvoices().catch(() => ({ invoices: [] })),
      ]);

      const loadedCourses = crsRes.courses || [];
      setStats(statsRes);
      setStudents(stuRes.students || []);
      setClasses(clsRes.classes || []);
      setCourses(loadedCourses);
      setPayments(payRes.payments || []);
      setSessions(sesRes.sessions || []);
      setAuditLogs(logRes.logs || []);
      setIntegrations(intRes.integrations || []);
      setInstallmentPlans(instRes.plans || []);
      setReminders(remRes.reminders || []);
      setInvoices(invRes.invoices || []);

      if (loadedCourses.length > 0) {
        setNewPayCourseId((prev) =>
          loadedCourses.some((c) => c.id === prev) ? prev : loadedCourses[0].id
        );
        setNewSesCourseId((prev) =>
          loadedCourses.some((c) => c.id === prev) ? prev : loadedCourses[0].id
        );
        setPlanCourseId((prev) =>
          loadedCourses.some((c) => c.id === prev) ? prev : loadedCourses[0].id
        );
      }

      if (tntRes?.tenant) {
        const tnt = tntRes.tenant;
        setTenantDetails(tnt);
        setTenantUsage(tntRes.usage || null);
        setTenantContracts(tntRes.contracts || []);
        setBrandName(tnt.name);
        setBrandShortName(tnt.shortName);
        setBrandTagline(tnt.tagline || '');
        setBrandLogoUrl(tnt.logoUrl || '');
        setBrandPrimaryColor(tnt.primaryColor);
        setBrandSecondaryColor(tnt.secondaryColor);
        setBrandAccentColor(tnt.accentColor);
        setBrandEmail(tnt.contactEmail);
        setBrandPhone(tnt.contactPhone);
        setBrandAddress(tnt.address);
        setBrandCity(tnt.city);
        setBrandWilaya(tnt.wilaya);
        setBrandWebsite(tnt.website || '');
        setBrandAccreditation(tnt.accreditationNumber || '');
        setBrandTaxId(tnt.taxId || '');
        setBrandNif(tnt.nif || tnt.taxId || '');
        setBrandNis(tnt.nis || '');
        setBrandRc(tnt.rc || '');
        setBrandArticleImposition(tnt.articleImposition || '');
        setBrandTvaApplicable(Boolean(tnt.tvaApplicable));
        setBrandTvaRatePercent(Number(tnt.tvaRatePercent ?? 0));
        setBrandInvoicePrefix(tnt.invoicePrefix || 'FAC-NL');
        setBrandInvoiceFooter(tnt.invoiceFooterNote || '');
        setBrandReceiptPrefix(tnt.settings?.receiptPrefix || 'REC');
        setBrandReceiptFooter(tnt.settings?.receiptFooterNote || '');
        setBrandSupportHours(tnt.settings?.supportHours || 'Dim–Jeu 08h30–17h00');
        setBrandEnforceSingleSession(tnt.settings?.enforceSingleStudentSession ?? true);
        setBrandAllowManualPayments(tnt.settings?.allowManualPayments ?? true);
        setBrandAllowInstallments(tnt.settings?.allowInstallments ?? true);
        setBrandAutoRemindersEnabled(tnt.settings?.autoRemindersEnabled ?? true);
        setBrandReminderDaysBeforeDue(Number(tnt.settings?.reminderDaysBeforeDue ?? 3));
        setBrandReminderDaysAfterOverdue(Number(tnt.settings?.reminderDaysAfterOverdue ?? 1));
        setNewStuCity(tnt.city || 'Alger');
        setNewStuWilaya(tnt.wilaya || '16 - Alger');
      }

      const zoomCfg = intRes.integrations?.find(i => i.provider === 'ZOOM');
      if (zoomCfg) {
        setZoomAccountId(zoomCfg.config?.accountId || '');
        setZoomClientId(zoomCfg.config?.clientId || '');
        setZoomClientSecret(zoomCfg.config?.clientSecret || '');
        setZoomTestMode(zoomCfg.isTestMode ?? true);
      }

      const payCfg = intRes.integrations?.find(i => i.provider === 'PAYMENT_GATEWAY');
      if (payCfg) {
        setChargilyEnabled(payCfg.isEnabled ?? true);
        setChargilyTestMode(payCfg.isTestMode ?? true);
        setChargilyPublicKey(payCfg.config?.publicKey || '');
        setChargilySecretKey(payCfg.config?.secretKey || '');
        setChargilyWebhookSecret(payCfg.config?.webhookSecret || '');
        setChargilyWebhookUrl(payCfg.config?.webhookEndpointUrl || '');
      }
    } catch (err) {
      console.error('Admin load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [user?.id, inspectedTenantId, tenant?.id]);

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBranding(true);
    setAdminBanner(null);
    try {
      const res = await api.updateTenantSettings({
        name: brandName.trim(),
        shortName: brandShortName.trim().toUpperCase(),
        tagline: brandTagline.trim(),
        logoUrl: brandLogoUrl.trim(),
        primaryColor: brandPrimaryColor,
        secondaryColor: brandSecondaryColor,
        accentColor: brandAccentColor,
        contactEmail: brandEmail.trim(),
        contactPhone: brandPhone.trim(),
        address: brandAddress.trim(),
        city: brandCity.trim(),
        wilaya: brandWilaya.trim(),
        website: brandWebsite.trim(),
        accreditationNumber: brandAccreditation.trim(),
        taxId: brandNif.trim() || brandTaxId.trim(),
        nif: brandNif.trim(),
        nis: brandNis.trim(),
        rc: brandRc.trim(),
        articleImposition: brandArticleImposition.trim(),
        tvaApplicable: brandTvaApplicable,
        tvaRatePercent: brandTvaApplicable ? Number(brandTvaRatePercent) : 0,
        invoicePrefix: brandInvoicePrefix.trim().toUpperCase(),
        invoiceFooterNote: brandInvoiceFooter.trim(),
        settings: {
          receiptPrefix: brandReceiptPrefix.trim().toUpperCase(),
          receiptFooterNote: brandReceiptFooter.trim(),
          supportHours: brandSupportHours.trim(),
          enforceSingleStudentSession: brandEnforceSingleSession,
          allowManualPayments: brandAllowManualPayments,
          allowInstallments: brandAllowInstallments,
          autoRemindersEnabled: brandAutoRemindersEnabled,
          reminderDaysBeforeDue: Number(brandReminderDaysBeforeDue),
          reminderDaysAfterOverdue: Number(brandReminderDaysAfterOverdue),
        },
      });
      await Promise.all([refreshUser(), refreshPublicTenants(), loadAllData()]);
      setAdminBanner({
        type: 'success',
        message: res.message || t('admin.messages.brandingSaved'),
      });
    } catch (err: any) {
      setAdminBanner({
        type: 'error',
        message: err.message || t('admin.messages.brandingSaveError'),
      });
    } finally {
      setSavingBranding(false);
    }
  };

  const handleRunTests = async () => {
    setRunningTests(true);
    setAdminBanner(null);
    try {
      const res = await api.runTestSuite();
      setTestResults(res);
      loadAllData();
    } catch (err: any) {
      setAdminBanner({
        type: 'error',
        message: t('admin.messages.testsRunError', { message: err.message }),
      });
    } finally {
      setRunningTests(false);
    }
  };

  const handleConfirmPayment = async (paymentId: string) => {
    setAdminBanner(null);
    try {
      await api.confirmPayment(paymentId, 'Validé par l administration');
      setAdminBanner({
        type: 'success',
        message: t('admin.messages.paymentConfirmed'),
      });
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleUpdateStudentStatus = async (studentId: string, newStatus: string) => {
    setAdminBanner(null);
    try {
      await api.updateStudentStatus(studentId, newStatus);
      loadAllData();
      if (selectedStudentDrawer && selectedStudentDrawer.id === studentId) {
        setSelectedStudentDrawer({ ...selectedStudentDrawer, status: newStatus });
      }
      setAdminBanner({
        type: 'success',
        message: t('admin.messages.studentStatusUpdated', { status: translateStatus(t, newStatus) }),
      });
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStuName || !newStuEmail) return;
    setAdminBanner(null);
    try {
      await api.createStudent({
        name: newStuName,
        email: newStuEmail,
        phone: newStuPhone,
        wilaya: newStuWilaya,
        city: newStuCity,
        classId: newStuClassId,
        createPendingPayment: true,
      });
      setShowCreateStudentModal(false);
      setNewStuName('');
      setNewStuEmail('');
      setNewStuPhone('');
      setAdminBanner({ type: 'success', message: t('admin.messages.studentCreated') });
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPayStudentId || !newPayAmount) return;
    setAdminBanner(null);
    try {
      await api.createPayment({
        studentId: newPayStudentId,
        courseId: newPayCourseId,
        amountDzd: Number(newPayAmount),
        paymentMethod: newPayMethod,
        transactionReference: newPayRef || 'ESP-GUICHET',
        administrativeNotes: 'Enregistré manuellement par l administration',
      });
      setShowCreatePaymentModal(false);
      setNewPayRef('');
      setAdminBanner({ type: 'success', message: t('admin.messages.paymentCreated') });
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSesTitle || !newSesClassId || !newSesDate) return;
    setAdminBanner(null);
    try {
      const cls = classes.find(c => c.id === newSesClassId);
      await api.createSession({
        title: newSesTitle,
        classId: newSesClassId,
        courseId: cls?.courseId || newSesCourseId,
        scheduledAt: new Date(newSesDate).toISOString(),
        durationMinutes: Number(newSesDuration),
      });
      setShowCreateSessionModal(false);
      setNewSesTitle('');
      setNewSesDate('');
      setAdminBanner({ type: 'success', message: t('admin.messages.sessionCreated') });
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleSaveZoomSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminBanner(null);
    try {
      await api.updateIntegration('ZOOM', {
        isEnabled: true,
        isTestMode: zoomTestMode,
        config: {
          accountId: zoomAccountId,
          clientId: zoomClientId,
          clientSecret: zoomClientSecret,
          defaultTimezone: 'Africa/Algiers',
        },
      });
      setAdminBanner({
        type: 'success',
        message: t('admin.messages.zoomSaved'),
      });
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleSaveChargilySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminBanner(null);
    try {
      await api.updateIntegration('PAYMENT_GATEWAY', {
        isEnabled: chargilyEnabled,
        isTestMode: chargilyTestMode,
        config: {
          gateway: 'chargily_pay_v2',
          mode: chargilyTestMode ? 'test' : 'live',
          publicKey: chargilyPublicKey.trim(),
          secretKey: chargilySecretKey.trim(),
          webhookSecret: chargilyWebhookSecret.trim(),
          currency: 'DZD',
        },
      });
      setAdminBanner({
        type: 'success',
        message: t('billing.chargilySettings.savedMsg'),
      });
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundTargetPayment || !refundReason.trim()) return;
    setRefundSubmitting(true);
    setAdminBanner(null);
    try {
      const res = await api.refundPayment(refundTargetPayment.id, {
        reason: refundReason.trim(),
        amountDzd: Number(refundAmount) || refundTargetPayment.amountDzd,
      });
      setRefundTargetPayment(null);
      setRefundReason('');
      setAdminBanner({
        type: 'success',
        message: res.message || t('billing.refund.successMsg'),
      });
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    } finally {
      setRefundSubmitting(false);
    }
  };

  const handleCreateInstallmentPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planStudentId || !planCourseId) return;
    setAdminBanner(null);
    try {
      await api.createInstallmentPlan({
        studentId: planStudentId,
        courseId: planCourseId,
        installmentsCount: Number(planCount) || 3,
        intervalDays: Number(planIntervalDays) || 30,
        firstDueDate: planFirstDueDate || undefined,
        totalAmountDzd: planTotalAmount ? Number(planTotalAmount) : undefined,
        notes: planNotes.trim() || undefined,
      });
      setShowCreatePlanModal(false);
      setPlanNotes('');
      setPlanTotalAmount('');
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleRunReminders = async () => {
    setRunningReminders(true);
    setAdminBanner(null);
    try {
      const res = await api.runAutomatedReminders();
      setAdminBanner({
        type: 'success',
        message: t('billing.reminders.runResultBanner', {
          evaluated: formatNumber(res.evaluatedCount, language),
          overdue: formatNumber(res.markedOverdueCount, language),
          sent: formatNumber(res.sentCount, language),
        }),
      });
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    } finally {
      setRunningReminders(false);
    }
  };

  const handleCsvPreview = async () => {
    if (!csvContent.trim()) return;
    setAdminBanner(null);
    try {
      const res = await api.importStudentsCsv(csvContent, true);
      setCsvPreviewReport(res);
    } catch (err: any) {
      setAdminBanner({
        type: 'error',
        message: t('admin.messages.csvValidationError', { message: err.message }),
      });
    }
  };

  const handleCsvExecute = async () => {
    if (!csvContent.trim()) return;
    setAdminBanner(null);
    try {
      const res = await api.importStudentsCsv(csvContent, false);
      setAdminBanner({
        type: 'success',
        message: t('admin.messages.csvImportSuccess', {
          count: formatNumber(res.createdCount, language),
        }),
      });
      setShowImportCsvModal(false);
      setCsvContent('');
      setCsvPreviewReport(null);
      loadAllData();
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message });
    }
  };

  const handleExportCsv = async (type: 'students' | 'payments') => {
    setAdminBanner(null);
    try {
      await api.exportCsv(type);
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message || t('admin.messages.csvExportError') });
    }
  };

  const handleResetDemo = async () => {
    setAdminBanner(null);
    try {
      await api.resetDemo();
      loadAllData();
      setAdminBanner({
        type: 'success',
        message: t('admin.messages.demoResetSuccess'),
      });
    } catch (err: any) {
      setAdminBanner({ type: 'error', message: err.message || t('admin.messages.demoResetError') });
    }
  };

  // Filter students
  const filteredStudents = students.filter(s => {
    const matchesSearch =
      s.name.toLowerCase().includes(studentSearch.toLowerCase()) ||
      s.email.toLowerCase().includes(studentSearch.toLowerCase()) ||
      (s.profile?.studentIdNumber && s.profile.studentIdNumber.toLowerCase().includes(studentSearch.toLowerCase()));
    const matchesStatus = studentStatusFilter === 'ALL' || s.status === studentStatusFilter;
    return matchesSearch && matchesStatus;
  });

  // Unused vars guard
  void integrations;
  void loading;

  return (
    <div className="flex-1 flex flex-col bg-[#F5F7FB] min-h-screen">
      
      {/* Top Banner Navigation for Administration - Institutional & Crisp */}
      <div className="bg-white border-b border-[#E2E8F0] sticky top-0 z-30 shadow-2xs">
        <div className="max-w-[1560px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10">
          <div className="flex items-center justify-between h-16 gap-3">
            
            <div className="flex items-center gap-3.5 min-w-0">
              {tenant?.logoUrl && !headerLogoFailed ? (
                <img
                  src={tenant.logoUrl}
                  alt={tenant.name}
                  referrerPolicy="no-referrer"
                  onError={() => setHeaderLogoFailed(true)}
                  className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-[var(--tenant-primary)] text-white flex items-center justify-center font-bold text-xs shrink-0 ltr-num">
                  {tenant?.shortName || 'NL'}
                </div>
              )}
              <div className="min-w-0">
                <span className="text-sm font-extrabold text-[#17243A] leading-tight tracking-tight block truncate">
                  {tenant?.name || t('admin.defaultHeaderName')}
                </span>
                <div className="flex items-center gap-2 text-xs text-[#64748B] font-medium truncate">
                  <span>{user?.name}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono ltr-num">{tenant?.accreditationNumber || t('common.officialAccreditation')}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto py-1">
              {[
                { key: 'dashboard', label: t('admin.tabs.dashboard'), icon: BarChart3 },
                { key: 'students', label: t('admin.tabs.students'), icon: Users },
                { key: 'courses', label: t('admin.tabs.courses'), icon: BookOpen },
                { key: 'payments', label: t('admin.tabs.payments'), icon: CreditCard },
                { key: 'sessions', label: t('admin.tabs.sessions'), icon: Video },
                { key: 'branding', label: t('admin.tabs.branding'), icon: Building },
                { key: 'security', label: t('admin.tabs.security'), icon: Settings },
                { key: 'tests', label: t('admin.tabs.tests'), icon: ShieldCheck },
              ].map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl whitespace-nowrap shrink-0 transition-all ${
                      isActive
                        ? 'bg-[var(--tenant-primary)] text-white shadow-xs'
                        : 'text-[#64748B] hover:text-[#17243A] hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {/* Main Content Area - Generous Full-Width Canvas */}
      <div className="max-w-[1560px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-7 flex-1 w-full space-y-7">

        {adminBanner && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between text-xs ${
              adminBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {adminBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{adminBanner.message}</span>
            </div>
            <button onClick={() => setAdminBanner(null)}>✕</button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: TABLEAU DE BORD */}
        {/* ========================================================================= */}
        {activeTab === 'dashboard' && stats && (
          <div className="space-y-7">
            
            {/* 1. Header Institutionnel & Cockpit de Pilotage */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 lg:p-8 shadow-xs flex flex-col xl:flex-row xl:items-center justify-between gap-6 relative overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#2457C5] via-[#101B33] to-[#16845B]" />
              
              <div className="space-y-2.5 max-w-4xl">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#2457C5] tracking-wide">
                  <span className="w-2 h-2 rounded-full bg-[#2457C5]" />
                  <span>{t('admin.dashboard.republicHeader')}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-[#64748B] font-mono">{t('admin.dashboard.ministrySubheader')}</span>
                </div>
                
                <h1 className="text-2xl lg:text-3xl font-extrabold text-[#17243A] tracking-tight">
                  {t('admin.dashboard.heroTitle')}
                </h1>
                
                <p className="text-sm text-[#64748B] leading-relaxed">
                  {t('admin.dashboard.heroDesc')}
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-[#64748B] font-mono">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
                    <Clock className="w-3.5 h-3.5 text-[#2457C5]" />
                    <span>{t('admin.dashboard.officialTime')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
                    <GraduationCap className="w-3.5 h-3.5 text-[#2457C5]" />
                    <span>{t('admin.dashboard.academicYear')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#E6F5EF] border border-emerald-200 text-[#16845B] font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t('admin.dashboard.acidSynced')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EAF1FF] border border-blue-200 text-[#2457C5] font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{t('admin.dashboard.singleSessionActive')}</span>
                  </div>
                </div>
              </div>

              {/* Action Deck - Hierarchy & Generous Sizing */}
              <div className="flex flex-wrap sm:flex-nowrap xl:flex-col gap-2.5 shrink-0">
                <button
                  onClick={() => setShowCreateStudentModal(true)}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs lg:text-sm font-bold text-white bg-[#2457C5] hover:bg-[#1D47A6] rounded-xl shadow-xs transition-colors whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  {t('admin.dashboard.enrollStudentBtn')}
                </button>
                <button
                  onClick={() => setShowCreatePaymentModal(true)}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs lg:text-sm font-bold text-[#17243A] bg-white hover:bg-slate-50 border border-[#E2E8F0] rounded-xl shadow-2xs transition-colors whitespace-nowrap"
                >
                  <CreditCard className="w-4 h-4 text-[#2457C5]" />
                  {t('admin.dashboard.recordPaymentBtn')}
                </button>
                <button
                  onClick={() => setShowCreateSessionModal(true)}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs lg:text-sm font-semibold text-[#17243A] bg-white hover:bg-slate-50 border border-[#E2E8F0] rounded-xl shadow-2xs transition-colors whitespace-nowrap"
                >
                  <Video className="w-4 h-4 text-[#2457C5]" />
                  {t('admin.dashboard.scheduleSessionBtn')}
                </button>
                <button
                  onClick={() => loadAllData()}
                  className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:text-[#17243A] hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('admin.dashboard.refreshDataBtn')}
                </button>
              </div>
            </div>

            {/* 2. Matrice des 5 Indicateurs Clés */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
              
              {/* KPI 1 : Effectif Étudiant Global */}
              <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
                    {t('admin.dashboard.kpi1Title')}
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-[#EAF1FF] text-[#2457C5] flex items-center justify-center">
                    <Users className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold font-mono text-[#17243A] tabular-nums ltr-num">
                      {formatNumber(stats.totalStudents, language)}
                    </span>
                    <span className="text-xs font-bold text-[#16845B] bg-[#E6F5EF] px-2 py-0.5 rounded-full font-mono">
                      {t('admin.dashboard.kpi1Active', { count: formatNumber(stats.activeStudents, language) })}
                    </span>
                  </div>
                  <p className="text-xs text-[#64748B] mt-1.5 font-medium">
                    {t('admin.dashboard.kpi1NewMonth', { count: formatNumber(stats.newEnrollmentsThisMonth, language) })}
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-[#64748B]">
                  <span>{t('admin.dashboard.kpi1Wilayas')}</span>
                </div>
              </div>

              {/* KPI 2 : Recettes Certifiées (DZD) */}
              <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
                    {t('admin.dashboard.kpi2Title')}
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-[#E6F5EF] text-[#16845B] flex items-center justify-center">
                    <CreditCard className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline gap-1.5 ltr-num">
                    <span className="text-3xl font-extrabold font-mono text-[#17243A] tabular-nums">
                      {formatNumber(stats.collectedRevenueDzd, language)}
                    </span>
                    <span className="text-xs font-bold text-[#64748B] font-mono">DZD</span>
                  </div>
                  <p className="text-xs text-[#16845B] font-bold mt-1.5 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {t('admin.dashboard.kpi2Reconciled')}
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-[#64748B]">
                  <span>{t('admin.dashboard.kpi2Split')}</span>
                </div>
              </div>

              {/* KPI 3 : Abonnements e-Learning Actifs */}
              <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
                    {t('admin.dashboard.kpi3Title')}
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-[#EAF1FF] text-[#2457C5] flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold font-mono text-[#2457C5] tabular-nums ltr-num">
                      {formatNumber(stats.activeSubscriptions, language)}
                    </span>
                    <span className="text-xs text-[#C43D4B] font-mono font-bold bg-[#FDF2F2] px-2 py-0.5 rounded-full">
                      {t('admin.dashboard.kpi3Expired', { count: formatNumber(stats.expiredSubscriptions, language) })}
                    </span>
                  </div>
                  <p className="text-xs text-[#64748B] mt-1.5 font-medium">
                    {t('admin.dashboard.kpi3Desc')}
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-[#64748B]">
                  <span>{t('admin.dashboard.kpi3AntiSharing')}</span>
                </div>
              </div>

              {/* KPI 4 : Trésorerie en Attente */}
              <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
                    {t('admin.dashboard.kpi4Title')}
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-[#FEF3E2] text-[#B96912] flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline gap-1.5 ltr-num">
                    <span className="text-3xl font-extrabold font-mono text-[#B96912] tabular-nums">
                      {formatNumber(stats.pendingPaymentsAmountDzd, language)}
                    </span>
                    <span className="text-xs font-bold text-[#64748B] font-mono">DZD</span>
                  </div>
                  <p className="text-xs text-[#B96912] font-bold mt-1.5">
                    {t('admin.dashboard.kpi4PendingCount', { count: formatNumber(stats.pendingPaymentsCount, language) })}
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-[#64748B]">
                  <span className="text-[#B96912] font-semibold">{t('admin.dashboard.kpi4Action24h')}</span>
                </div>
              </div>

              {/* KPI 5 : Assiduité Pédagogique */}
              <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
                    {t('admin.dashboard.kpi5Title')}
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold font-mono text-[#16845B] tabular-nums ltr-num">
                      {formatPercent(stats.overallAttendanceRate)}
                    </span>
                    <span className="text-xs font-bold text-[#64748B]">{t('admin.dashboard.kpi5Present')}</span>
                  </div>
                  <p className="text-xs text-[#64748B] mt-1.5 font-medium">
                    {t('admin.dashboard.kpi5Teachers', { count: formatNumber(stats.totalTeachers, language) })}
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-[#64748B]">
                  <span>{t('admin.dashboard.kpi5Upcoming', { count: formatNumber(stats.upcomingSessionsCount, language) })}</span>
                </div>
              </div>

            </div>

            {/* 3. Grille Opérationnelle 2 Colonnes */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
              
              {/* Colonne Principale (8 colonnes) */}
              <div className="lg:col-span-8 space-y-7">
                
                {/* Module A : Analyse Graphique de la Dynamique de l'Établissement */}
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 lg:p-7 shadow-xs space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="text-base font-bold text-[#17243A]">
                        {t('admin.dashboard.chartTitle')}
                      </h3>
                      <p className="text-xs text-[#64748B] mt-0.5">
                        {t('admin.dashboard.chartSubtitle')}
                      </p>
                    </div>

                    {/* Sélecteur d'onglet de métrique */}
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0 border border-slate-200">
                      <button
                        onClick={() => setDashboardMetricTab('revenue')}
                        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                          dashboardMetricTab === 'revenue'
                            ? 'bg-white text-[#2457C5] shadow-xs'
                            : 'text-[#64748B] hover:text-[#17243A]'
                        }`}
                      >
                        {t('admin.dashboard.revenueTab')}
                      </button>
                      <button
                        onClick={() => setDashboardMetricTab('enrollments')}
                        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                          dashboardMetricTab === 'enrollments'
                            ? 'bg-white text-[#2457C5] shadow-xs'
                            : 'text-[#64748B] hover:text-[#17243A]'
                        }`}
                      >
                        {t('admin.dashboard.enrollmentsTab')}
                      </button>
                    </div>
                  </div>

                  {/* Visualisation graphique interactive */}
                  {dashboardMetricTab === 'revenue' ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-4 gap-6 items-end h-56 pt-4 px-2">
                        {stats.monthlyRevenue.map((item, idx) => {
                          const maxVal = 220000;
                          const heightPercent = Math.min(100, Math.max(18, Math.round((item.amountDzd / maxVal) * 100)));
                          const isCurrent = idx === stats.monthlyRevenue.length - 1;
                          return (
                            <div key={idx} className="flex flex-col items-center gap-2.5 h-full justify-end group">
                              <span className="text-xs font-mono font-bold text-[#17243A] tabular-nums bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200 group-hover:border-blue-400 group-hover:text-blue-700 transition-colors ltr-num">
                                {formatDzd(item.amountDzd, language)}
                              </span>
                              <div className="w-full bg-slate-100 rounded-t-xl h-full flex items-end p-1.5">
                                <svg viewBox="0 0 40 100" preserveAspectRatio="none" className="w-full h-full rounded-t-lg overflow-hidden">
                                  <rect
                                    x="0"
                                    y={100 - heightPercent}
                                    width="40"
                                    height={heightPercent}
                                    className={
                                      isCurrent ? 'fill-[var(--tenant-secondary)]' : 'fill-slate-400'
                                    }
                                  />
                                </svg>
                              </div>
                              <span className={`text-xs font-semibold ltr-num ${isCurrent ? 'text-[var(--tenant-secondary)] font-bold' : 'text-[#64748B]'}`}>
                                {ensureWesternDigits(item.month)}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Indicateurs statistiques sous le graphique */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-100 text-xs">
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[#64748B] block text-[11px] font-medium">{t('admin.dashboard.certifiedTotal')}</span>
                          <span className="font-extrabold text-[#17243A] font-mono tabular-nums text-sm ltr-num">
                            {formatDzd(stats.collectedRevenueDzd, language)}
                          </span>
                        </div>
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[#64748B] block text-[11px] font-medium">{t('admin.dashboard.receiptPrefix')}</span>
                          <span className="font-extrabold text-[var(--tenant-secondary)] font-mono text-sm ltr-num">
                            {tenantDetails?.settings?.receiptPrefix || 'REC'}
                          </span>
                        </div>
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[#64748B] block text-[11px] font-medium">{t('admin.dashboard.schoolHq')}</span>
                          <span className="font-extrabold text-[#16845B] font-mono text-sm">
                            {tenant?.city || t('common.algeria')}
                          </span>
                        </div>
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[#64748B] block text-[11px] font-medium">{t('admin.dashboard.saasOffer')}</span>
                          <span className="font-extrabold text-[#16845B] font-mono text-sm ltr-num">
                            {tenantDetails?.subscriptionPlan || 'ENTERPRISE'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="grid grid-cols-4 gap-6 items-end h-56 pt-4 px-2">
                        {stats.monthlyEnrollments.map((item, idx) => {
                          const maxVal = 12;
                          const heightPercent = Math.min(100, Math.max(18, Math.round((item.count / maxVal) * 100)));
                          const isCurrent = idx === stats.monthlyEnrollments.length - 1;
                          return (
                            <div key={idx} className="flex flex-col items-center gap-2.5 h-full justify-end group">
                              <span className="text-xs font-mono font-bold text-[#17243A] bg-slate-50 px-2.5 py-0.5 rounded-md border border-slate-200">
                                {t('admin.dashboard.studentsUnit', { count: formatNumber(item.count, language) })}
                              </span>
                              <div className="w-full bg-slate-100 rounded-t-xl h-full flex items-end p-1.5">
                                <svg viewBox="0 0 40 100" preserveAspectRatio="none" className="w-full h-full rounded-t-lg overflow-hidden">
                                  <rect
                                    x="0"
                                    y={100 - heightPercent}
                                    width="40"
                                    height={heightPercent}
                                    className={
                                      isCurrent ? 'fill-[var(--tenant-primary)]' : 'fill-blue-400'
                                    }
                                  />
                                </svg>
                              </div>
                              <span className="text-xs text-[#64748B] font-semibold ltr-num">{ensureWesternDigits(item.month)}</span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-100 text-xs">
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[#64748B] block text-[11px] font-medium">{t('admin.dashboard.conversionRate')}</span>
                          <span className="font-extrabold text-[#17243A] font-mono text-sm ltr-num">{formatPercent(82)}</span>
                        </div>
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[#64748B] block text-[11px] font-medium">{t('admin.dashboard.openCohorts')}</span>
                          <span className="font-extrabold text-[#2457C5] font-mono text-sm">
                            {t('admin.dashboard.cohortsCount', { count: formatNumber(classes.length || 3, language) })}
                          </span>
                        </div>
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[#64748B] block text-[11px] font-medium">{t('admin.dashboard.pedagogicalRetention')}</span>
                          <span className="font-extrabold text-[#16845B] font-mono text-sm ltr-num">{formatPercent(98)}</span>
                        </div>
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="text-[#64748B] block text-[11px] font-medium">{t('admin.dashboard.jobPlacementRate')}</span>
                          <span className="font-extrabold text-[#16845B] font-mono text-sm ltr-num">{formatPercent(89)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Module B : Rapprochements Financiers Prioritaires */}
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 lg:p-7 shadow-xs space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-bold text-[#17243A]">{t('admin.dashboard.reconciliationTitle')}</h3>
                        {stats.pendingPaymentsCount > 0 && (
                          <span className="px-2.5 py-0.5 text-xs font-bold bg-[#FEF3E2] text-[#B96912] rounded-full border border-amber-200 uppercase tracking-wider">
                            {t('admin.dashboard.pendingBadge', { count: formatNumber(stats.pendingPaymentsCount, language) })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#64748B] mt-0.5">
                        {t('admin.dashboard.reconciliationSubtitle')}
                      </p>
                    </div>

                    <button
                      onClick={() => setActiveTab('payments')}
                      className="text-xs font-bold text-[#2457C5] hover:text-[#1D47A6] flex items-center gap-1 shrink-0"
                    >
                      {t('admin.dashboard.viewLedgerBtn', { count: formatNumber(payments.length, language) })}{' '}
                      <ChevronRight className="w-4 h-4 rtl-flip" />
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {payments.slice(0, 4).map(p => (
                      <div key={p.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs hover:bg-slate-50/80 p-3 rounded-xl transition-colors">
                        <div className="flex items-start gap-3.5">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            p.status === 'CONFIRMED' ? 'bg-[#E6F5EF] text-[#16845B]' : 'bg-[#FEF3E2] text-[#B96912]'
                          }`}>
                            <CreditCard className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-[#17243A]">{(p as any).studentName}</span>
                              <span className="text-[10px] font-mono text-[#64748B] bg-slate-100 px-2 py-0.5 rounded ltr-num">
                                {t('admin.dashboard.receiptNoShort', { number: p.receiptNumber })}
                              </span>
                            </div>
                            <p className="text-xs text-[#64748B] mt-1">
                              {(p as any).courseTitle} ·{' '}
                              <span className="font-semibold text-slate-700">{translatePaymentMethod(t, p.paymentMethod)}</span>{' '}
                              <span className="ltr-num">({t('admin.dashboard.refShort', { ref: p.transactionReference })})</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0 sm:self-center">
                          <div className="text-end">
                            <span className="font-mono font-bold text-base text-[#17243A] block ltr-num">
                              {formatDzd(p.amountDzd, language)}
                            </span>
                            <span className="text-xs font-mono text-[#64748B] ltr-num">
                              {formatDate(p.paymentDate, language)}
                            </span>
                          </div>

                          {p.status === 'PENDING' ? (
                            <button
                              onClick={() => handleConfirmPayment(p.id)}
                              className="px-4 py-2 text-xs font-bold text-white bg-[#16845B] hover:bg-[#126b49] rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                            >
                              <Check className="w-4 h-4" />
                              {t('admin.dashboard.validateAndActivate')}
                            </button>
                          ) : (
                            <button
                              onClick={() => setSelectedReceipt(p)}
                              className="px-3.5 py-1.5 text-xs font-semibold text-[#2457C5] bg-[#EAF1FF] hover:bg-blue-100 rounded-xl transition-colors"
                            >
                              {t('admin.dashboard.viewReceipt')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Module C : Séances de Visioconférence Programmées */}
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 lg:p-7 shadow-xs space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="text-base font-bold text-[#17243A]">{t('admin.dashboard.liveSessionsTitle')}</h3>
                      <p className="text-xs text-[#64748B] mt-0.5">
                        {t('admin.dashboard.liveSessionsSubtitle')}
                      </p>
                    </div>

                    <button
                      onClick={() => setActiveTab('sessions')}
                      className="text-xs font-bold text-[#2457C5] hover:text-[#1D47A6] flex items-center gap-1 shrink-0"
                    >
                      {t('admin.dashboard.fullCalendarBtn')} <ChevronRight className="w-4 h-4 rtl-flip" />
                    </button>
                  </div>

                  <div className="space-y-3.5">
                    {sessions.slice(0, 3).map(s => {
                      const dateObj = new Date(s.scheduledAt);
                      const isPast = dateObj < new Date();
                      return (
                        <div
                          key={s.id}
                          className="p-4 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs transition-colors"
                        >
                          <div className="flex items-start gap-3.5">
                            <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 text-[#2457C5] flex flex-col items-center justify-center shrink-0 shadow-2xs font-mono">
                              <span className="text-[10px] uppercase font-bold text-[#64748B]">
                                {formatDate(dateObj, language, { month: 'short' })}
                              </span>
                              <span className="text-base font-extrabold leading-none ltr-num">
                                {formatNumber(dateObj.getDate(), language)}
                              </span>
                            </div>

                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider ${
                                  isPast ? 'bg-slate-200 text-slate-700' : 'bg-[#E6F5EF] text-[#16845B]'
                                }`}>
                                  {translateStatus(t, isPast ? 'COMPLETED' : 'SCHEDULED')}
                                </span>
                                <span className="text-xs font-mono text-[#64748B] ltr-num">
                                  {formatTime(dateObj, language)} ({formatNumber(s.durationMinutes, language)} {t('common.minutesShort')})
                                </span>
                              </div>
                              <h4 className="font-bold text-[#17243A] text-sm mt-1">{s.title}</h4>
                              <p className="text-xs text-[#64748B] mt-0.5">
                                {t('admin.dashboard.cohortAndProvider', {
                                  cohort: (s as any).className || 'Web Dev',
                                  provider: s.videoProvider,
                                })}
                              </p>
                            </div>
                          </div>

                          <button
                            onClick={async () => {
                              const joinData = await api.joinSessionProtected(s.id);
                              setActiveLiveSession({ session: s, joinData });
                            }}
                            className="px-4 py-2.5 text-xs font-bold text-white bg-[#2457C5] hover:bg-[#1D47A6] rounded-xl shadow-xs transition-colors shrink-0 flex items-center justify-center gap-2"
                          >
                            <Video className="w-4 h-4" />
                            {t('admin.dashboard.auditLaunchRoomBtn')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Colonne Secondaire Institutionnelle (4 colonnes) */}
              <div className="lg:col-span-4 space-y-7">
                
                {/* Module D : Répartition des Effectifs par Filière */}
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 lg:p-7 shadow-xs space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-base font-bold text-[#17243A]">{t('admin.dashboard.trackDistributionTitle')}</h3>
                    <span className="text-xs font-mono font-semibold text-[#64748B] bg-slate-100 px-2 py-0.5 rounded">
                      {t('admin.dashboard.cohortsBadge', { count: formatNumber(classes.length, language) })}
                    </span>
                  </div>

                  <div className="space-y-4 text-xs">
                    {courses.map(crs => {
                      const enrolledInCourse = students.filter(s => s.course?.id === crs.id || s.profile?.currentClassId?.includes(crs.code.toLowerCase())).length;
                      const count = enrolledInCourse || (crs.id === 'crs_web' ? 6 : crs.id === 'crs_data' ? 2 : 2);
                      const maxCapacity = 25;
                      const percentage = Math.round((count / maxCapacity) * 100);

                      return (
                        <div key={crs.id} className="space-y-2">
                          <div className="flex justify-between items-baseline gap-2">
                            <span className="font-bold text-sm text-[#17243A] truncate max-w-[200px]">{crs.title}</span>
                            <span className="font-mono text-[#64748B] text-xs font-semibold ltr-num">
                              {formatNumber(count, language)} / {formatNumber(maxCapacity, language)} ({formatPercent(percentage)})
                            </span>
                          </div>
                          <svg
                            viewBox="0 0 100 6"
                            className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden"
                            aria-hidden="true"
                          >
                            <rect
                              x="0"
                              y="0"
                              width={Math.min(100, percentage)}
                              height="6"
                              className="fill-[var(--tenant-secondary)]"
                            />
                          </svg>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setActiveTab('courses')}
                      className="w-full py-2.5 text-center text-xs font-bold text-[#2457C5] bg-[#EAF1FF] hover:bg-blue-100 rounded-xl transition-colors"
                    >
                      {t('admin.dashboard.manageProgramsBtn')}
                    </button>
                  </div>
                </div>

                {/* Module E : Journal d'Audit & Activité Récente en Direct */}
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 lg:p-7 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-[#2457C5]" />
                      <h3 className="text-base font-bold text-[#17243A]">{t('admin.dashboard.auditFeedTitle')}</h3>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-[#16845B] bg-[#E6F5EF] px-2 py-0.5 rounded-full">
                      {t('admin.dashboard.realTimeBadge')}
                    </span>
                  </div>

                  <div className="space-y-3 max-h-80 overflow-y-auto pe-1">
                    {auditLogs.slice(0, 4).map(log => (
                      <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider ltr-num ${
                            log.action.includes('PAYMENT')
                              ? 'bg-[#E6F5EF] text-[#16845B]'
                              : log.action.includes('SESSION')
                              ? 'bg-[#FEF3E2] text-[#B96912]'
                              : 'bg-[#EAF1FF] text-[#2457C5]'
                          }`}>
                            {log.action}
                          </span>
                          <span className="text-[10px] font-mono text-[#64748B] ltr-num">
                            {formatTime(log.timestamp, language)}
                          </span>
                        </div>
                        <p className="text-xs text-[#17243A] leading-relaxed">
                          {ensureWesternDigits(log.details)}
                        </p>
                        <div className="flex items-center justify-between text-[10px] text-[#64748B] font-mono pt-1 border-t border-slate-200/60">
                          <span className="ltr-num">{log.userEmail}</span>
                          <span className="ltr-num">IP: {log.ipAddress}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setActiveTab('security')}
                      className="w-full py-2 text-center text-xs font-bold text-[#64748B] hover:text-[#17243A] transition-colors inline-flex items-center justify-center gap-1"
                    >
                      <span>{t('admin.dashboard.viewFullAuditBtn')}</span>
                      <ChevronRight className="w-3.5 h-3.5 rtl-flip" />
                    </button>
                  </div>
                </div>

                {/* Module F : Surveillance & Conformité Système */}
                <div className="bg-[#101B33] text-white rounded-2xl p-6 lg:p-7 shadow-sm space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider">{t('admin.dashboard.complianceTitle')}</h4>
                    </div>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded font-mono font-bold">
                      {t('admin.dashboard.operational100')}
                    </span>
                  </div>

                  <div className="space-y-2.5 text-xs text-slate-300">
                    <div className="flex justify-between items-center py-1 border-b border-slate-800 gap-2">
                      <span>{t('admin.dashboard.dataPersistence')}</span>
                      <span className="font-mono text-emerald-400 font-semibold ltr-num">PostgreSQL ACID</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800 gap-2">
                      <span>{t('admin.dashboard.sessionPolicy')}</span>
                      <span className="font-mono text-emerald-400 font-semibold ltr-num">HttpOnly + CSRF + Argon2id</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800 gap-2">
                      <span>{t('admin.dashboard.antiIdorValidation')}</span>
                      <span className="font-mono text-blue-300 font-semibold">{t('admin.dashboard.antiIdorValue')}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800 gap-2">
                      <span>{t('admin.dashboard.multiTenantIsolation')}</span>
                      <span className="font-mono text-emerald-400 font-semibold ltr-num">AsyncLocalStorage + tdb</span>
                    </div>
                    <div className="flex justify-between items-center py-1 gap-2">
                      <span>{t('admin.dashboard.qualityControl')}</span>
                      <span className="font-mono text-emerald-400 font-semibold">{t('admin.dashboard.qualityControlValue')}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setActiveTab('tests');
                      handleRunTests();
                    }}
                    className="w-full py-3 text-center text-xs font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-all shadow-xs"
                  >
                    {t('admin.dashboard.runComplianceTestsBtn')}
                  </button>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: GESTION DES ÉTUDIANTS */}
        {/* ========================================================================= */}
        {activeTab === 'students' && (
          <div className="space-y-6">
            
            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 max-w-lg">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute start-3 top-2.5" />
                  <input
                    type="text"
                    placeholder={t('admin.students.searchPlaceholder')}
                    value={studentSearch}
                    onChange={e => setStudentSearch(e.target.value)}
                    className="w-full ps-9 pe-3 py-2 text-xs bg-white border border-slate-300 rounded-xl text-slate-800 focus:outline-none focus:border-blue-500 shadow-xs"
                  />
                </div>

                <select
                  value={studentStatusFilter}
                  onChange={e => setStudentStatusFilter(e.target.value)}
                  className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl text-slate-700 font-medium shadow-xs"
                >
                  <option value="ALL">{t('admin.students.statusAll')}</option>
                  <option value="ACTIVE">{t('admin.students.statusActiveOnly')}</option>
                  <option value="SUSPENDED">{t('admin.students.statusSuspended')}</option>
                  <option value="ARCHIVED">{t('admin.students.statusArchived')}</option>
                </select>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleExportCsv('students')}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-xs transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  {t('admin.students.exportCsv')}
                </button>

                <button
                  onClick={() => setShowImportCsvModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-xs transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-600" />
                  {t('admin.students.importCsv')}
                </button>

                <button
                  onClick={() => setShowCreateStudentModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-sm transition-all"
                >
                  <Plus className="w-4 h-4" />
                  {t('admin.students.newStudentBtn')}
                </button>
              </div>
            </div>

            {/* Students Table */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
              <table className="w-full text-start text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 text-start">{t('admin.students.idCol')}</th>
                    <th className="py-3 px-4 text-start">{t('admin.students.studentCol')}</th>
                    <th className="py-3 px-4 text-start">{t('admin.students.wilayaCol')}</th>
                    <th className="py-3 px-4 text-start">{t('admin.students.classCol')}</th>
                    <th className="py-3 px-4 text-center">{t('admin.students.subCol')}</th>
                    <th className="py-3 px-4 text-center">{t('admin.students.accountStatusCol')}</th>
                    <th className="py-3 px-4 text-end">{t('admin.students.actionsCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredStudents.map(stu => (
                    <tr key={stu.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono font-bold text-slate-800 ltr-num">
                        {stu.profile?.studentIdNumber || stu.id.substring(0, 8)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-900 block">{stu.name}</span>
                        <span className="text-[11px] text-slate-400 font-mono ltr-num">{stu.email}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {ensureWesternDigits(stu.profile?.wilaya || t('common.algeria'))}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-800 block">{stu.class?.name || t('common.unassigned')}</span>
                        <span className="text-[10px] text-slate-400 ltr-num">{stu.course?.code || ''}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider ${
                          stu.hasActiveSubscription
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {translateStatus(t, stu.hasActiveSubscription ? 'ACTIVE' : 'EXPIRED_OR_PENDING')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-md ${
                          stu.status === 'ACTIVE'
                            ? 'bg-slate-100 text-slate-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {translateStatus(t, stu.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end">
                        <button
                          onClick={() => setSelectedStudentDrawer(stu)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                        >
                          {t('admin.students.detailsBtn')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: FORMATIONS & CLASSES */}
        {/* ========================================================================= */}
        {activeTab === 'courses' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">{t('admin.courses.title')}</h2>
                <p className="text-xs text-slate-500">{t('admin.courses.subtitle')}</p>
              </div>
            </div>

            {/* Courses Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {courses.map(course => (
                <div key={course.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="h-44 bg-slate-900 relative">
                      <img
                        src={course.coverImage}
                        alt={course.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      <div className="absolute bottom-3 start-4 end-4">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-blue-300 block mb-0.5 ltr-num">{course.code}</span>
                        <h3 className="text-sm font-bold text-white">{course.title}</h3>
                      </div>
                    </div>

                    <div className="p-5 space-y-3">
                      <p className="text-xs text-slate-500 leading-relaxed">{course.description}</p>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200/60 font-mono">
                        <div>
                          <span className="text-slate-400 block text-[10px]">{t('admin.courses.hoursVolume')}</span>
                          <span className="font-bold text-slate-800">
                            <span className="ltr-num">{formatNumber(course.durationHours, language)}</span> {t('common.hours')}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">{t('admin.courses.indicativeFee')}</span>
                          <span className="font-bold text-blue-900 ltr-num">{formatDzd(course.priceDzd, language)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 pt-0 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-mono">
                      {t('admin.courses.modulesCount', { count: formatNumber(course.modulesCount || 3, language) })}
                    </span>
                    <span className="font-semibold text-emerald-700">{translateStatus(t, 'PUBLISHED')}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Classes Roster */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">{t('admin.courses.classesTitle')}</h3>
                <span className="text-xs text-slate-500 font-mono">
                  {t('admin.courses.classesConfigured', { count: formatNumber(classes.length, language) })}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {classes.map(cls => (
                  <div key={cls.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-blue-700 ltr-num">{cls.code}</span>
                      <span className="text-slate-400 font-mono">
                        {t('admin.courses.studentsRatio', {
                          enrolled: formatNumber(cls.enrolledStudents?.length || 0, language),
                          capacity: formatNumber(cls.capacity, language),
                        })}
                      </span>
                    </div>
                    <h4 className="font-bold text-slate-900">{cls.name}</h4>
                    <p className="text-slate-500">
                      {t('admin.courses.teacherLabel')}{' '}
                      <span className="font-semibold text-slate-700">{cls.teacher?.name || t('common.unassigned')}</span>
                    </p>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-[11px] text-slate-400 font-mono gap-2">
                      <span>{t('admin.courses.startLabel', { date: formatDate(cls.startDate, language) })}</span>
                      <span>{t('admin.courses.endLabel', { date: formatDate(cls.endDate, language) })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: GESTION DES PAIEMENTS, ÉCHÉANCIERS, RELANCES & FACTURES PDF */}
        {/* ========================================================================= */}
        {activeTab === 'payments' && (
          <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">{t('admin.payments.title')}</h2>
                <p className="text-xs text-slate-500">{t('admin.payments.subtitle')}</p>
              </div>

              {/* Segmented Sub-Tabs */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
                {[
                  { key: 'transactions', label: t('billing.adminSubtabs.transactions') },
                  {
                    key: 'installments',
                    label: t('billing.adminSubtabs.installments', {
                      count: formatNumber(installmentPlans.length, language),
                    }),
                  },
                  {
                    key: 'reminders',
                    label: t('billing.adminSubtabs.reminders', {
                      count: formatNumber(reminders.length, language),
                    }),
                  },
                  {
                    key: 'invoices',
                    label: t('billing.adminSubtabs.invoices', {
                      count: formatNumber(invoices.length, language),
                    }),
                  },
                ].map((sub) => (
                  <button
                    key={sub.key}
                    type="button"
                    onClick={() => setPaymentSubTab(sub.key as any)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                      paymentSubTab === sub.key
                        ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>

            {paymentSubTab === 'transactions' && (
              <div className="space-y-4">
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleExportCsv('payments')}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-600" />
                    {t('admin.payments.exportCsvBtn')}
                  </button>

                  <button
                    onClick={() => setShowCreatePaymentModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-sm transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    {t('admin.payments.recordPaymentBtn')}
                  </button>
                </div>

                {/* Payments Table */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
                  <table className="w-full text-start text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4 text-start">{t('admin.payments.receiptNoCol')}</th>
                        <th className="py-3 px-4 text-start">{t('admin.payments.studentCol')}</th>
                        <th className="py-3 px-4 text-start">{t('admin.payments.courseCol')}</th>
                        <th className="py-3 px-4 text-start">{t('admin.payments.methodRefCol')}</th>
                        <th className="py-3 px-4 text-end">{t('admin.payments.amountCol')}</th>
                        <th className="py-3 px-4 text-center">{t('admin.payments.statusCol')}</th>
                        <th className="py-3 px-4 text-end">{t('admin.payments.actionCol')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {payments.map(p => {
                        const uploadMatch = p.receiptAttachment?.match(/\/api\/uploads\/([^/]+)\/download$/);
                        const receiptUploadId = uploadMatch ? uploadMatch[1] : null;
                        return (
                          <tr key={p.id} className="hover:bg-slate-50/60">
                            <td className="py-3 px-4 font-mono font-bold text-slate-900 ltr-num">
                              {p.receiptNumber}
                              {p.invoiceNumber && (
                                <span className="block text-[10px] font-normal text-slate-500 ltr-num">
                                  {p.invoiceNumber}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-bold text-slate-900 block">{(p as any).studentName}</span>
                              <span className="text-[11px] text-slate-400 font-mono ltr-num">{(p as any).studentEmail}</span>
                            </td>
                            <td className="py-3 px-4 text-slate-700">{(p as any).courseTitle}</td>
                            <td className="py-3 px-4">
                              <span className="font-semibold text-slate-800 block">{translatePaymentMethod(t, p.paymentMethod)}</span>
                              <span className="text-[10px] text-slate-400 font-mono ltr-num">{p.transactionReference}</span>
                              {p.failureReason && (
                                <span className="block text-[10px] text-red-600">{p.failureReason}</span>
                              )}
                              {p.refundReason && (
                                <span className="block text-[10px] text-purple-700">{p.refundReason}</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-end font-mono font-bold text-slate-900 text-sm ltr-num">
                              {formatDzd(p.amountDzd, language)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className={`text-[11px] font-semibold ${
                                p.status === 'CONFIRMED'
                                  ? 'text-emerald-700'
                                  : p.status === 'REFUNDED'
                                  ? 'text-purple-700'
                                  : p.status === 'FAILED' || p.status === 'REJECTED'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                              }`}>
                                {translateStatus(t, p.status)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-end">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                {receiptUploadId && (
                                  <button
                                    type="button"
                                    onClick={() => api.downloadUpload(receiptUploadId, `justificatif_${p.receiptNumber}.pdf`)}
                                    className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
                                  >
                                    {t('admin.payments.proofBtn')}
                                  </button>
                                )}
                                {p.status === 'PENDING' && (
                                  <button
                                    onClick={() => handleConfirmPayment(p.id)}
                                    className="px-3 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md shadow-xs transition-colors whitespace-nowrap"
                                  >
                                    {t('admin.dashboard.validateAndActivate')}
                                  </button>
                                )}
                                {p.invoiceId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      api.downloadInvoicePdf(
                                        p.invoiceId!,
                                        `${p.invoiceNumber || p.receiptNumber}.pdf`
                                      )
                                    }
                                    className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
                                  >
                                    {t('billing.invoices.downloadPdfBtn')}
                                  </button>
                                )}
                                {p.status === 'CONFIRMED' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRefundTargetPayment(p);
                                      setRefundAmount(String(p.amountDzd));
                                      setRefundReason('');
                                    }}
                                    className="px-2.5 py-1 text-[11px] font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md transition-colors whitespace-nowrap"
                                  >
                                    {t('billing.refund.btn')}
                                  </button>
                                )}
                                <button
                                  onClick={() => setSelectedReceipt(p)}
                                  className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                                >
                                  {t('admin.payments.printReceiptBtn')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {paymentSubTab === 'installments' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {t('billing.installments.sectionTitle')}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {t('billing.installments.sectionSubtitle')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreatePlanModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('billing.installments.createPlanBtn')}</span>
                  </button>
                </div>

                {installmentPlans.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">{t('billing.installments.emptyAdmin')}</p>
                ) : (
                  <div className="space-y-4">
                    {installmentPlans.map((plan) => {
                      const pct =
                        plan.totalAmountDzd > 0
                          ? Math.min(100, Math.round((plan.paidAmountDzd / plan.totalAmountDzd) * 100))
                          : 0;
                      return (
                        <div
                          key={plan.id}
                          className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-slate-900">
                                {plan.studentName} · {plan.title}
                              </h4>
                              <span className="text-[11px] text-slate-500 font-mono ltr-num">
                                {t('billing.installments.paidProgress', {
                                  paid: formatDzd(plan.paidAmountDzd, language),
                                  total: formatDzd(plan.totalAmountDzd, language),
                                  percent: formatNumber(pct, language),
                                })}
                                {' · '}
                                {t('billing.installments.remainingAmount', {
                                  remaining: formatDzd(plan.remainingAmountDzd, language),
                                })}
                              </span>
                            </div>
                            <span className="font-semibold text-slate-700">
                              {translateStatus(t, plan.status)}
                            </span>
                          </div>

                          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[var(--tenant-secondary)] transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>

                          <div className="divide-y divide-slate-200 bg-white rounded-lg border border-slate-200">
                            {plan.items.map((item) => (
                              <div
                                key={item.id}
                                className="p-3 flex flex-wrap items-center justify-between gap-3"
                              >
                                <div>
                                  <span className="font-semibold text-slate-900">
                                    {t('billing.installments.trancheLabel', {
                                      num: item.installmentNumber,
                                      total: item.totalInstallments,
                                    })}
                                  </span>
                                  <span className="ms-2 text-[11px] text-slate-500 font-mono ltr-num">
                                    {t('billing.installments.dueDateLabel', {
                                      date: ensureWesternDigits(item.dueDate),
                                    })}
                                    {item.reminderCount > 0
                                      ? ` · ${t('billing.installments.remindersCount', {
                                          count: item.reminderCount,
                                        })}`
                                      : ''}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-mono font-bold text-slate-900 ltr-num">
                                    {formatDzd(item.amountDzd, language)}
                                  </span>
                                  <span
                                    className={`text-[11px] font-semibold ${
                                      item.status === 'PAID'
                                        ? 'text-emerald-700'
                                        : item.status === 'OVERDUE'
                                        ? 'text-red-700'
                                        : 'text-amber-700'
                                    }`}
                                  >
                                    {translateStatus(t, item.status)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {paymentSubTab === 'reminders' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Bell className="w-4 h-4 text-[var(--tenant-secondary)] shrink-0" />
                      <span>{t('billing.reminders.sectionTitle')}</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      {t('billing.reminders.sectionSubtitle')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={runningReminders}
                    onClick={handleRunReminders}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-opacity disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${runningReminders ? 'animate-spin' : ''}`} />
                    <span>
                      {runningReminders
                        ? t('billing.reminders.runningBtn')
                        : t('billing.reminders.runNowBtn')}
                    </span>
                  </button>
                </div>

                {reminders.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">{t('billing.reminders.empty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-start text-xs border border-slate-200 rounded-xl overflow-hidden">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-4 text-start">{t('billing.reminders.typeCol')}</th>
                          <th className="py-2.5 px-4 text-start">{t('billing.reminders.studentCol')}</th>
                          <th className="py-2.5 px-4 text-start">{t('billing.reminders.dueCol')}</th>
                          <th className="py-2.5 px-4 text-start">{t('billing.reminders.subjectCol')}</th>
                          <th className="py-2.5 px-4 text-end">{t('billing.reminders.sentAtCol')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {reminders.map((rem) => (
                          <tr key={rem.id} className="hover:bg-slate-50/60">
                            <td className="py-3 px-4 font-semibold text-slate-800">
                              {t(`billing.reminders.types.${rem.reminderType}`)}
                            </td>
                            <td className="py-3 px-4 text-slate-800">
                              {rem.studentName || rem.studentId}
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-700 ltr-num">
                              {ensureWesternDigits(rem.dueDate)} · {formatDzd(rem.amountDzd, language)}
                            </td>
                            <td className="py-3 px-4 text-slate-600">
                              <span className="block font-medium text-slate-900">{rem.subject}</span>
                              <span className="text-[10px] font-mono text-slate-400 ltr-num">
                                {rem.channel}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-end font-mono text-slate-500 ltr-num">
                              {formatDateTime(rem.sentAt, language)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {paymentSubTab === 'invoices' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[var(--tenant-secondary)] shrink-0" />
                    <span>{t('billing.invoices.sectionTitle')}</span>
                  </h3>
                  <p className="text-xs text-slate-500">{t('billing.invoices.sectionSubtitle')}</p>
                </div>

                {invoices.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">{t('billing.invoices.empty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-start text-xs border border-slate-200 rounded-xl overflow-hidden">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-4 text-start">{t('billing.invoices.invoiceNoCol')}</th>
                          <th className="py-2.5 px-4 text-start">{t('billing.invoices.dateCol')}</th>
                          <th className="py-2.5 px-4 text-start">{t('billing.invoices.studentCol')}</th>
                          <th className="py-2.5 px-4 text-end">{t('billing.invoices.htCol')}</th>
                          <th className="py-2.5 px-4 text-end">{t('billing.invoices.tvaCol')}</th>
                          <th className="py-2.5 px-4 text-end">{t('billing.invoices.ttcCol')}</th>
                          <th className="py-2.5 px-4 text-center">{t('billing.invoices.statusCol')}</th>
                          <th className="py-2.5 px-4 text-end">{t('billing.invoices.actionsCol')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-slate-50/60">
                            <td className="py-3 px-4 font-mono font-bold text-slate-900 ltr-num">
                              {ensureWesternDigits(inv.invoiceNumber)}
                              {inv.creditNoteNumber && (
                                <span className="block text-[10px] text-purple-700">
                                  {t('billing.invoices.creditNoteBadge', {
                                    number: ensureWesternDigits(inv.creditNoteNumber),
                                  })}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-600 ltr-num">
                              {ensureWesternDigits(inv.issuedAt.split('T')[0])}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-semibold text-slate-900 block">
                                {inv.buyerSnapshot.name}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400 ltr-num">
                                {inv.buyerSnapshot.studentIdNumber || inv.buyerSnapshot.email}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-700 ltr-num">
                              {formatDzd(inv.amountHtDzd, language)}
                            </td>
                            <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 ltr-num">
                              {inv.tvaApplicable && inv.tvaRatePercent > 0
                                ? `${formatDzd(inv.tvaAmountDzd, language)} (${inv.tvaRatePercent}%)`
                                : t('billing.invoices.tvaExemptShort')}
                            </td>
                            <td className="py-3 px-4 text-end font-mono font-bold tabular-nums text-slate-900 ltr-num">
                              {formatDzd(inv.amountTtcDzd, language)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span
                                className={`text-[11px] font-semibold ${
                                  inv.status === 'PAID' ? 'text-emerald-700' : 'text-purple-700'
                                }`}
                              >
                                {translateStatus(t, inv.status)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-end">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedInvoice(inv)}
                                  className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                                >
                                  {t('billing.invoices.previewBtn')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => api.downloadInvoicePdf(inv.id, `${inv.invoiceNumber}.pdf`)}
                                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
                                >
                                  <Download className="w-3 h-3 shrink-0" />
                                  <span>{t('billing.invoices.downloadPdfBtn')}</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: SÉANCES & VISIOCONFÉRENCE */}
        {/* ========================================================================= */}
        {activeTab === 'sessions' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-base font-bold text-slate-900">{t('admin.sessions.title')}</h2>
                <p className="text-xs text-slate-500">{t('admin.sessions.subtitle')}</p>
              </div>

              <button
                onClick={() => setShowCreateSessionModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                {t('admin.sessions.scheduleBtn')}
              </button>
            </div>

            <div className="space-y-3">
              {sessions.map(s => {
                const dateObj = new Date(s.scheduledAt);
                const isPast = dateObj < new Date();
                return (
                  <div key={s.id} className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 flex flex-col items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold uppercase">{formatDate(dateObj, language, { month: 'short' })}</span>
                        <span className="text-base font-extrabold font-mono leading-none ltr-num">{formatNumber(dateObj.getDate(), language)}</span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider ${
                            isPast ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}>
                            {translateStatus(t, s.status)}
                          </span>
                          <span className="text-xs text-slate-400 font-mono ltr-num">
                            {formatTime(dateObj, language)} ({formatNumber(s.durationMinutes, language)} {t('common.minutesShort')})
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900">{s.title}</h4>
                        <p className="text-xs text-slate-500 font-mono">
                          {t('admin.sessions.metaLine', {
                            className: (s as any).className,
                            meetingId: s.videoMeetingId,
                            provider: s.videoProvider,
                          })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={async () => {
                          const joinData = await api.joinSessionProtected(s.id);
                          setActiveLiveSession({ session: s, joinData });
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm"
                      >
                        <Video className="w-3.5 h-3.5" />
                        {t('admin.sessions.launchTestRoomBtn')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: SÉCURITÉ & PARAMÈTRES */}
        {/* ========================================================================= */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            
            {/* Zoom Integration Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{t('admin.security.zoomTitle')}</h3>
                  <p className="text-xs text-slate-500">
                    {t('admin.security.zoomSubtitle')}
                  </p>
                </div>
                <span className={`px-2.5 py-0.5 text-xs font-bold rounded-md uppercase tracking-wider ${
                  zoomTestMode ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {zoomTestMode ? t('admin.security.demoModeBadge') : t('admin.security.prodModeBadge')}
                </span>
              </div>

              <form onSubmit={handleSaveZoomSettings} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">{t('admin.security.zoomAccountId')}</label>
                    <input
                      type="text"
                      placeholder="abcdef123456"
                      value={zoomAccountId}
                      onChange={e => setZoomAccountId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">{t('admin.security.zoomClientId')}</label>
                    <input
                      type="text"
                      placeholder="XYZ987654"
                      value={zoomClientId}
                      onChange={e => setZoomClientId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">{t('admin.security.zoomClientSecret')}</label>
                    <input
                      type="password"
                      placeholder="••••••••••••••••"
                      value={zoomClientSecret}
                      onChange={e => setZoomClientSecret(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="zoomModeCheck"
                    checked={zoomTestMode}
                    onChange={e => setZoomTestMode(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <label htmlFor="zoomModeCheck" className="text-slate-700">
                    {t('admin.security.zoomDemoCheck')}
                  </label>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-2 font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm"
                  >
                    {t('admin.security.saveZoomBtn')}
                  </button>
                </div>
              </form>
            </div>

            {/* Chargily Pay V2 (CIB & Edahabia) Integration Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {t('billing.chargilySettings.title')}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {t('billing.chargilySettings.subtitle')}
                  </p>
                </div>
                <span
                  className={`text-xs font-bold ${
                    chargilyEnabled ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {chargilyEnabled
                    ? t('billing.chargilySettings.enabledBadge', {
                        mode: chargilyTestMode ? 'TEST' : 'LIVE',
                      })
                    : t('billing.chargilySettings.disabledBadge')}
                </span>
              </div>

              <form onSubmit={handleSaveChargilySettings} className="space-y-4 text-xs">
                <div className="flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chargilyEnabled}
                      onChange={(e) => setChargilyEnabled(e.target.checked)}
                      className="rounded text-blue-600"
                    />
                    <span className="font-medium text-slate-800">
                      {t('billing.chargilySettings.enableCheck')}
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chargilyTestMode}
                      onChange={(e) => setChargilyTestMode(e.target.checked)}
                      className="rounded text-blue-600"
                    />
                    <span className="text-slate-700">
                      {t('billing.chargilySettings.testModeCheck')}
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.chargilySettings.publicKeyLabel')}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      placeholder="test_pk_..."
                      value={chargilyPublicKey}
                      onChange={(e) => setChargilyPublicKey(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.chargilySettings.secretKeyLabel')}
                    </label>
                    <input
                      type="password"
                      dir="ltr"
                      placeholder="test_sk_..."
                      value={chargilySecretKey}
                      onChange={(e) => setChargilySecretKey(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.chargilySettings.webhookSecretLabel')}
                    </label>
                    <input
                      type="password"
                      dir="ltr"
                      placeholder="whsec_..."
                      value={chargilyWebhookSecret}
                      onChange={(e) => setChargilyWebhookSecret(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                    />
                  </div>
                </div>

                {chargilyWebhookUrl && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold text-slate-600 block">
                        {t('billing.chargilySettings.webhookUrlLabel')}
                      </span>
                      <code className="text-xs font-mono text-slate-900 break-all ltr-num">
                        {chargilyWebhookUrl}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(chargilyWebhookUrl);
                        setCopiedWebhookUrl(true);
                        setTimeout(() => setCopiedWebhookUrl(false), 2000);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>
                        {copiedWebhookUrl
                          ? t('billing.chargilySettings.copiedBtn')
                          : t('billing.chargilySettings.copyBtn')}
                      </span>
                    </button>
                  </div>
                )}

                <div className="pt-1 flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-2 font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-opacity shadow-xs"
                  >
                    {t('billing.chargilySettings.saveBtn')}
                  </button>
                </div>
              </form>
            </div>

            {/* Transactional SMTP Server, FR/AR HTML Templates & Persistent Outbox Queue */}
            <AdminSmtpQueuePanel
              smtpIntegration={integrations.find((i) => i.provider === 'EMAIL_SMTP')}
              onBanner={setAdminBanner}
              onConfigSaved={loadAllData}
            />

            {/* Audit Logs Stream */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{t('admin.security.auditTitle')}</h3>
                  <p className="text-xs text-slate-500">{t('admin.security.auditSubtitle')}</p>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {t('admin.security.eventsRecorded', { count: formatNumber(auditLogs.length, language) })}
                </span>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto">
                {auditLogs.map(log => (
                  <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 text-xs flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-blue-700 ltr-num">{log.action}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-semibold text-slate-800 ltr-num">{log.userEmail} ({log.userRole})</span>
                      </div>
                      <p className="text-slate-600 mt-1">{ensureWesternDigits(log.details)}</p>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0 ltr-num">
                      {formatDateTime(log.timestamp, language)} · {log.ipAddress}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Reset Demo Button */}
            <div className="flex justify-end pt-2">
              <button
                onClick={handleResetDemo}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-red-700 hover:text-white hover:bg-red-600 bg-red-50 border border-red-200 rounded-xl transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('admin.security.resetDemoBtn')}
              </button>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6B: IDENTITÉ VISUELLE, COORDONNÉES & QUOTAS DE L'ÉTABLISSEMENT */}
        {/* ========================================================================= */}
        {activeTab === 'branding' && (
          <div className="space-y-6">
            {/* SaaS Subscription & Quotas Summary */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {t('admin.branding.saasLicenseTitle')}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t('admin.branding.isolationIdLabel')}{' '}
                    <code className="font-mono font-semibold text-slate-700 ltr-num">{tenantDetails?.id || tenant?.id}</code> ·{' '}
                    {t('admin.branding.slugLabel')}{' '}
                    <code className="font-mono ltr-num">{tenantDetails?.slug || tenant?.slug}</code>
                  </p>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-700">
                  {t('admin.branding.offerBadge', {
                    plan: tenantDetails?.subscriptionPlan || 'ENTERPRISE',
                    status: translateStatus(t, tenantDetails?.subscriptionStatus || 'ACTIVE'),
                  })}
                </span>
              </div>

              {tenantUsage && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">{t('admin.branding.studentsQuota')}</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1 block ltr-num">
                      {formatNumber(tenantUsage.studentsCount, language)} / {formatNumber(tenantUsage.maxStudents, language)}
                    </span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">{t('admin.branding.teachersQuota')}</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1 block ltr-num">
                      {formatNumber(tenantUsage.teachersCount, language)} / {formatNumber(tenantUsage.maxTeachers, language)}
                    </span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">{t('admin.branding.publishedCourses')}</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1 block ltr-num">
                      {formatNumber(tenantUsage.coursesCount, language)}
                    </span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 block">{t('admin.branding.licenseExpiry')}</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1 block ltr-num">
                      {tenantDetails?.subscriptionEndDate ? formatDate(tenantDetails.subscriptionEndDate, language) : '—'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* White-Label Branding & Official Receipt Customization Form */}
            <form onSubmit={handleSaveBranding} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 text-xs">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  {t('admin.branding.formTitle')}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t('admin.branding.formSubtitle')}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.officialName')}</label>
                  <input
                    type="text"
                    required
                    value={brandName}
                    onChange={e => setBrandName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.shortName')}</label>
                  <input
                    type="text"
                    required
                    maxLength={8}
                    value={brandShortName}
                    onChange={e => setBrandShortName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono uppercase ltr-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.tagline')}</label>
                  <input
                    type="text"
                    value={brandTagline}
                    onChange={e => setBrandTagline(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.logoUrl')}</label>
                  <input
                    type="text"
                    value={brandLogoUrl}
                    onChange={e => setBrandLogoUrl(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.primaryColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandPrimaryColor}
                      onChange={e => setBrandPrimaryColor(e.target.value)}
                      className="h-9 w-12 rounded border border-slate-300 cursor-pointer"
                    />
                    <span className="font-mono text-slate-600 ltr-num">{brandPrimaryColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.secondaryColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandSecondaryColor}
                      onChange={e => setBrandSecondaryColor(e.target.value)}
                      className="h-9 w-12 rounded border border-slate-300 cursor-pointer"
                    />
                    <span className="font-mono text-slate-600 ltr-num">{brandSecondaryColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.accentColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandAccentColor}
                      onChange={e => setBrandAccentColor(e.target.value)}
                      className="h-9 w-12 rounded border border-slate-300 cursor-pointer"
                    />
                    <span className="font-mono text-slate-600 ltr-num">{brandAccentColor}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.schoolEmail')}</label>
                  <input
                    type="email"
                    required
                    value={brandEmail}
                    onChange={e => setBrandEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 ltr-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.phone')}</label>
                  <input
                    type="text"
                    required
                    value={brandPhone}
                    onChange={e => setBrandPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.supportHours')}</label>
                  <input
                    type="text"
                    value={brandSupportHours}
                    onChange={e => setBrandSupportHours(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.address')}</label>
                  <input
                    type="text"
                    required
                    value={brandAddress}
                    onChange={e => setBrandAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.city')}</label>
                  <input
                    type="text"
                    required
                    value={brandCity}
                    onChange={e => setBrandCity(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.wilaya')}</label>
                  <input
                    type="text"
                    required
                    value={brandWilaya}
                    onChange={e => setBrandWilaya(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.accreditationNo')}</label>
                  <input
                    type="text"
                    value={brandAccreditation}
                    onChange={e => setBrandAccreditation(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.taxId')}</label>
                  <input
                    type="text"
                    value={brandTaxId}
                    onChange={e => setBrandTaxId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.receiptPrefix')}</label>
                  <input
                    type="text"
                    required
                    maxLength={12}
                    value={brandReceiptPrefix}
                    onChange={e => setBrandReceiptPrefix(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('admin.branding.receiptFooter')}</label>
                <input
                  type="text"
                  value={brandReceiptFooter}
                  onChange={e => setBrandReceiptFooter(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                />
              </div>

              {/* Fiscal Identifiers, TVA & Sequential PDF Invoicing */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    {t('billing.fiscalSettings.sectionTitle')}
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {t('billing.fiscalSettings.sectionSubtitle')}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.fiscalSettings.nifLabel')}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={brandNif}
                      onChange={(e) => setBrandNif(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.fiscalSettings.nisLabel')}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={brandNis}
                      onChange={(e) => setBrandNis(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.fiscalSettings.rcLabel')}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={brandRc}
                      onChange={(e) => setBrandRc(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.fiscalSettings.aiLabel')}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={brandArticleImposition}
                      onChange={(e) => setBrandArticleImposition(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.fiscalSettings.invoicePrefixLabel')}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      maxLength={14}
                      value={brandInvoicePrefix}
                      onChange={(e) => setBrandInvoicePrefix(e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                    />
                    <span className="text-[10px] font-mono text-slate-500 mt-0.5 block ltr-num">
                      {t('billing.fiscalSettings.nextSeqHint', {
                        next: `${brandInvoicePrefix || 'FAC'}-${new Date().getFullYear()}-${String(
                          tenantDetails?.invoiceNextSequence || 1
                        ).padStart(5, '0')}`,
                      })}
                    </span>
                  </div>

                  <div className="pb-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={brandTvaApplicable}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setBrandTvaApplicable(checked);
                          if (checked && brandTvaRatePercent === 0) {
                            setBrandTvaRatePercent(19);
                          }
                        }}
                        className="rounded text-blue-600"
                      />
                      <span className="font-semibold text-slate-800">
                        {t('billing.fiscalSettings.tvaApplicableCheck')}
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('billing.fiscalSettings.tvaRateLabel')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      dir="ltr"
                      disabled={!brandTvaApplicable}
                      value={brandTvaApplicable ? brandTvaRatePercent : 0}
                      onChange={(e) => setBrandTvaRatePercent(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start disabled:opacity-50 ltr-num"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('billing.fiscalSettings.invoiceFooterLabel')}
                  </label>
                  <input
                    type="text"
                    value={brandInvoiceFooter}
                    onChange={(e) => setBrandInvoiceFooter(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={brandEnforceSingleSession}
                    onChange={e => setBrandEnforceSingleSession(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span className="text-slate-700 font-medium">{t('admin.branding.enforceSingleSession')}</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={brandAllowManualPayments}
                    onChange={e => setBrandAllowManualPayments(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span className="text-slate-700 font-medium">{t('admin.branding.allowManualPayments')}</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={brandAllowInstallments}
                    onChange={e => setBrandAllowInstallments(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span className="text-slate-700 font-medium">{t('billing.fiscalSettings.allowInstallmentsCheck')}</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={brandAutoRemindersEnabled}
                    onChange={e => setBrandAutoRemindersEnabled(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span className="text-slate-700 font-medium">{t('billing.fiscalSettings.autoRemindersCheck')}</span>
                </label>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={savingBranding}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-[var(--tenant-primary)] hover:opacity-95 rounded-xl transition-opacity disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  {savingBranding ? t('common.saving') : t('admin.branding.saveBtn')}
                </button>
              </div>
            </form>

            {tenantContracts.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">{t('admin.branding.contractsHistoryTitle')}</h3>
                <div className="divide-y divide-slate-100 text-xs">
                  {tenantContracts.map(c => (
                    <div key={c.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                      <span className="font-mono font-bold text-slate-800 ltr-num">{c.invoiceNumber}</span>
                      <span>
                        {t('admin.branding.planWithCycle', {
                          plan: c.planCode,
                          cycle: c.billingCycle === 'ANNUAL' ? t('superAdmin.contracts.annual') : t('superAdmin.contracts.monthly'),
                        })}
                      </span>
                      <span className="font-mono text-slate-500 ltr-num">
                        {formatDate(c.startDate, language)} → {formatDate(c.endDate, language)}
                      </span>
                      <span className="font-mono font-bold tabular-nums text-emerald-700 ltr-num">
                        {formatDzd(c.amountDzd, language)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 7: TESTS AUTOMATISÉS (32 tests) */}
        {/* ========================================================================= */}
        {activeTab === 'tests' && (
          <div className="space-y-6">
            
            <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
              <div className="space-y-1">
                <span className="text-xs font-mono text-[var(--tenant-secondary)] font-semibold uppercase">
                  {t('admin.tests.kicker')}
                </span>
                <h2 className="text-lg font-bold text-slate-900">
                  {t('admin.tests.title')}
                </h2>
                <p className="text-xs text-slate-500">
                  {t('admin.tests.subtitle')}
                </p>
              </div>

              <button
                onClick={handleRunTests}
                disabled={runningTests}
                className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl shadow-sm transition-all disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 fill-white rtl-flip" />
                {runningTests ? t('admin.tests.runningBtn') : t('admin.tests.runBtn')}
              </button>
            </div>

            {/* Test Summary Banner */}
            {testResults && (
              <div className={`p-5 rounded-2xl border flex items-center justify-between gap-4 ${
                testResults.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
              }`}>
                <div className="flex items-center gap-3">
                  {testResults.success ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-600 shrink-0" />
                  )}
                  <div>
                    <h3 className="text-sm font-bold">
                      {testResults.success
                        ? t('admin.tests.fullSuccess', {
                            passed: formatNumber(testResults.totalPassed, language),
                            total: formatNumber(testResults.totalTests, language),
                          })
                        : t('admin.tests.partialSuccess', {
                            passed: formatNumber(testResults.totalPassed, language),
                            total: formatNumber(testResults.totalTests, language),
                          })}
                    </h3>
                    <p className="text-xs opacity-80">
                      {t('admin.tests.totalDuration', { ms: formatNumber(testResults.durationMs, language) })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 32 Tests List */}
            <div className="space-y-3">
              {(testResults?.results || [
                { id: 1, name: '1. Création et connexion étudiant (Argon2id)', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 2, name: '2. Authentification administrateur et enseignant', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 3, name: '3. Contrôle d’accès RBAC vertical', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 4, name: '4. Inscription relationnelle étudiant -> classe', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 5, name: '5. Transaction atomique paiement + activation abonnement', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 6, name: '6. Blocage visioconférence pour abonnement expiré', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 7, name: '7. Politique de session unique par étudiant', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 8, name: '8. Création et mise à jour d’une séance', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 9, name: '9. Affectation relationnelle enseignant <-> classe', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 10, name: '10. Saisie des présences et contrainte UNIQUE (Upsert)', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 11, name: '11. Agrégation des statistiques réelles PostgreSQL', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 12, name: '12. Contrainte UNIQUE PostgreSQL sur users.email', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 13, name: '13. Validation des formulaires et montants DZD', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 14, name: '14. Preuve d’atomicité et ROLLBACK PostgreSQL', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 15, name: '15. Intégrité des entités PostgreSQL & Isolation', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 16, name: '16. Migration transparente PBKDF2 -> Argon2id', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 17, name: '17. Cookies HttpOnly + Secure + SameSite=Strict & CSRF', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 18, name: '18. Rate Limiting persistant par IP et par Compte', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 19, name: '19. Politique de mot de passe robuste (12+ car.)', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 20, name: '20. Expiration et rotation atomique des sessions', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 21, name: '21. Politique CORS restreinte & En-têtes Helmet', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 22, name: '22. Validation stricte Zod (.strict()) & Anti-XSS', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 23, name: '23. Neutralisation d’injection de formules CSV', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 24, name: '24. Sécurisation des uploads (MIME, Magic Bytes, UUID)', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 25, name: '25. Vérification Rôle + Propriété (Anti-IDOR)', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 26, name: '26. Audit immuable des attaques bloquées', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 27, name: '27. Isolation SQL automatique tdb + AsyncLocalStorage', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 28, name: '28. Blocage d’usurpation X-Tenant-Id & Fichiers privés', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 29, name: '29. Unicité composite par établissement (ETU-2026-001)', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 30, name: '30. Suspension & expiration d’abonnement SaaS école', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 31, name: '31. Marque blanche & reçus personnalisés par école', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
                { id: 32, name: '32. Gouvernance SUPER_ADMIN & onboarding transactionnel', description: '', passed: true, durationMs: 0, details: t('admin.messages.readyToRun') },
              ]).map(test => (
                <div
                  key={test.id}
                  className={`bg-white rounded-2xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs transition-all ${
                    testResults ? (test.passed ? 'border-emerald-200' : 'border-red-200') : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs shrink-0 ltr-num ${
                      testResults ? (test.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800') : 'bg-slate-100 text-slate-700'
                    }`}>
                      {formatNumber(test.id, language)}
                    </span>
                    <div>
                      <h4 className="font-bold text-slate-900">{ensureWesternDigits(test.name)}</h4>
                      <p className="text-slate-500 mt-0.5">{ensureWesternDigits(test.details)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-slate-400 tabular-nums ltr-num">
                      {formatNumber(test.durationMs, language)} {t('common.msShort')}
                    </span>
                    <span className={`px-2.5 py-0.5 font-bold rounded-md uppercase tracking-wider text-[10px] ${
                      testResults ? (test.passed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200') : 'bg-slate-100 text-slate-600'
                    }`}>
                      {testResults ? (test.passed ? t('common.passed') : t('common.failed')) : t('common.pending')}
                    </span>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

      </div>

      {/* Student Details Drawer (logical inline-end positioning for LTR & RTL) */}
      {selectedStudentDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white h-full shadow-2xl border-s border-slate-200 p-6 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{selectedStudentDrawer.name}</h3>
                  <p className="text-xs text-slate-500 font-mono ltr-num">
                    {selectedStudentDrawer.profile?.studentIdNumber || t('common.studentFallback')}
                  </p>
                </div>
                <button onClick={() => setSelectedStudentDrawer(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>

              <div className="space-y-4 text-xs">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <p className="text-slate-500">{t('admin.drawer.contactInfo')}</p>
                  <p className="font-semibold text-slate-800">
                    {t('admin.drawer.emailLabel')} <span className="ltr-num">{selectedStudentDrawer.email}</span>
                  </p>
                  <p className="text-slate-700">
                    {t('admin.drawer.phoneLabel')}{' '}
                    <span className="ltr-num">{selectedStudentDrawer.phone || t('common.notProvided')}</span>
                  </p>
                  <p className="text-slate-700">
                    {t('admin.drawer.wilayaLabel')} {ensureWesternDigits(selectedStudentDrawer.profile?.wilaya || t('common.algeria'))}
                  </p>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <p className="text-slate-500">{t('admin.drawer.subStatus')}</p>
                  <p className="font-semibold text-slate-800">
                    {selectedStudentDrawer.hasActiveSubscription
                      ? t('admin.drawer.validUntil', {
                          date: formatDate(selectedStudentDrawer.subscription?.endDate, language),
                        })
                      : t('admin.drawer.expiredOrPending')}
                  </p>
                </div>

                <div className="space-y-2">
                  <span className="font-semibold text-slate-700 block">{t('admin.drawer.adminActions')}</span>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleUpdateStudentStatus(selectedStudentDrawer.id, 'ACTIVE')}
                      className="py-2 text-center text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                    >
                      {t('admin.drawer.activate')}
                    </button>
                    <button
                      onClick={() => handleUpdateStudentStatus(selectedStudentDrawer.id, 'SUSPENDED')}
                      className="py-2 text-center text-xs font-semibold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                    >
                      {t('admin.drawer.suspend')}
                    </button>
                    <button
                      onClick={() => handleUpdateStudentStatus(selectedStudentDrawer.id, 'ARCHIVED')}
                      className="py-2 text-center text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300"
                    >
                      {t('admin.drawer.archive')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedStudentDrawer(null)}
              className="w-full py-2.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors mt-6"
            >
              {t('admin.drawer.closeBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Modal Import CSV */}
      {showImportCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden text-slate-800">
            <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-900">{t('admin.modals.importCsvTitle')}</h3>
              <button onClick={() => setShowImportCsvModal(false)}>✕</button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-500">
                {t('admin.modals.importCsvHint')} <br />
                <code className="text-blue-700 font-mono font-semibold ltr-num">{t('admin.modals.importCsvColumns')}</code>
              </p>

              <textarea
                rows={5}
                dir="ltr"
                value={csvContent}
                onChange={e => setCsvContent(e.target.value)}
                placeholder={'Mohamed Lamine,m.lamine@gmail.com,0555001122,Alger,16 - Alger\nSalima Bensaid,s.bensaid@gmail.com,0555334455,Oran,31 - Oran'}
                className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs focus:outline-none focus:border-blue-500 text-left"
              />

              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleCsvPreview}
                  className="px-4 py-2 font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  {t('admin.modals.previewValidateBtn')}
                </button>
                {csvPreviewReport && (
                  <button
                    type="button"
                    onClick={handleCsvExecute}
                    className="px-4 py-2 font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors"
                  >
                    {t('admin.modals.confirmImportBtn', { count: formatNumber(csvPreviewReport.validCount, language) })}
                  </button>
                )}
              </div>

              {csvPreviewReport && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex flex-wrap justify-between gap-2 font-semibold">
                    <span className="text-emerald-700">
                      {t('admin.modals.validRows', { count: formatNumber(csvPreviewReport.validCount, language) })}
                    </span>
                    <span className="text-amber-700">
                      {t('admin.modals.duplicatesCount', { count: formatNumber(csvPreviewReport.duplicatesCount, language) })}
                    </span>
                    {typeof csvPreviewReport.formulaNeutralizedCount === 'number' &&
                      csvPreviewReport.formulaNeutralizedCount > 0 && (
                        <span className="text-red-700">
                          {t('admin.modals.formulasNeutralized', {
                            count: formatNumber(csvPreviewReport.formulaNeutralizedCount, language),
                          })}
                        </span>
                      )}
                  </div>
                  {csvPreviewReport.errors?.length > 0 && (
                    <div className="text-red-700 space-y-0.5 text-[11px]">
                      {csvPreviewReport.errors.map((err: string, i: number) => (
                        <p key={i}>· {ensureWesternDigits(err)}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Création Étudiant */}
      {showCreateStudentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden text-slate-800">
            <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-900">{t('admin.modals.createStudentTitle')}</h3>
              <button onClick={() => setShowCreateStudentModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateStudent} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.fullName')}</label>
                <input
                  type="text"
                  required
                  placeholder="Anis Belhadj"
                  value={newStuName}
                  onChange={e => setNewStuName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.email')}</label>
                  <input
                    type="email"
                    required
                    placeholder="anis.belhadj@etu.dz"
                    value={newStuEmail}
                    onChange={e => setNewStuEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 ltr-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.phone')}</label>
                  <input
                    type="text"
                    placeholder="+213 550 00 00 00"
                    value={newStuPhone}
                    onChange={e => setNewStuPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.wilaya')}</label>
                  <select
                    value={newStuWilaya}
                    onChange={e => setNewStuWilaya(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="16 - Alger">16 - Alger</option>
                    <option value="31 - Oran">31 - Oran</option>
                    <option value="25 - Constantine">25 - Constantine</option>
                    <option value="23 - Annaba">23 - Annaba</option>
                    <option value="19 - Sétif">19 - Sétif</option>
                    <option value="09 - Blida">09 - Blida</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.city')}</label>
                  <input
                    type="text"
                    value={newStuCity}
                    onChange={e => setNewStuCity(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.assignedClass')}</label>
                <select
                  value={newStuClassId}
                  onChange={e => setNewStuClassId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  <option value="">{t('admin.modals.selectClass')}</option>
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateStudentModal(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm"
                >
                  {t('admin.modals.createStudentSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Création Règlement */}
      {showCreatePaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden text-slate-800">
            <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-900">{t('admin.modals.createPaymentTitle')}</h3>
              <button onClick={() => setShowCreatePaymentModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreatePayment} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.beneficiaryStudent')}</label>
                <select
                  required
                  value={newPayStudentId}
                  onChange={e => setNewPayStudentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  <option value="">{t('admin.modals.selectStudent')}</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.courseConcerned')}</label>
                <select
                  value={newPayCourseId}
                  onChange={e => setNewPayCourseId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.paymentMethod')}</label>
                  <select
                    value={newPayMethod}
                    onChange={e => setNewPayMethod(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="BARIDIMOB_CCP">{t('paymentMethods.BARIDIMOB_CCP')}</option>
                    <option value="BANK_TRANSFER">{t('paymentMethods.BANK_TRANSFER_BNA')}</option>
                    <option value="CASH">{t('paymentMethods.CASH')}</option>
                    <option value="CHEQUE">{t('paymentMethods.CHEQUE_CERTIFIED')}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.amountDzd')}</label>
                  <input
                    type="number"
                    value={newPayAmount}
                    onChange={e => setNewPayAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono font-bold ltr-num"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.receiptRef')}</label>
                <input
                  type="text"
                  placeholder={t('admin.modals.receiptRefPlaceholder')}
                  value={newPayRef}
                  onChange={e => setNewPayRef(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreatePaymentModal(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm"
                >
                  {t('admin.modals.createPaymentSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Création Séance */}
      {showCreateSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden text-slate-800">
            <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-900">{t('admin.modals.createSessionTitle')}</h3>
              <button onClick={() => setShowCreateSessionModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateSession} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.sessionTitle')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('admin.modals.sessionTitlePlaceholder')}
                  value={newSesTitle}
                  onChange={e => setNewSesTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.classConcerned')}</label>
                <select
                  required
                  value={newSesClassId}
                  onChange={e => setNewSesClassId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  <option value="">{t('admin.modals.selectClass')}</option>
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.dateTimeAlgiers')}</label>
                  <input
                    type="datetime-local"
                    required
                    value={newSesDate}
                    onChange={e => setNewSesDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('admin.modals.durationMinutes')}</label>
                  <input
                    type="number"
                    value={newSesDuration}
                    onChange={e => setNewSesDuration(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateSessionModal(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm"
                >
                  {t('admin.modals.createSessionSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Receipt Modal */}
      {selectedReceipt && (
        <ReceiptModal
          payment={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
        />
      )}

      {/* Sequential Fiscal Invoice Modal */}
      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {/* Refund & Credit Note Modal */}
      {refundTargetPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden text-slate-800">
            <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-900">{t('billing.refund.modalTitle')}</h3>
              <button onClick={() => setRefundTargetPayment(null)}>✕</button>
            </div>

            <form onSubmit={handleRefundSubmit} className="p-6 space-y-4 text-xs">
              <p className="text-slate-600 leading-relaxed">
                {t('billing.refund.modalSubtitle')}
              </p>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('billing.refund.amountLabel')}
                </label>
                <input
                  type="number"
                  min={100}
                  max={refundTargetPayment.amountDzd}
                  required
                  dir="ltr"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono font-bold text-start ltr-num"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('billing.refund.reasonLabel')}
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  placeholder={t('billing.refund.reasonPlaceholder')}
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setRefundTargetPayment(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={refundSubmitting}
                  className="px-5 py-2 font-bold text-white bg-purple-700 hover:bg-purple-600 rounded-xl transition-colors disabled:opacity-60"
                >
                  {refundSubmitting ? t('billing.refund.processing') : t('billing.refund.confirmBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Création Échéancier (Paiement en plusieurs fois) */}
      {showCreatePlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden text-slate-800">
            <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-900">
                {t('billing.installments.newPlanModalTitle')}
              </h3>
              <button onClick={() => setShowCreatePlanModal(false)}>✕</button>
            </div>

            <form onSubmit={handleCreateInstallmentPlan} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('admin.modals.beneficiaryStudent')}
                </label>
                <select
                  required
                  value={planStudentId}
                  onChange={(e) => setPlanStudentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  <option value="">{t('admin.modals.selectStudent')}</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('admin.modals.courseConcerned')}
                </label>
                <select
                  value={planCourseId}
                  onChange={(e) => setPlanCourseId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} — {formatDzd(c.priceDzd, language)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('billing.installments.installmentsCountLabel')}
                  </label>
                  <select
                    value={planCount}
                    onChange={(e) => setPlanCount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono ltr-num"
                  >
                    <option value="2">2x</option>
                    <option value="3">3x</option>
                    <option value="4">4x</option>
                    <option value="6">6x</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('billing.installments.intervalDaysLabel')}
                  </label>
                  <input
                    type="number"
                    min={7}
                    max={90}
                    dir="ltr"
                    value={planIntervalDays}
                    onChange={(e) => setPlanIntervalDays(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('billing.installments.firstDueDateLabel')}
                  </label>
                  <input
                    type="date"
                    dir="ltr"
                    value={planFirstDueDate}
                    onChange={(e) => setPlanFirstDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('billing.installments.totalAmountLabel')}
                  </label>
                  <input
                    type="number"
                    dir="ltr"
                    placeholder="Auto (prix formation)"
                    value={planTotalAmount}
                    onChange={(e) => setPlanTotalAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start ltr-num"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('billing.installments.notesLabel')}
                  </label>
                  <input
                    type="text"
                    value={planNotes}
                    onChange={(e) => setPlanNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreatePlanModal(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors"
                >
                  {t('billing.installments.createSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live Classroom Modal */}
      {activeLiveSession && (
        <LiveClassroomModal
          session={activeLiveSession.session}
          joinData={activeLiveSession.joinData}
          currentUserName={user?.name || t('common.adminFallback')}
          onClose={() => setActiveLiveSession(null)}
        />
      )}

    </div>
  );
};

