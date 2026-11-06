/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LoginPage } from './components/LoginPage.js';
import { StudentPortal } from './components/StudentPortal.js';
import { TeacherPortal } from './components/TeacherPortal.js';
import { AdminPortal } from './components/AdminPortal.js';
import { SuperAdminPortal } from './components/SuperAdminPortal.js';
import { LanguageSwitcher } from './components/LanguageSwitcher.js';
import { NotificationCenter } from './components/NotificationCenter.js';
import {
  LogOut,
  ShieldAlert,
  CheckCircle,
  ArrowLeft,
  Eye,
} from 'lucide-react';

function AppContent() {
  const { t } = useTranslation();
  const {
    user,
    role,
    tenant,
    inspectedTenantId,
    inspectTenantAsSuperAdmin,
    loading,
    logout,
    switchDemoRole,
    duplicateSessionModal,
    dismissDuplicateModal,
  } = useAuth();

  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);

  if (loading && !user) {
    return (
      <div className="min-h-screen bg-[var(--tenant-primary)] flex flex-col items-center justify-center p-6 text-white space-y-4">
        <div className="w-10 h-10 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-200 font-mono">
          {t('app.loadingWorkspace')}
        </p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const isSuperAdminConsole = role === 'SUPER_ADMIN' && !inspectedTenantId;
  const brandWordmark = isSuperAdminConsole
    ? t('app.saasBrand')
    : tenant?.name || t('app.defaultBrand');

  const roleLabel =
    role === 'SUPER_ADMIN'
      ? inspectedTenantId
        ? t('roles.inspectionMode')
        : t('roles.SUPER_ADMIN')
      : role === 'ADMIN'
      ? t('roles.ADMIN')
      : role === 'MANAGER'
      ? t('roles.MANAGER')
      : role === 'TEACHER'
      ? t('roles.TEACHER')
      : t('roles.STUDENT');

  return (
    <div className="min-h-screen bg-[#F5F7FB] flex flex-col text-[#17243A]">
      {/* Top Bar following strict 3-Zone Contract */}
      <header className="flex items-center justify-between gap-4 lg:gap-8 px-6 py-3 bg-[var(--tenant-primary)] border-b border-white/10 shrink-0 text-white z-40">
        {/* Zone 1: Single text element wordmark */}
        <span className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0 truncate max-w-[220px] sm:max-w-none">
          {brandWordmark}
        </span>

        {/* Zone 2: Clean single-line context */}
        <nav className="hidden lg:flex items-center gap-6 text-xs text-slate-200">
          <span className="whitespace-nowrap shrink-0">{roleLabel}</span>
          <span className="whitespace-nowrap shrink-0">{user.name}</span>
          <span className="whitespace-nowrap shrink-0">
            {isSuperAdminConsole ? t('app.multiTenantContext') : tenant?.city || t('common.algeria')}
          </span>
          <span className="whitespace-nowrap shrink-0 font-mono ltr-num">
            {tenant?.currency || 'DZD'}
          </span>
        </nav>

        {/* Zone 3: Notification Center, Language Switcher, Demo Switcher & Logout */}
        <div className="flex items-center gap-2.5 shrink-0">
          <NotificationCenter />
          <LanguageSwitcher variant="dark" />

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowRoleSwitcher(!showRoleSwitcher)}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {t('app.switchProfileBtn', { role })}
            </button>

            {showRoleSwitcher && (
              <div className="absolute end-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 p-2.5 z-50 text-xs text-slate-800 space-y-1.5">
                <span className="text-[11px] font-bold text-slate-500 px-2 py-0.5 block text-start">
                  {t('app.instantMultiTenantSwitch')}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    switchDemoRole('SUPER_ADMIN', 'usr_super_1', 'tnt_najahlearn');
                    setShowRoleSwitcher(false);
                  }}
                  className={`w-full text-start px-3 py-2 rounded-lg flex items-center justify-between gap-2 ${
                    role === 'SUPER_ADMIN'
                      ? 'bg-slate-900 text-white font-bold'
                      : 'hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <div>
                    <span className="block font-semibold">{t('app.superAdminOptionTitle')}</span>
                    <span
                      className={`text-[10px] ${
                        role === 'SUPER_ADMIN' ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {t('app.superAdminOptionDesc')}
                    </span>
                  </div>
                  {role === 'SUPER_ADMIN' && <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
                </button>

                <div className="pt-1 border-t border-slate-100">
                  <span className="text-[10px] font-bold text-blue-800 px-2 block mb-1 text-start">
                    {t('app.school1Header')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      switchDemoRole('ADMIN', 'usr_admin_1', 'tnt_najahlearn');
                      setShowRoleSwitcher(false);
                    }}
                    className={`w-full text-start px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 ${
                      user.id === 'usr_admin_1'
                        ? 'bg-blue-50 text-blue-900 font-bold'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>{t('app.school1Admin')}</span>
                    {user.id === 'usr_admin_1' && (
                      <CheckCircle className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      switchDemoRole('TEACHER', 'usr_tch_1', 'tnt_najahlearn');
                      setShowRoleSwitcher(false);
                    }}
                    className={`w-full text-start px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 ${
                      user.id === 'usr_tch_1'
                        ? 'bg-blue-50 text-blue-900 font-bold'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>{t('app.school1Teacher')}</span>
                    {user.id === 'usr_tch_1' && (
                      <CheckCircle className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      switchDemoRole('STUDENT', 'usr_stu_1', 'tnt_najahlearn');
                      setShowRoleSwitcher(false);
                    }}
                    className={`w-full text-start px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 ${
                      user.id === 'usr_stu_1'
                        ? 'bg-blue-50 text-blue-900 font-bold'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>{t('app.school1Student')}</span>
                    {user.id === 'usr_stu_1' && (
                      <CheckCircle className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    )}
                  </button>
                </div>

                <div className="pt-1 border-t border-slate-100">
                  <span className="text-[10px] font-bold text-emerald-800 px-2 block mb-1 text-start">
                    {t('app.school2Header')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      switchDemoRole('ADMIN', 'usr_atlas_admin_1', 'tnt_atlas_oran');
                      setShowRoleSwitcher(false);
                    }}
                    className={`w-full text-start px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 ${
                      user.id === 'usr_atlas_admin_1'
                        ? 'bg-emerald-50 text-emerald-900 font-bold'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>{t('app.school2Admin')}</span>
                    {user.id === 'usr_atlas_admin_1' && (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      switchDemoRole('TEACHER', 'usr_atlas_tch_1', 'tnt_atlas_oran');
                      setShowRoleSwitcher(false);
                    }}
                    className={`w-full text-start px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 ${
                      user.id === 'usr_atlas_tch_1'
                        ? 'bg-emerald-50 text-emerald-900 font-bold'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>{t('app.school2Teacher')}</span>
                    {user.id === 'usr_atlas_tch_1' && (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      switchDemoRole('STUDENT', 'usr_atlas_stu_1', 'tnt_atlas_oran');
                      setShowRoleSwitcher(false);
                    }}
                    className={`w-full text-start px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 ${
                      user.id === 'usr_atlas_stu_1'
                        ? 'bg-emerald-50 text-emerald-900 font-bold'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>{t('app.school2Student')}</span>
                    {user.id === 'usr_atlas_stu_1' && (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => logout()}
            title={t('app.logoutTitle')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-red-600/90 hover:bg-red-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 rtl-flip" />
            <span className="hidden sm:inline">{t('app.logout')}</span>
          </button>
        </div>
      </header>

      {/* Super Admin Portal Inspection Banner when inspecting a specific school */}
      {role === 'SUPER_ADMIN' && inspectedTenantId && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-950">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong>{t('app.inspectionBannerLabel')}</strong> {t('app.inspectionBannerText')}{' '}
              <strong>{tenant?.name || inspectedTenantId}</strong> (
              <code className="font-mono ltr-num">{inspectedTenantId}</code>).
            </span>
          </div>
          <button
            type="button"
            onClick={() => inspectTenantAsSuperAdmin(null)}
            className="inline-flex items-center gap-1.5 px-3 py-1 font-bold text-amber-950 bg-amber-200/80 hover:bg-amber-300/80 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 rtl-flip" />
            <span>{t('app.backToSaasConsole')}</span>
          </button>
        </div>
      )}

      {/* Main View Router based on RBAC Role & Multi-Tenant Inspection */}
      <main className="flex-1 flex flex-col">
        {role === 'SUPER_ADMIN' && !inspectedTenantId && <SuperAdminPortal />}
        {role === 'SUPER_ADMIN' && inspectedTenantId && <AdminPortal />}
        {role === 'STUDENT' && <StudentPortal />}
        {role === 'TEACHER' && <TeacherPortal />}
        {(role === 'ADMIN' || role === 'MANAGER') && <AdminPortal />}
      </main>

      {/* Duplicate Session Revocation Alert Modal */}
      {duplicateSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900">
              {t('app.duplicateModalTitle')}
            </h3>

            <p className="text-xs text-slate-600 leading-relaxed">
              {t('app.duplicateModalBody', {
                school: tenant?.name || t('app.duplicateModalSchoolFallback'),
              })}
            </p>

            <button
              type="button"
              onClick={dismissDuplicateModal}
              className="w-full py-2.5 text-xs font-bold text-white bg-[var(--tenant-secondary)] rounded-xl transition-opacity"
            >
              {t('app.duplicateModalAction')}
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Establishment Footer */}
      <footer className="px-6 py-4 bg-white border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-800">
            {isSuperAdminConsole ? t('app.saasBrand') : tenant?.name || t('app.defaultBrand')}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {tenant?.city || t('common.algiers')}, {tenant?.country || t('common.algeria')}
          </span>
          {tenant?.accreditationNumber && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono ltr-num">{tenant.accreditationNumber}</span>
            </>
          )}
        </div>
        <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 flex-wrap">
          <span className="ltr-num">{tenant?.contactEmail || 'contact@najahlearn.dz'}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t('common.currencyLabel')} <span className="ltr-num">{tenant?.currency || 'DZD'}</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
