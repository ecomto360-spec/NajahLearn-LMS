/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Building,
  GraduationCap,
  BookOpen,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  KeyRound,
  X,
  Layers,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import { api } from '../services/api.js';

type SelectedProfile = 'SUPER_ADMIN' | 'ADMIN' | 'TEACHER' | 'STUDENT';

export const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    login,
    loginWithGoogle,
    tenant,
    publicTenants,
    selectedPublicTenantId,
    selectPublicTenant,
  } = useAuth();

  const [selectedProfile, setSelectedProfile] = useState<SelectedProfile>('ADMIN');

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [logoFailed, setLogoFailed] = useState(false);

  // Status & Feedback
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Forgot Password Modal State
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStep, setForgotStep] = useState<'REQUEST' | 'RESET'>('REQUEST');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotFeedback, setForgotFeedback] = useState<{
    isError: boolean;
    message: string;
    notice?: string;
  } | null>(null);

  // Demo Credentials Helper Drawer
  const [showDemoDrawer, setShowDemoDrawer] = useState(false);

  const profileConfig: Record<
    SelectedProfile,
    {
      label: string;
      shortTitle: string;
      description: string;
      icon: typeof Building;
      subtitle: string;
    }
  > = {
    ADMIN: {
      label: t('login.profiles.ADMIN.label'),
      shortTitle: t('login.profiles.ADMIN.shortTitle'),
      description: t('login.profiles.ADMIN.description'),
      icon: Building,
      subtitle: t('login.profiles.ADMIN.subtitle'),
    },
    TEACHER: {
      label: t('login.profiles.TEACHER.label'),
      shortTitle: t('login.profiles.TEACHER.shortTitle'),
      description: t('login.profiles.TEACHER.description'),
      icon: GraduationCap,
      subtitle: t('login.profiles.TEACHER.subtitle'),
    },
    STUDENT: {
      label: t('login.profiles.STUDENT.label'),
      shortTitle: t('login.profiles.STUDENT.shortTitle'),
      description: t('login.profiles.STUDENT.description'),
      icon: BookOpen,
      subtitle: t('login.profiles.STUDENT.subtitle'),
    },
    SUPER_ADMIN: {
      label: t('login.profiles.SUPER_ADMIN.label'),
      shortTitle: t('login.profiles.SUPER_ADMIN.shortTitle'),
      description: t('login.profiles.SUPER_ADMIN.description'),
      icon: Layers,
      subtitle: t('login.profiles.SUPER_ADMIN.subtitle'),
    },
  };

  const currentConfig = profileConfig[selectedProfile];
  const activeSchoolName = tenant?.name || 'Académie NajahLearn Alger';
  const activeSchoolShort = tenant?.shortName || 'NL';
  const activeSchoolTagline = tenant?.tagline || t('login.defaultTagline');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage(t('login.errors.emailRequired'));
      return;
    }
    if (!password) {
      setErrorMessage(t('login.errors.passwordRequired'));
      return;
    }

    setSubmitting(true);
    try {
      await login(trimmedEmail, password, selectedProfile, rememberMe);
      setSuccessMessage(t('login.messages.loginSuccess'));
    } catch (err: any) {
      setErrorMessage(err.message || t('login.errors.invalidCredentials'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
      setSuccessMessage(t('login.messages.googleSuccess'));
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setErrorMessage(err.message || t('login.errors.googleFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickFill = (
    presetEmail: string,
    presetPass: string,
    profile: SelectedProfile,
    tenantId?: string
  ) => {
    if (tenantId) {
      setLogoFailed(false);
      selectPublicTenant(tenantId);
    }
    setSelectedProfile(profile);
    setEmail(presetEmail);
    setPassword(presetPass);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      setForgotFeedback({ isError: true, message: t('login.errors.forgotEmailRequired') });
      return;
    }

    setForgotSubmitting(true);
    setForgotFeedback(null);
    try {
      const res = await api.forgotPassword(forgotEmail.trim());
      setForgotFeedback({
        isError: false,
        message: res.message,
        notice: res.notice,
      });

      if (res.testToken) {
        setResetToken(res.testToken);
        setForgotStep('RESET');
      }
    } catch (err: any) {
      setForgotFeedback({
        isError: true,
        message: err.message || t('login.errors.requestFailed'),
      });
    } finally {
      setForgotSubmitting(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken.trim() || !newPassword) {
      setForgotFeedback({
        isError: true,
        message: t('login.errors.tokenAndPasswordRequired'),
      });
      return;
    }
    if (
      newPassword.length < 12 ||
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword) ||
      !/[^A-Za-z0-9\s]/.test(newPassword)
    ) {
      setForgotFeedback({
        isError: true,
        message: t('login.errors.passwordComplexity'),
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setForgotFeedback({
        isError: true,
        message: t('login.errors.passwordMismatch'),
      });
      return;
    }

    setForgotSubmitting(true);
    setForgotFeedback(null);
    try {
      const res = await api.resetPassword(resetToken.trim(), newPassword);
      setForgotFeedback({
        isError: false,
        message: res.message,
      });
      setTimeout(() => {
        setEmail(forgotEmail);
        setPassword(newPassword);
        setShowForgotModal(false);
        setForgotStep('REQUEST');
        setSuccessMessage(t('login.messages.passwordUpdated'));
      }, 1500);
    } catch (err: any) {
      setForgotFeedback({
        isError: true,
        message: err.message || t('login.errors.resetFailed'),
      });
    } finally {
      setForgotSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F7FB] flex flex-col justify-between text-[#17243A]">
      {/* Top Bar following strict 3-Zone Contract */}
      <header className="flex items-center justify-between gap-4 lg:gap-8 px-6 py-3.5 bg-[var(--tenant-primary)] border-b border-white/10 text-white">
        <span className="text-base font-bold tracking-tight whitespace-nowrap shrink-0 truncate max-w-[200px] sm:max-w-none">
          {activeSchoolName}
        </span>

        <div className="hidden lg:flex items-center gap-6 text-xs text-slate-300">
          <span className="whitespace-nowrap shrink-0">
            <span className="ltr-num">{tenant?.wilaya || t('common.algeria')}</span>
          </span>
          <span className="whitespace-nowrap shrink-0 ltr-num">
            {tenant?.accreditationNumber || t('common.ministerialAccreditation')}
          </span>
          <span className="whitespace-nowrap shrink-0">{t('login.multiTenantIsolation')}</span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <LanguageSwitcher variant="dark" />
          <button
            type="button"
            onClick={() => setShowDemoDrawer(!showDemoDrawer)}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {showDemoDrawer ? t('login.hideDemoAccounts') : t('login.showDemoAccountsShort')}
          </button>
        </div>
      </header>

      {/* Main Content: Balanced 2-Column Split Layout */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-10">
        <div className="w-full max-w-[1340px] bg-white rounded-3xl border border-[#E2E8F0] shadow-xs overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch min-h-[660px]">
          {/* START SHOWCASE PANEL: Dynamic Establishment Identity */}
          <section className="lg:col-span-5 bg-[var(--tenant-primary)] text-white p-8 lg:p-11 flex flex-col justify-between border-b lg:border-b-0 lg:border-e border-slate-800 text-start">
            <div className="space-y-6">
              {/* Establishment Switcher */}
              {publicTenants.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-medium text-slate-300 block">
                    {t('login.selectedSchool')}
                  </span>
                  <div className="flex flex-wrap gap-1.5 p-1 bg-black/25 rounded-xl border border-white/10">
                    {publicTenants.map((tItem) => {
                      const active = tItem.id === (tenant?.id || selectedPublicTenantId);
                      return (
                        <button
                          key={tItem.id}
                          type="button"
                          onClick={() => {
                            setLogoFailed(false);
                            selectPublicTenant(tItem.id);
                          }}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                            active
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-200 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          <span className="ltr-num">{tItem.shortName}</span> · {tItem.city}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Establishment Logo & Wordmark */}
              <div className="flex items-center gap-3.5 pt-1">
                {tenant?.logoUrl && !logoFailed ? (
                  <img
                    src={tenant.logoUrl}
                    alt={activeSchoolName}
                    referrerPolicy="no-referrer"
                    onError={() => setLogoFailed(true)}
                    className="w-14 h-14 rounded-2xl object-cover border border-white/20 shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-[var(--tenant-secondary)] flex items-center justify-center font-extrabold text-base text-white shrink-0 ltr-num">
                    {activeSchoolShort}
                  </div>
                )}
                <div className="min-w-0">
                  <span className="text-lg font-extrabold tracking-tight text-white block leading-snug">
                    {activeSchoolName}
                  </span>
                  <span className="text-xs text-slate-300 block">{activeSchoolTagline}</span>
                </div>
              </div>

              {/* Headline */}
              <div className="space-y-2.5">
                <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight leading-snug max-w-md">
                  {t('login.heroTitle')}
                </h1>
                <p className="text-xs text-slate-200/90 leading-relaxed max-w-md">
                  {t('login.heroDescription', { currency: tenant?.currency || 'DZD' })}
                </p>
              </div>

              {/* Showcase Banner */}
              <div className="relative rounded-2xl overflow-hidden border border-white/15">
                <img
                  src="/src/assets/images/login_showcase_banner_1792665853473.jpg"
                  alt={activeSchoolName}
                  referrerPolicy="no-referrer"
                  className="w-full h-40 object-cover object-center"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                <div className="absolute bottom-3 start-3.5 end-3.5 flex items-center justify-between text-[11px] font-mono text-slate-100">
                  <span>
                    {tenant?.city || t('common.algiers')} ·{' '}
                    <span className="ltr-num">{tenant?.wilaya || '16 - Alger'}</span>
                  </span>
                  <span>{tenant?.supportHours || t('login.defaultSupportHours')}</span>
                </div>
              </div>

              {/* Establishment Contact & Legal Metadata */}
              <div className="space-y-2 pt-2 text-xs text-slate-200/90 border-t border-white/10">
                <p className="font-semibold text-white">{t('login.schoolContactTitle')}</p>
                <p>
                  {tenant?.address || t('login.defaultAddress')},{' '}
                  {tenant?.city || t('common.algiers')} (
                  <span className="ltr-num">{tenant?.wilaya || t('common.algeria')}</span>)
                </p>
                <p className="font-mono text-[11px] text-slate-300">
                  <span className="ltr-num">{tenant?.contactEmail || 'scolarite@najahlearn.dz'}</span>
                  {' · '}
                  <span className="ltr-num">{tenant?.contactPhone || '+213 21 00 00 00'}</span>
                </p>
              </div>
            </div>

            <div className="pt-6 border-t border-white/10 text-[11px] text-slate-300 font-mono flex items-center justify-between gap-2">
              <span className="ltr-num">
                {tenant?.accreditationNumber || t('common.officialAccreditation')}
              </span>
              <span>
                {t('common.timezoneLabel')} : <span className="ltr-num">Africa/Algiers</span>
              </span>
            </div>
          </section>

          {/* END FORM PANEL */}
          <section className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-between bg-white text-start">
            <div className="w-full max-w-xl mx-auto space-y-6">
              {/* 4-Role Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-600">
                    {t('login.chooseProfile')}
                  </span>
                  <span className="text-xs font-mono text-[var(--tenant-secondary)] font-semibold">
                    {currentConfig.subtitle}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-[#F5F7FB] rounded-2xl border border-[#E2E8F0]">
                  {(['ADMIN', 'TEACHER', 'STUDENT', 'SUPER_ADMIN'] as SelectedProfile[]).map(
                    (pKey) => {
                      const cfg = profileConfig[pKey];
                      const Icon = cfg.icon;
                      const isSelected = selectedProfile === pKey;

                      return (
                        <button
                          key={pKey}
                          type="button"
                          onClick={() => {
                            setSelectedProfile(pKey);
                            setErrorMessage(null);
                          }}
                          className={`flex flex-col items-center justify-center p-2.5 rounded-xl transition-colors text-center whitespace-nowrap shrink-0 ${
                            isSelected
                              ? 'bg-white text-slate-900 shadow-xs border border-slate-200 font-bold'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 font-medium'
                          }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center mb-1 transition-colors ${
                              isSelected
                                ? 'bg-[var(--tenant-primary)] text-white'
                                : 'bg-slate-200/70 text-slate-600'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-xs leading-tight">{cfg.label}</span>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Context Header */}
              <div className="space-y-1 border-b border-slate-100 pb-4">
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#17243A] tracking-tight">
                  {currentConfig.shortTitle}
                </h2>
                <p className="text-xs text-[#64748B] leading-relaxed">{currentConfig.description}</p>
              </div>

              {/* Alerts */}
              {errorMessage && (
                <div className="p-3.5 bg-[#FDF2F2] border border-red-200 rounded-xl text-xs text-[#C43D4B] flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#C43D4B]" />
                  <div className="leading-relaxed font-medium">{errorMessage}</div>
                </div>
              )}

              {successMessage && (
                <div className="p-3.5 bg-[#E6F5EF] border border-emerald-200 rounded-xl text-xs text-[#16845B] flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#16845B]" />
                  <div className="leading-relaxed font-semibold">{successMessage}</div>
                </div>
              )}

              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="login-email" className="block text-xs font-bold text-[#17243A]">
                    {t('login.emailLabel')}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 start-0 ps-3.5 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      id="login-email"
                      type="email"
                      dir="ltr"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={
                        selectedProfile === 'SUPER_ADMIN'
                          ? 'superadmin@najahlearn.dz'
                          : selectedProfile === 'ADMIN'
                          ? `admin@${tenant?.slug === 'atlas-oran' ? 'atlas-oran.dz' : 'najahlearn.dz'}`
                          : selectedProfile === 'TEACHER'
                          ? tenant?.slug === 'atlas-oran'
                            ? 'm.khelifi@atlas-oran.dz'
                            : 'k.benali@najahlearn.dz'
                          : tenant?.slug === 'atlas-oran'
                          ? 'sara.mansouri@etu.atlas-oran.dz'
                          : 'yacine.brahimi@etu.najahlearn.dz'
                      }
                      className="w-full ps-10 pe-4 py-3 text-xs sm:text-sm bg-white border border-[#E2E8F0] rounded-xl text-[#17243A] placeholder:text-slate-400 focus:outline-none focus:border-[var(--tenant-secondary)] transition-colors text-start"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-bold text-[#17243A]"
                    >
                      {t('login.passwordLabel')}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowForgotModal(true)}
                      className="text-xs font-semibold text-[var(--tenant-secondary)] hover:underline"
                    >
                      {t('login.forgotPassword')}
                    </button>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 start-0 ps-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full ps-10 pe-11 py-3 text-xs sm:text-sm bg-white border border-[#E2E8F0] rounded-xl text-[#17243A] placeholder:text-slate-400 focus:outline-none focus:border-[var(--tenant-secondary)] transition-colors font-mono text-start"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? t('login.hidePassword') : t('login.showPassword')
                      }
                      className="absolute inset-y-0 end-0 pe-3.5 flex items-center text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                    <span className="text-xs text-[#64748B] font-medium">
                      {t('login.keepSessionActive')}
                    </span>
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono hidden sm:inline ltr-num">
                    {t('login.securityTechHint')}
                  </span>
                </div>

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3.5 px-4 bg-[var(--tenant-secondary)] hover:opacity-95 text-white font-bold text-sm rounded-xl transition-opacity flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer whitespace-nowrap"
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>{t('login.verifyingCredentials')}</span>
                      </>
                    ) : (
                      <>
                        <span>
                          {t('login.accessSpaceBtn', { space: currentConfig.shortTitle })}
                        </span>
                        <ArrowRight className="w-4 h-4 rtl-flip" />
                      </>
                    )}
                  </button>
                </div>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-[11px]">
                    <span className="bg-white px-3 text-[#64748B] font-medium">
                      {t('login.orSsoFor', { shortName: activeSchoolShort })}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleGoogleLogin}
                  className="w-full py-3 px-4 bg-white hover:bg-slate-50 text-[#17243A] font-semibold text-xs sm:text-sm rounded-xl border border-[#E2E8F0] transition-colors flex items-center justify-center gap-2.5 disabled:opacity-70 cursor-pointer whitespace-nowrap"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.09 3.56-5.17 3.56-8.8z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-2.98c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.27 14.31c-.24-.72-.38-1.49-.38-2.31s.14-1.59.38-2.31V6.6H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.4l3.98-3.09z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.6l3.98 3.09c.95-2.85 3.6-4.94 6.73-4.94z"
                    />
                  </svg>
                  <span>{t('login.continueWithGoogle')}</span>
                </button>
              </form>

              {/* Demo Accounts Trigger */}
              <div className="pt-3 border-t border-slate-100 text-center space-y-3">
                <button
                  type="button"
                  onClick={() => setShowDemoDrawer(!showDemoDrawer)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[var(--tenant-secondary)] bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors whitespace-nowrap"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>
                    {showDemoDrawer ? t('login.hideDemoAccountsLong') : t('login.showDemoAccountsLong')}
                  </span>
                </button>
              </div>

              {/* Multi-Tenant Demo Accounts Drawer */}
              {showDemoDrawer && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-3 text-start">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-900">
                      {t('login.demoDrawerTitle')}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      {t('login.oneClickAutofill')}
                    </span>
                  </div>

                  {/* Super Admin SaaS */}
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickFill(
                        'superadmin@najahlearn.dz',
                        'SuperAdmin2026!',
                        'SUPER_ADMIN',
                        'tnt_najahlearn'
                      )
                    }
                    className="w-full p-2.5 rounded-xl border border-slate-300 bg-white hover:border-blue-500 text-start transition-colors flex items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-bold text-slate-900 block">
                        {t('login.demoSuperAdminTitle')}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {t('login.demoSuperAdminSub')}
                      </span>
                    </div>
                    <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  </button>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* School 1: NajahLearn Alger */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold text-slate-700 block">
                        {t('login.demoSchool1Title')}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickFill(
                            'admin@najahlearn.dz',
                            'Admin2026!',
                            'ADMIN',
                            'tnt_najahlearn'
                          )
                        }
                        className="w-full p-2 rounded-lg border border-slate-200 bg-white hover:border-blue-400 text-start"
                      >
                        <span className="font-bold text-slate-900 block">
                          {t('login.demoSchool1Admin')}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 ltr-num">
                          admin@najahlearn.dz
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickFill(
                            'k.benali@najahlearn.dz',
                            'Teacher2026!',
                            'TEACHER',
                            'tnt_najahlearn'
                          )
                        }
                        className="w-full p-2 rounded-lg border border-slate-200 bg-white hover:border-blue-400 text-start"
                      >
                        <span className="font-bold text-slate-900 block">
                          {t('login.demoSchool1Teacher')}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 ltr-num">
                          k.benali@najahlearn.dz
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickFill(
                            'yacine.brahimi@etu.najahlearn.dz',
                            'Student2026!',
                            'STUDENT',
                            'tnt_najahlearn'
                          )
                        }
                        className="w-full p-2 rounded-lg border border-slate-200 bg-white hover:border-blue-400 text-start"
                      >
                        <span className="font-bold text-slate-900 block">
                          {t('login.demoSchool1Student')}
                        </span>
                        <span className="text-[10px] font-mono text-emerald-700">
                          {t('login.demoSchool1StudentMeta')}
                        </span>
                      </button>
                    </div>

                    {/* School 2: Institut Atlas Oran */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold text-emerald-800 block">
                        {t('login.demoSchool2Title')}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickFill(
                            'admin@atlas-oran.dz',
                            'Admin2026!',
                            'ADMIN',
                            'tnt_atlas_oran'
                          )
                        }
                        className="w-full p-2 rounded-lg border border-slate-200 bg-white hover:border-emerald-500 text-start"
                      >
                        <span className="font-bold text-slate-900 block">
                          {t('login.demoSchool2Admin')}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 ltr-num">
                          admin@atlas-oran.dz
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickFill(
                            'm.khelifi@atlas-oran.dz',
                            'Teacher2026!',
                            'TEACHER',
                            'tnt_atlas_oran'
                          )
                        }
                        className="w-full p-2 rounded-lg border border-slate-200 bg-white hover:border-emerald-500 text-start"
                      >
                        <span className="font-bold text-slate-900 block">
                          {t('login.demoSchool2Teacher')}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 ltr-num">
                          m.khelifi@atlas-oran.dz
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickFill(
                            'sara.mansouri@etu.atlas-oran.dz',
                            'Student2026!',
                            'STUDENT',
                            'tnt_atlas_oran'
                          )
                        }
                        className="w-full p-2 rounded-lg border border-slate-200 bg-white hover:border-emerald-500 text-start"
                      >
                        <span className="font-bold text-slate-900 block">
                          {t('login.demoSchool2Student')}
                        </span>
                        <span className="text-[10px] font-mono text-emerald-700">
                          {t('login.demoSchool2StudentMeta')}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-6 text-center text-xs text-[#64748B]">
              <span>{t('login.isolatedArchitectureFooter', { school: activeSchoolName })}</span>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full bg-white border-t border-[#E2E8F0] px-6 py-4 text-xs text-[#64748B] flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#17243A]">{activeSchoolName}</span>
          <span aria-hidden="true">·</span>
          <span>{t('login.poweredBySaas')}</span>
        </div>
        <div className="font-mono text-[11px] text-slate-400">
          {tenant?.city || t('common.algiers')} · {t('login.secureHttpOnlySessions')}
        </div>
      </footer>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 sm:p-8 space-y-5 text-start">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-100 text-[var(--tenant-primary)] flex items-center justify-center font-bold">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#17243A]">
                    {t('login.recovery.title')}
                  </h3>
                  <p className="text-xs text-[#64748B]">{t('login.recovery.subtitle')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForgotModal(false);
                  setForgotFeedback(null);
                  setForgotStep('REQUEST');
                }}
                aria-label={t('common.close')}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {forgotFeedback && (
              <div
                className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
                  forgotFeedback.isError
                    ? 'bg-[#FDF2F2] border-red-200 text-[#C43D4B]'
                    : 'bg-[#E6F5EF] border-emerald-200 text-[#16845B]'
                }`}
              >
                <p className="font-semibold">{forgotFeedback.message}</p>
                {forgotFeedback.notice && (
                  <p className="mt-1 text-[11px] text-slate-700 font-normal">
                    {forgotFeedback.notice}
                  </p>
                )}
              </div>
            )}

            {forgotStep === 'REQUEST' ? (
              <form onSubmit={handleRequestReset} className="space-y-4">
                <p className="text-xs text-[#64748B] leading-relaxed">
                  {t('login.recovery.description')}
                </p>

                <div className="space-y-1.5">
                  <label htmlFor="forgot-email" className="block text-xs font-bold text-[#17243A]">
                    {t('login.emailLabel')}
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute start-3.5 top-3" />
                    <input
                      id="forgot-email"
                      type="email"
                      dir="ltr"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="votre.nom@etu.najahlearn.dz"
                      className="w-full ps-10 pe-4 py-2.5 text-xs sm:text-sm bg-white border border-[#E2E8F0] rounded-xl text-[#17243A] text-start"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="px-4 py-2.5 text-xs font-semibold text-[#64748B] hover:text-[#17243A]"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={forgotSubmitting}
                    className="px-5 py-2.5 text-xs font-bold text-white bg-[var(--tenant-secondary)] rounded-xl disabled:opacity-60"
                  >
                    {t('login.recovery.generateInstructions')}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmReset} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="reset-token-input"
                    className="block text-xs font-bold text-[#17243A]"
                  >
                    {t('login.recovery.tokenLabel')}
                  </label>
                  <input
                    id="reset-token-input"
                    type="text"
                    dir="ltr"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs font-mono bg-slate-50 border border-[#E2E8F0] rounded-xl text-slate-800 text-start"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="new-password-input"
                    className="block text-xs font-bold text-[#17243A]"
                  >
                    {t('login.recovery.newPasswordLabel')}
                  </label>
                  <input
                    id="new-password-input"
                    type="password"
                    dir="ltr"
                    required
                    minLength={12}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-white border border-[#E2E8F0] rounded-xl text-slate-800 font-mono text-start"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="confirm-password-input"
                    className="block text-xs font-bold text-[#17243A]"
                  >
                    {t('login.recovery.confirmPasswordLabel')}
                  </label>
                  <input
                    id="confirm-password-input"
                    type="password"
                    dir="ltr"
                    required
                    minLength={12}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-white border border-[#E2E8F0] rounded-xl text-slate-800 font-mono text-start"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setForgotStep('REQUEST')}
                    className="px-4 py-2.5 text-xs font-semibold text-[#64748B]"
                  >
                    {t('common.back')}
                  </button>
                  <button
                    type="submit"
                    disabled={forgotSubmitting}
                    className="px-5 py-2.5 text-xs font-bold text-white bg-[#16845B] rounded-xl disabled:opacity-60"
                  >
                    {t('login.recovery.savePassword')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
