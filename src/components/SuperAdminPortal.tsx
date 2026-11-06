/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building,
  Plus,
  Search,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  Edit3,
  CreditCard,
  RefreshCw,
  Play,
  Users,
  TrendingUp,
  FileText,
  Power,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { translateStatus } from '../i18n/index.js';
import { ensureWesternDigits, formatDzd, formatNumber } from '../i18n/format.js';
import type {
  SuperAdminOverviewStats,
  SuperAdminTenantSummary,
  TenantSubscription,
  TenantPlanCode,
  PaymentMethod,
  AutomatedTestCaseResult,
} from '../types/index.js';

export const SuperAdminPortal: React.FC = () => {
  const { t } = useTranslation();
  const { inspectTenantAsSuperAdmin, refreshPublicTenants, language } = useAuth();

  const [activeTab, setActiveTab] = useState<'tenants' | 'contracts' | 'tests'>('tenants');
  const [stats, setStats] = useState<SuperAdminOverviewStats | null>(null);
  const [tenants, setTenants] = useState<SuperAdminTenantSummary[]>([]);
  const [contracts, setContracts] = useState<TenantSubscription[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL');
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create Tenant Modal State
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [newTagline, setNewTagline] = useState('');
  const [newLogoUrl, setNewLogoUrl] = useState('');
  const [newPrimaryColor, setNewPrimaryColor] = useState('#1E293B');
  const [newSecondaryColor, setNewSecondaryColor] = useState('#2563EB');
  const [newAccentColor, setNewAccentColor] = useState('#059669');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('+213 550 00 00 00');
  const [newAddress, setNewAddress] = useState('');
  const [newCity, setNewCity] = useState('Constantine');
  const [newWilaya, setNewWilaya] = useState('25 - Constantine');
  const [newAccreditation, setNewAccreditation] = useState('2026/ENS-SUP/DZ');
  const [newTaxId, setNewTaxId] = useState('002625019044120');
  const [newReceiptPrefix, setNewReceiptPrefix] = useState('REC-EST');
  const [newPlan, setNewPlan] = useState<TenantPlanCode>('PRO');
  const [newBillingCycle, setNewBillingCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [newMonthlyFee, setNewMonthlyFee] = useState('49000');
  const [newMaxStudents, setNewMaxStudents] = useState('350');
  const [newMaxTeachers, setNewMaxTeachers] = useState('30');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('Directeur2026!');

  // Edit Tenant Quotas / Plan Modal State
  const [editingTenant, setEditingTenant] = useState<SuperAdminTenantSummary | null>(null);
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [editName, setEditName] = useState('');
  const [editPlan, setEditPlan] = useState<TenantPlanCode>('PRO');
  const [editMonthlyFee, setEditMonthlyFee] = useState('49000');
  const [editMaxStudents, setEditMaxStudents] = useState('350');
  const [editMaxTeachers, setEditMaxTeachers] = useState('30');
  const [editEndDate, setEditEndDate] = useState('');
  const [editPrimaryColor, setEditPrimaryColor] = useState('#101B33');
  const [editSecondaryColor, setEditSecondaryColor] = useState('#2457C5');
  const [editAccentColor, setEditAccentColor] = useState('#16845B');

  // Renew SaaS Subscription Modal State
  const [renewTenant, setRenewTenant] = useState<SuperAdminTenantSummary | null>(null);
  const [renewSaving, setRenewSaving] = useState<boolean>(false);
  const [renewPlan, setRenewPlan] = useState<TenantPlanCode>('PRO');
  const [renewCycle, setRenewCycle] = useState<'MONTHLY' | 'ANNUAL'>('ANNUAL');
  const [renewAmount, setRenewAmount] = useState('490000');
  const [renewEndDate, setRenewEndDate] = useState('2027-12-31');
  const [renewMethod, setRenewMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [renewNotes, setRenewNotes] = useState('');

  // Multi-Tenant & Security Test Runner State
  const [runningTests, setRunningTests] = useState<boolean>(false);
  const [testResults, setTestResults] = useState<{
    success: boolean;
    totalPassed: number;
    totalTests: number;
    durationMs: number;
    results: AutomatedTestCaseResult[];
  } | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getSuperAdminOverview();
      setStats(res.stats);
      setTenants(res.tenants || []);
      setContracts(res.contracts || []);
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err.message || t('common.failed'),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handlePlanDefaults = (plan: TenantPlanCode) => {
    setNewPlan(plan);
    if (plan === 'STARTER') {
      setNewMonthlyFee('25000');
      setNewMaxStudents('120');
      setNewMaxTeachers('12');
    } else if (plan === 'PRO') {
      setNewMonthlyFee('49000');
      setNewMaxStudents('400');
      setNewMaxTeachers('35');
    } else {
      setNewMonthlyFee('89000');
      setNewMaxStudents('1500');
      setNewMaxTeachers('120');
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    setCreating(true);
    try {
      const res = await api.createSuperAdminTenant({
        name: newName.trim(),
        slug: newSlug.trim().toLowerCase(),
        shortName: newShortName.trim().toUpperCase(),
        tagline: newTagline.trim() || undefined,
        logoUrl: newLogoUrl.trim() || undefined,
        primaryColor: newPrimaryColor,
        secondaryColor: newSecondaryColor,
        accentColor: newAccentColor,
        contactEmail: newContactEmail.trim(),
        contactPhone: newContactPhone.trim(),
        address: newAddress.trim(),
        city: newCity.trim(),
        wilaya: newWilaya.trim(),
        accreditationNumber: newAccreditation.trim() || undefined,
        taxId: newTaxId.trim() || undefined,
        receiptPrefix: newReceiptPrefix.trim().toUpperCase() || undefined,
        subscriptionPlan: newPlan,
        billingCycle: newBillingCycle,
        monthlyFeeDzd: Number(newMonthlyFee),
        maxStudents: Number(newMaxStudents),
        maxTeachers: Number(newMaxTeachers),
        adminName: newAdminName.trim(),
        adminEmail: newAdminEmail.trim().toLowerCase(),
        adminPassword: newAdminPassword,
      });

      setShowCreateModal(false);
      setNewName('');
      setNewSlug('');
      setNewShortName('');
      setNewTagline('');
      setNewLogoUrl('');
      setNewContactEmail('');
      setNewAddress('');
      setNewAdminName('');
      setNewAdminEmail('');
      setBanner({
        type: 'success',
        message: `${res.message} (${ensureWesternDigits(res.contract.invoiceNumber)})`,
      });
      await Promise.all([loadOverview(), refreshPublicTenants()]);
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err.message || t('common.failed'),
      });
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (tnt: SuperAdminTenantSummary) => {
    setEditingTenant(tnt);
    setEditName(tnt.name);
    setEditPlan(tnt.subscriptionPlan);
    setEditMonthlyFee(String(tnt.monthlyFeeDzd));
    setEditMaxStudents(String(tnt.settings?.maxStudents || 300));
    setEditMaxTeachers(String(tnt.settings?.maxTeachers || 25));
    setEditEndDate(tnt.subscriptionEndDate);
    setEditPrimaryColor(tnt.primaryColor);
    setEditSecondaryColor(tnt.secondaryColor);
    setEditAccentColor(tnt.accentColor);
  };

  const handleSaveEditTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;
    setEditSaving(true);
    setBanner(null);
    try {
      const res = await api.updateSuperAdminTenant(editingTenant.id, {
        name: editName.trim(),
        subscriptionPlan: editPlan,
        monthlyFeeDzd: Number(editMonthlyFee),
        maxStudents: Number(editMaxStudents),
        maxTeachers: Number(editMaxTeachers),
        subscriptionEndDate: editEndDate,
        primaryColor: editPrimaryColor,
        secondaryColor: editSecondaryColor,
        accentColor: editAccentColor,
      });
      setEditingTenant(null);
      setBanner({ type: 'success', message: res.message });
      await Promise.all([loadOverview(), refreshPublicTenants()]);
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || t('common.failed') });
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleTenantSuspension = async (tnt: SuperAdminTenantSummary) => {
    setBanner(null);
    const willSuspend = tnt.status === 'ACTIVE';
    try {
      const res = await api.updateSuperAdminTenant(tnt.id, {
        status: willSuspend ? 'SUSPENDED' : 'ACTIVE',
        subscriptionStatus: willSuspend ? 'SUSPENDED' : 'ACTIVE',
      });
      setBanner({ type: 'success', message: res.message });
      await Promise.all([loadOverview(), refreshPublicTenants()]);
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err.message || t('common.failed'),
      });
    }
  };

  const openRenewModal = (tnt: SuperAdminTenantSummary) => {
    setRenewTenant(tnt);
    setRenewPlan(tnt.subscriptionPlan);
    setRenewCycle('ANNUAL');
    setRenewAmount(String(tnt.monthlyFeeDzd * 10));
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    setRenewEndDate(nextYear.toISOString().split('T')[0]);
    setRenewMethod('BANK_TRANSFER');
    setRenewNotes(t('superAdmin.modals.defaultRenewNotes'));
  };

  const handleCreateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewTenant) return;
    setRenewSaving(true);
    setBanner(null);
    try {
      const res = await api.createTenantSubscription(renewTenant.id, {
        planCode: renewPlan,
        billingCycle: renewCycle,
        amountDzd: Number(renewAmount),
        maxStudents: renewTenant.settings?.maxStudents || 400,
        maxTeachers: renewTenant.settings?.maxTeachers || 35,
        endDate: renewEndDate,
        paymentMethod: renewMethod,
        notes: renewNotes.trim() || undefined,
      });
      setRenewTenant(null);
      setBanner({
        type: 'success',
        message: `${res.message} (${ensureWesternDigits(res.contract.invoiceNumber)})`,
      });
      await Promise.all([loadOverview(), refreshPublicTenants()]);
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err.message || t('common.failed'),
      });
    } finally {
      setRenewSaving(false);
    }
  };

  const handleRunTests = async () => {
    setRunningTests(true);
    setBanner(null);
    try {
      const res = await api.runTestSuite();
      setTestResults(res);
      await Promise.all([loadOverview(), refreshPublicTenants()]);
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err.message || t('common.failed'),
      });
    } finally {
      setRunningTests(false);
    }
  };

  const filteredTenants = tenants.filter((tnt) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      tnt.name.toLowerCase().includes(q) ||
      tnt.slug.toLowerCase().includes(q) ||
      tnt.city.toLowerCase().includes(q) ||
      tnt.wilaya.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'ALL' || tnt.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex-1 flex flex-col bg-[#F5F7FB] min-h-screen text-[#17243A]">
      {/* Sub-Header Navigation */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                <Building className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-900 leading-tight">
                  {t('superAdmin.headerTitle')}
                </h1>
                <p className="text-xs text-slate-500">
                  {t('superAdmin.headerSubtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {[
                { key: 'tenants', label: t('superAdmin.tabs.tenants'), icon: Building },
                { key: 'contracts', label: t('superAdmin.tabs.contracts'), icon: CreditCard },
                { key: 'tests', label: t('superAdmin.tabs.tests'), icon: ShieldCheck },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key as 'tenants' | 'contracts' | 'tests')}
                    className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 transition-colors ${
                      isActive
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">
        {banner && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between gap-4 text-xs ${
              banner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {banner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span className="font-medium">{banner.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-slate-500 hover:text-slate-800 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* SaaS KPI Strip */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{t('superAdmin.kpis.deployedTenants')}</span>
                <Building className="w-4 h-4 text-slate-400 shrink-0" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 ltr-num">
                  {formatNumber(stats.activeTenants, language)}
                </span>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {t('superAdmin.kpis.activeAndSuspended', {
                    total: formatNumber(stats.totalTenants, language),
                    suspended: formatNumber(stats.suspendedTenants, language),
                  })}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {t('superAdmin.kpis.automaticPartitioning')}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{t('superAdmin.kpis.mrrTitle')}</span>
                <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 ltr-num">
                  {formatNumber(stats.mrrDzd, language)}
                </span>
                <span className="text-xs font-mono text-slate-500">{t('common.dzdPerMonth')}</span>
              </div>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                {t('superAdmin.kpis.arrProjected', { amount: formatDzd(stats.arrDzd, language) })}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{t('superAdmin.kpis.multiSchoolUsers')}</span>
                <Users className="w-4 h-4 text-blue-600 shrink-0" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 ltr-num">
                  {formatNumber(stats.totalStudentsAcrossTenants, language)}
                </span>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {t('superAdmin.kpis.studentsAndTeachers', {
                    teachers: formatNumber(stats.totalTeachersAcrossTenants, language),
                  })}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {t('superAdmin.kpis.compositeUniqueness')}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{t('superAdmin.kpis.b2bBilling')}</span>
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 ltr-num">
                  {formatNumber(stats.totalB2bBilledDzd, language)}
                </span>
                <span className="text-xs font-mono text-slate-500">{t('superAdmin.kpis.dzdB2b')}</span>
              </div>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                {t('superAdmin.kpis.schoolTuitionFlow', {
                  amount: formatDzd(stats.totalStudentRevenueAcrossTenantsDzd, language),
                })}
              </p>
            </div>
          </div>
        )}

        {/* TAB 1: TENANTS */}
        {activeTab === 'tenants' && (
          <div className="space-y-5">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 max-w-xl">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute start-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('superAdmin.tenants.searchPlaceholder')}
                    className="w-full ps-9 pe-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg shrink-0">
                  {(['ALL', 'ACTIVE', 'SUSPENDED'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                        statusFilter === st
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st === 'ALL'
                        ? t('superAdmin.tenants.filterAll')
                        : st === 'ACTIVE'
                        ? t('superAdmin.tenants.filterActive')
                        : t('superAdmin.tenants.filterSuspended')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => loadOverview()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('common.refresh')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#2457C5] hover:bg-[#1D47A6] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>{t('superAdmin.tenants.newTenantBtn')}</span>
                </button>
              </div>
            </div>

            {loading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500">
                {t('superAdmin.tenants.loading')}
              </div>
            ) : filteredTenants.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-800">{t('superAdmin.tenants.emptyTitle')}</p>
                <p className="text-xs text-slate-500">
                  {t('superAdmin.tenants.emptyDesc')}
                </p>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#2457C5] rounded-lg"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>{t('superAdmin.tenants.deployBtn')}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredTenants.map((tnt) => {
                  const maxStu = Math.max(1, tnt.settings?.maxStudents || 300);
                  const stuRatio = Math.min(100, Math.round((tnt.studentsCount / maxStu) * 100));
                  const isActive = tnt.status === 'ACTIVE' && tnt.subscriptionStatus === 'ACTIVE';

                  return (
                    <div
                      key={tnt.id}
                      className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6"
                    >
                      {/* Identity & Metadata */}
                      <div className="flex items-start gap-4 min-w-0">
                        {tnt.logoUrl && !failedLogos[tnt.id] ? (
                          <img
                            src={tnt.logoUrl}
                            alt={`Logo ${tnt.name}`}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedLogos((prev) => ({ ...prev, [tnt.id]: true }))
                            }
                            className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-slate-900 text-white font-bold text-sm flex items-center justify-center shrink-0 ltr-num">
                            {tnt.shortName}
                          </div>
                        )}

                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-mono font-semibold text-slate-700 ltr-num">{tnt.slug}</span>
                            <span aria-hidden="true">·</span>
                            <span>{ensureWesternDigits(tnt.wilaya)}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                isActive
                                  ? 'text-emerald-700 font-semibold'
                                  : 'text-red-700 font-semibold'
                              }
                            >
                              {isActive
                                ? t('statuses.ACTIVE')
                                : t('superAdmin.tenants.suspendedWithStatus', {
                                    status: translateStatus(t, tnt.subscriptionStatus),
                                  })}
                            </span>
                          </div>

                          <h2 className="text-base font-bold text-slate-900 truncate">{tnt.name}</h2>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span>
                              {t('superAdmin.tenants.managementLabel', {
                                name: tnt.adminName || t('common.notProvided'),
                                email: tnt.adminEmail || tnt.contactEmail,
                              })}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">
                              {t('superAdmin.tenants.receiptPrefixLabel', {
                                prefix: ensureWesternDigits(tnt.settings?.receiptPrefix || 'REC'),
                              })}
                            </span>
                            {tnt.accreditationNumber && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono ltr-num">
                                  {ensureWesternDigits(tnt.accreditationNumber)}
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] font-mono text-slate-500">
                            <span>{t('superAdmin.tenants.whiteLabelPalette')}</span>
                            <span>
                              {t('superAdmin.tenants.primary')} <span className="ltr-num">{tnt.primaryColor}</span>
                            </span>
                            <span>·</span>
                            <span>
                              {t('superAdmin.tenants.secondary')} <span className="ltr-num">{tnt.secondaryColor}</span>
                            </span>
                            <span>·</span>
                            <span>
                              {t('superAdmin.tenants.accent')} <span className="ltr-num">{tnt.accentColor}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Middle Quotas & SaaS Plan */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 lg:w-[430px] shrink-0 text-xs border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-100">
                        <div>
                          <span className="text-slate-400 block">{t('superAdmin.tenants.planAndFee')}</span>
                          <span className="font-bold text-slate-900 block mt-0.5">
                            {t('superAdmin.tenants.planName', { plan: tnt.subscriptionPlan })}
                          </span>
                          <span className="font-mono tabular-nums text-slate-600 ltr-num">
                            {formatNumber(tnt.monthlyFeeDzd, language)} {t('common.dzdPerMonth')}
                          </span>
                          <span className="block text-[11px] font-mono text-slate-400 mt-0.5">
                            {t('superAdmin.tenants.dueDate', {
                              date: ensureWesternDigits(tnt.subscriptionEndDate),
                            })}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-400 block">{t('superAdmin.tenants.studentQuota')}</span>
                          <span className="font-bold font-mono tabular-nums text-slate-900 block mt-0.5 ltr-num">
                            {formatNumber(tnt.studentsCount, language)} / {formatNumber(maxStu, language)}
                          </span>
                          <svg
                            viewBox="0 0 100 6"
                            className="w-full h-1.5 rounded-full overflow-hidden bg-slate-100 mt-1.5"
                            aria-hidden="true"
                          >
                            <rect
                              x="0"
                              y="0"
                              width={stuRatio}
                              height="6"
                              className="fill-blue-600"
                            />
                          </svg>
                          <span className="block text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                            {t('superAdmin.tenants.teachersAndCourses', {
                              teachers: formatNumber(tnt.teachersCount, language),
                              courses: formatNumber(tnt.coursesCount, language),
                            })}
                          </span>
                        </div>

                        <div className="col-span-2 sm:col-span-1">
                          <span className="text-slate-400 block">{t('superAdmin.tenants.collectedTuition')}</span>
                          <span className="font-bold font-mono tabular-nums text-emerald-700 block mt-0.5 ltr-num">
                            {formatDzd(tnt.collectedRevenueDzd, language)}
                          </span>
                          <span className="text-[11px] text-slate-500 block mt-0.5">
                            {t('superAdmin.tenants.isolatedTreasury')}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap lg:flex-col gap-2 shrink-0 border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-100">
                        <button
                          type="button"
                          onClick={() => inspectTenantAsSuperAdmin(tnt.id)}
                          className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('superAdmin.tenants.inspectPortalBtn')}</span>
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(tnt)}
                            className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            <Edit3 className="w-3.5 h-3.5 shrink-0" />
                            <span>{t('superAdmin.tenants.quotasBtn')}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openRenewModal(tnt)}
                            className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            <CreditCard className="w-3.5 h-3.5 shrink-0" />
                            <span>{t('superAdmin.tenants.contractBtn')}</span>
                          </button>

                          {tnt.id !== 'tnt_najahlearn' && (
                            <button
                              type="button"
                              onClick={() => handleToggleTenantSuspension(tnt)}
                              className={`flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                                tnt.status === 'ACTIVE'
                                  ? 'text-red-700 bg-red-50 hover:bg-red-100'
                                  : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                {tnt.status === 'ACTIVE'
                                  ? t('superAdmin.tenants.suspendBtn')
                                  : t('superAdmin.tenants.reactivateBtn')}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: B2B CONTRACTS LEDGER */}
        {activeTab === 'contracts' && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {t('superAdmin.contracts.title')}
                </h2>
                <p className="text-xs text-slate-500">
                  {t('superAdmin.contracts.subtitle')}
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {t('superAdmin.contracts.count', { count: contracts.length })}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 text-start">{t('superAdmin.contracts.invoiceCol')}</th>
                    <th className="py-3 px-4 text-start">{t('superAdmin.contracts.schoolCol')}</th>
                    <th className="py-3 px-4 text-start">{t('superAdmin.contracts.planCycleCol')}</th>
                    <th className="py-3 px-4 text-start">{t('superAdmin.contracts.quotasCol')}</th>
                    <th className="py-3 px-4 text-start">{t('superAdmin.contracts.periodCol')}</th>
                    <th className="py-3 px-4 text-end">{t('superAdmin.contracts.amountCol')}</th>
                    <th className="py-3 px-4 text-end">{t('superAdmin.contracts.statusCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {contracts.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <span className="ltr-num">{ensureWesternDigits(c.invoiceNumber)}</span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {c.tenantName || c.tenantId}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        <span className="ltr-num">{c.planCode}</span> ·{' '}
                        {c.billingCycle === 'ANNUAL'
                          ? t('superAdmin.contracts.annual')
                          : t('superAdmin.contracts.monthly')}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {t('superAdmin.contracts.quotasValue', {
                          students: formatNumber(c.maxStudents, language),
                          teachers: formatNumber(c.maxTeachers, language),
                        })}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        <span className="ltr-num">
                          {ensureWesternDigits(c.startDate)} → {ensureWesternDigits(c.endDate)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        <span className="ltr-num">{formatDzd(c.amountDzd, language)}</span>
                      </td>
                      <td className="py-3 px-4 text-end font-semibold whitespace-nowrap">
                        <span
                          className={
                            c.status === 'ACTIVE' ? 'text-emerald-700' : 'text-amber-700'
                          }
                        >
                          {c.status === 'ACTIVE'
                            ? t('superAdmin.contracts.paidActive')
                            : translateStatus(t, c.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: AUTOMATED MULTI-TENANT ISOLATION TESTS */}
        {activeTab === 'tests' && (
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900">
                  {t('superAdmin.tests.title')}
                </h2>
                <p className="text-xs text-slate-500">
                  {t('superAdmin.tests.subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={handleRunTests}
                disabled={runningTests}
                className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#2457C5] hover:bg-[#1D47A6] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 fill-white shrink-0 rtl-flip" />
                <span>
                  {runningTests
                    ? t('superAdmin.tests.runningBtn')
                    : t('superAdmin.tests.runBtn')}
                </span>
              </button>
            </div>

            {testResults && (
              <div
                className={`p-5 rounded-xl border flex items-center justify-between gap-4 ${
                  testResults.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  {testResults.success ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-600 shrink-0" />
                  )}
                  <div>
                    <h3 className="text-sm font-bold">
                      {t('superAdmin.tests.passedSummary', {
                        passed: formatNumber(testResults.totalPassed, language),
                        total: formatNumber(testResults.totalTests, language),
                      })}
                    </h3>
                    <p className="text-xs opacity-80 font-mono tabular-nums">
                      {t('superAdmin.tests.durationSummary', {
                        ms: formatNumber(testResults.durationMs, language),
                      })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              {(
                testResults?.results || [
                  {
                    id: 27,
                    name: '27. Isolation SQL automatique tdb + AsyncLocalStorage inter-établissements',
                    description: 'Zéro fuite entre Académie NajahLearn Alger et Institut Atlas Oran',
                    passed: true,
                    durationMs: 0,
                    details: t('common.pending'),
                  },
                  {
                    id: 28,
                    name: '28. Blocage d’usurpation X-Tenant-Id (CROSS_TENANT_FORBIDDEN) & fichiers privés',
                    description: 'Rejet HTTP 403 si un Admin ou Étudiant cible un autre tenantId',
                    passed: true,
                    durationMs: 0,
                    details: t('common.pending'),
                  },
                  {
                    id: 29,
                    name: '29. Unicité composite par établissement (matricule ETU-2026-001 & codes)',
                    description: 'Coexistence inter-écoles autorisée, doublon intra-école rejeté',
                    passed: true,
                    durationMs: 0,
                    details: t('common.pending'),
                  },
                  {
                    id: 30,
                    name: '30. Suspension & expiration d’abonnement SaaS établissement',
                    description: 'Blocage immédiat des sessions et accès si l’école est suspendue',
                    passed: true,
                    durationMs: 0,
                    details: t('common.pending'),
                  },
                  {
                    id: 31,
                    name: '31. Identité visuelle & numérotation personnalisée des reçus (REC-NL vs REC-IAO)',
                    description: 'Chaque reçu embarque le logo, NIF, agrément et préfixe de son école',
                    passed: true,
                    durationMs: 0,
                    details: t('common.pending'),
                  },
                  {
                    id: 32,
                    name: '32. Gouvernance SUPER_ADMIN : déploiement transactionnel d’école & contrat B2B',
                    description: 'Création atomique Tenant + Admin initial + Contrat SaaS + Inspection',
                    passed: true,
                    durationMs: 0,
                    details: t('common.pending'),
                  },
                ]
              ).map((test) => (
                <div
                  key={test.id}
                  className={`bg-white rounded-xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs ${
                    testResults
                      ? test.passed
                        ? 'border-emerald-200'
                        : 'border-red-300'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="font-mono font-bold text-slate-700 tabular-nums pt-0.5 ltr-num">
                      #{formatNumber(test.id, language)}
                    </span>
                    <div>
                      <h4 className="font-bold text-slate-900">{ensureWesternDigits(test.name)}</h4>
                      <p className="text-slate-500 mt-0.5">{ensureWesternDigits(test.details)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                    <span className="text-slate-400 ltr-num">
                      {formatNumber(test.durationMs, language)} {t('common.msShort')}
                    </span>
                    <span
                      className={
                        testResults
                          ? test.passed
                            ? 'text-emerald-700 font-bold'
                            : 'text-red-700 font-bold'
                          : 'text-slate-500'
                      }
                    >
                      {testResults
                        ? test.passed
                          ? t('common.passed')
                          : t('common.failed')
                        : t('common.ready')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1 : CRÉATION D'UN NOUVEL ÉTABLISSEMENT (ONBOARDING TRANSACTIONNEL) */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-8">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {t('superAdmin.modals.createTitle')}
                </h3>
                <p className="text-xs text-slate-500">
                  {t('superAdmin.modals.createSubtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-700 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('superAdmin.modals.officialName')}
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t('superAdmin.modals.officialNamePlaceholder')}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.shortName')}</label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    maxLength={8}
                    value={newShortName}
                    onChange={(e) => setNewShortName(e.target.value)}
                    placeholder="ESNC"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono uppercase text-start"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('superAdmin.modals.slugLabel')}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    pattern="[a-z0-9-]+"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    placeholder="esn-constantine"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.receiptPrefix')}</label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    maxLength={12}
                    value={newReceiptPrefix}
                    onChange={(e) => setNewReceiptPrefix(e.target.value.toUpperCase())}
                    placeholder="REC-ESNC"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.tagline')}</label>
                  <input
                    type="text"
                    value={newTagline}
                    onChange={(e) => setNewTagline(e.target.value)}
                    placeholder={t('superAdmin.modals.taglinePlaceholder')}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
              </div>

              {/* Brand Colors & Optional Logo */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.primaryColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newPrimaryColor}
                      onChange={(e) => setNewPrimaryColor(e.target.value)}
                      className="h-9 w-10 rounded border border-slate-300 cursor-pointer shrink-0"
                    />
                    <span className="font-mono text-slate-600 ltr-num">{newPrimaryColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.secondaryColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newSecondaryColor}
                      onChange={(e) => setNewSecondaryColor(e.target.value)}
                      className="h-9 w-10 rounded border border-slate-300 cursor-pointer shrink-0"
                    />
                    <span className="font-mono text-slate-600 ltr-num">{newSecondaryColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.accentColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newAccentColor}
                      onChange={(e) => setNewAccentColor(e.target.value)}
                      className="h-9 w-10 rounded border border-slate-300 cursor-pointer shrink-0"
                    />
                    <span className="font-mono text-slate-600 ltr-num">{newAccentColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.logoUrl')}</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={newLogoUrl}
                    onChange={(e) => setNewLogoUrl(e.target.value)}
                    placeholder="/src/assets/images/..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
              </div>

              {/* Contact & Legal */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.schoolEmail')}</label>
                  <input
                    type="email"
                    dir="ltr"
                    required
                    value={newContactEmail}
                    onChange={(e) => setNewContactEmail(e.target.value)}
                    placeholder="contact@esn-constantine.dz"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.phone')}</label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={newContactPhone}
                    onChange={(e) => setNewContactPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.hqAddress')}</label>
                  <input
                    type="text"
                    required
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="Nouvelle Ville Ali Mendjeli"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.city')}</label>
                  <input
                    type="text"
                    required
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.wilaya')}</label>
                  <input
                    type="text"
                    required
                    value={newWilaya}
                    onChange={(e) => setNewWilaya(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.accreditationNo')}</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={newAccreditation}
                    onChange={(e) => setNewAccreditation(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.taxId')}</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={newTaxId}
                    onChange={(e) => setNewTaxId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
              </div>

              {/* SaaS Plan & Quotas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.saasPlan')}</label>
                  <select
                    value={newPlan}
                    onChange={(e) => handlePlanDefaults(e.target.value as TenantPlanCode)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-semibold"
                  >
                    <option value="STARTER">STARTER</option>
                    <option value="PRO">PRO</option>
                    <option value="ENTERPRISE">ENTERPRISE</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.cycle')}</label>
                  <select
                    value={newBillingCycle}
                    onChange={(e) => setNewBillingCycle(e.target.value as 'MONTHLY' | 'ANNUAL')}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="MONTHLY">{t('superAdmin.contracts.monthly')}</option>
                    <option value="ANNUAL">{t('superAdmin.contracts.annual')}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.feeDzd')}</label>
                  <input
                    type="number"
                    dir="ltr"
                    required
                    value={newMonthlyFee}
                    onChange={(e) => setNewMonthlyFee(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.studentQuota')}</label>
                  <input
                    type="number"
                    dir="ltr"
                    required
                    value={newMaxStudents}
                    onChange={(e) => setNewMaxStudents(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
              </div>

              {/* Initial School Admin Account */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <span className="font-bold text-slate-900 block">
                  {t('superAdmin.modals.initialAdminTitle')}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.directorName')}</label>
                    <input
                      type="text"
                      required
                      value={newAdminName}
                      onChange={(e) => setNewAdminName(e.target.value)}
                      placeholder="Dr. Kamel Zerrouki"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.loginEmail')}</label>
                    <input
                      type="email"
                      dir="ltr"
                      required
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      placeholder="admin@esn-constantine.dz"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {t('superAdmin.modals.password12')}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      required
                      minLength={12}
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 font-bold text-white bg-[#2457C5] hover:bg-[#1D47A6] rounded-lg disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  {creating ? t('superAdmin.modals.deployingAcid') : t('superAdmin.modals.createSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2 : MODIFIER QUOTAS, OFFRE & PALETTE D'UN ÉTABLISSEMENT */}
      {/* ========================================================================= */}
      {editingTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                {t('superAdmin.modals.editTitle', { shortName: editingTenant.shortName })}
              </h3>
              <button
                type="button"
                onClick={() => setEditingTenant(null)}
                className="text-slate-400 hover:text-slate-700 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditTenant} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.officialName')}</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.saasPlan')}</label>
                  <select
                    value={editPlan}
                    onChange={(e) => setEditPlan(e.target.value as TenantPlanCode)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-semibold"
                  >
                    <option value="STARTER">STARTER</option>
                    <option value="PRO">PRO</option>
                    <option value="ENTERPRISE">ENTERPRISE</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('superAdmin.modals.monthlyFeeLabel')}
                  </label>
                  <input
                    type="number"
                    dir="ltr"
                    required
                    value={editMonthlyFee}
                    onChange={(e) => setEditMonthlyFee(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.maxStudents')}</label>
                  <input
                    type="number"
                    dir="ltr"
                    required
                    value={editMaxStudents}
                    onChange={(e) => setEditMaxStudents(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.maxTeachers')}</label>
                  <input
                    type="number"
                    dir="ltr"
                    required
                    value={editMaxTeachers}
                    onChange={(e) => setEditMaxTeachers(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.licenseEndDate')}</label>
                  <input
                    type="date"
                    dir="ltr"
                    required
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.tenants.primary')}</label>
                  <input
                    type="color"
                    value={editPrimaryColor}
                    onChange={(e) => setEditPrimaryColor(e.target.value)}
                    className="h-9 w-full rounded border border-slate-300 cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.tenants.secondary')}</label>
                  <input
                    type="color"
                    value={editSecondaryColor}
                    onChange={(e) => setEditSecondaryColor(e.target.value)}
                    className="h-9 w-full rounded border border-slate-300 cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.tenants.accent')}</label>
                  <input
                    type="color"
                    value={editAccentColor}
                    onChange={(e) => setEditAccentColor(e.target.value)}
                    className="h-9 w-full rounded border border-slate-300 cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingTenant(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-5 py-2 font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-60"
                >
                  {editSaving ? t('common.saving') : t('superAdmin.modals.saveQuotas')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3 : RENOUVELER / ÉMETTRE UN CONTRAT D'ABONNEMENT SAAS B2B */}
      {/* ========================================================================= */}
      {renewTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                {t('superAdmin.modals.renewTitle', { name: renewTenant.name })}
              </h3>
              <button
                type="button"
                onClick={() => setRenewTenant(null)}
                className="text-slate-400 hover:text-slate-700 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubscription} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.planFormula')}</label>
                  <select
                    value={renewPlan}
                    onChange={(e) => setRenewPlan(e.target.value as TenantPlanCode)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-semibold"
                  >
                    <option value="STARTER">STARTER</option>
                    <option value="PRO">PRO</option>
                    <option value="ENTERPRISE">ENTERPRISE</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.periodicity')}</label>
                  <select
                    value={renewCycle}
                    onChange={(e) => setRenewCycle(e.target.value as 'MONTHLY' | 'ANNUAL')}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="ANNUAL">{t('superAdmin.contracts.annual')}</option>
                    <option value="MONTHLY">{t('superAdmin.contracts.monthly')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('superAdmin.modals.billedAmount')}
                  </label>
                  <input
                    type="number"
                    dir="ltr"
                    required
                    value={renewAmount}
                    onChange={(e) => setRenewAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono font-bold text-start"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('superAdmin.modals.newEndDate')}
                  </label>
                  <input
                    type="date"
                    dir="ltr"
                    required
                    value={renewEndDate}
                    onChange={(e) => setRenewEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.b2bPaymentMethod')}</label>
                <select
                  value={renewMethod}
                  onChange={(e) => setRenewMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  <option value="BANK_TRANSFER">{t('paymentMethods.BANK_TRANSFER_BNA')}</option>
                  <option value="CHEQUE">{t('paymentMethods.CHEQUE_CERTIFIED')}</option>
                  <option value="BARIDIMOB_CCP">{t('paymentMethods.BARIDIMOB_B2B')}</option>
                  <option value="CASH">{t('paymentMethods.CASH_INVOICE')}</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('superAdmin.modals.billingNotes')}</label>
                <input
                  type="text"
                  value={renewNotes}
                  onChange={(e) => setRenewNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setRenewTenant(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={renewSaving}
                  className="px-5 py-2 font-bold text-white bg-[#16845B] hover:bg-[#126b49] rounded-lg disabled:opacity-60"
                >
                  {renewSaving ? t('superAdmin.modals.issuing') : t('superAdmin.modals.validateContractBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
