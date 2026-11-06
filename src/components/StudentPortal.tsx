/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  CreditCard,
  CheckCircle2,
  Video,
  AlertTriangle,
  FileText,
  Shield,
  Download,
  Smartphone,
  ExternalLink,
  ChevronRight,
  UserCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { LiveClassroomModal } from './LiveClassroomModal.js';
import { ReceiptModal } from './ReceiptModal.js';
import { InvoiceModal } from './InvoiceModal.js';
import { ChargilyCheckoutModal } from './ChargilyCheckoutModal.js';
import { translatePaymentMethod, translateStatus } from '../i18n/index.js';
import {
  ensureWesternDigits,
  formatDate,
  formatDateTime,
  formatDzd,
  formatNumber,
  formatTime,
} from '../i18n/format.js';
import type {
  Course,
  SessionEntity,
  Payment,
  ActiveSession,
  UploadedFileMetadata,
  InstallmentPlan,
  InstallmentItem,
  Invoice,
} from '../types/index.js';

export const StudentPortal: React.FC = () => {
  const { t } = useTranslation();
  const { user, tenant, studentProfile, activeSubscription, refreshUser, language } = useAuth();
  const [activeTab, setActiveTab] = useState<'home' | 'courses' | 'sessions' | 'subscription' | 'attendance' | 'security'>('home');
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<any | null>(null);
  const [sessions, setSessions] = useState<SessionEntity[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [attendanceData, setAttendanceData] = useState<{ records: any[]; attendanceRate: number; totalSessions: number; presentCount: number }>({
    records: [],
    attendanceRate: 100,
    totalSessions: 0,
    presentCount: 0,
  });
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [, setLoading] = useState<boolean>(true);

  // Live video modal state
  const [activeLiveSession, setActiveLiveSession] = useState<{ session: SessionEntity; joinData: any } | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Receipt & Invoice & Chargily modals state
  const [selectedReceipt, setSelectedReceipt] = useState<Payment | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [installmentPlans, setInstallmentPlans] = useState<InstallmentPlan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showChargilyModal, setShowChargilyModal] = useState<boolean>(false);
  const [chargilyInstallmentItem, setChargilyInstallmentItem] = useState<InstallmentItem | null>(null);

  // Manual payment declaration state
  const [showDeclareModal, setShowDeclareModal] = useState<boolean>(false);
  const [declareInstallmentItem, setDeclareInstallmentItem] = useState<InstallmentItem | null>(null);
  const [declareAmount, setDeclareAmount] = useState<string>('6500');
  const [declareMethod, setDeclareMethod] = useState<string>('BARIDIMOB_CCP');
  const [declareRef, setDeclareRef] = useState<string>('');
  const [declareCourseId, setDeclareCourseId] = useState<string>('');
  const [declareFile, setDeclareFile] = useState<File | null>(null);
  const [declareError, setDeclareError] = useState<string | null>(null);
  const [declareSubmitting, setDeclareSubmitting] = useState<boolean>(false);
  const [declareSuccess, setDeclareSuccess] = useState<string | null>(null);
  const [uploadedReceipts, setUploadedReceipts] = useState<UploadedFileMetadata[]>([]);
  const [courseMaterials, setCourseMaterials] = useState<UploadedFileMetadata[]>([]);
  const [openedLesson, setOpenedLesson] = useState<{
    title: string;
    type: string;
    url: string;
  } | null>(null);
  const [lessonError, setLessonError] = useState<string | null>(null);

  const loadCourseMaterials = async (courseId: string) => {
    try {
      const matRes = await api.getUploads({ category: 'COURSE_MATERIAL', courseId });
      setCourseMaterials(matRes.files || []);
    } catch {
      setCourseMaterials([]);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [crsRes, sesRes, payRes, attRes, devRes, uplRes, instRes, invRes] = await Promise.all([
        api.getCourses(),
        api.getSessionsList(),
        api.getPayments(),
        api.getMyAttendance(),
        api.getSessions(),
        api.getUploads({ category: 'PAYMENT_RECEIPT' }).catch(() => ({ files: [] })),
        api.getInstallments().catch(() => ({ plans: [] })),
        api.getInvoices().catch(() => ({ invoices: [] })),
      ]);

      const loadedCourses = crsRes.courses || [];
      setCourses(loadedCourses);
      if (loadedCourses.length > 0) {
        setDeclareCourseId((prev) =>
          loadedCourses.some((c) => c.id === prev) ? prev : loadedCourses[0].id
        );
        const fullCourse = await api.getCourse(loadedCourses[0].id);
        setSelectedCourse(fullCourse);
        await loadCourseMaterials(loadedCourses[0].id);
      } else {
        setSelectedCourse(null);
        setCourseMaterials([]);
      }
      setSessions(sesRes.sessions || []);
      setPayments(payRes.payments || []);
      setAttendanceData(attRes);
      setActiveSessions(devRes.sessions || []);
      setUploadedReceipts(uplRes.files || []);
      setInstallmentPlans(instRes.plans || []);
      setInvoices(invRes.invoices || []);
    } catch (err) {
      console.error('Student data load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleJoinSession = async (session: SessionEntity) => {
    setJoinError(null);
    try {
      const joinData = await api.joinSessionProtected(session.id);
      if (joinData.canJoin) {
        setActiveLiveSession({ session, joinData });
      }
    } catch (err: any) {
      setJoinError(err.message || t('student.alerts.joinDeniedFallback'));
    }
  };

  const handleDeclarePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!declareRef.trim()) return;
    setDeclareError(null);
    setDeclareSubmitting(true);

    try {
      let receiptUploadId: string | undefined;
      if (declareFile) {
        const uploadRes = await api.uploadFile({
          file: declareFile,
          category: 'PAYMENT_RECEIPT',
        });
        receiptUploadId = uploadRes.file.id;
      }

      await api.createPayment({
        courseId: declareInstallmentItem ? declareInstallmentItem.courseId : declareCourseId,
        ...(declareInstallmentItem ? { installmentItemId: declareInstallmentItem.id } : {}),
        amountDzd: declareInstallmentItem ? declareInstallmentItem.amountDzd : Number(declareAmount),
        paymentMethod: declareMethod,
        transactionReference: declareRef.trim(),
        administrativeNotes: 'Déclaré par l étudiant depuis l espace personnel',
        ...(receiptUploadId ? { receiptUploadId } : {}),
      });
      setShowDeclareModal(false);
      setDeclareInstallmentItem(null);
      setDeclareRef('');
      setDeclareFile(null);
      setDeclareSuccess(t('student.alerts.declareSuccess'));
      const [payRes, uplRes, instRes, invRes] = await Promise.all([
        api.getPayments(),
        api.getUploads({ category: 'PAYMENT_RECEIPT' }).catch(() => ({ files: [] })),
        api.getInstallments().catch(() => ({ plans: [] })),
        api.getInvoices().catch(() => ({ invoices: [] })),
      ]);
      setPayments(payRes.payments || []);
      setUploadedReceipts(uplRes.files || []);
      setInstallmentPlans(instRes.plans || []);
      setInvoices(invRes.invoices || []);
      refreshUser();
    } catch (err: any) {
      setDeclareError(err.message || t('student.alerts.declareFailed'));
    } finally {
      setDeclareSubmitting(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await api.revokeSession(sessionId);
      const res = await api.getSessions();
      setActiveSessions(res.sessions || []);
    } catch (err: any) {
      setJoinError(err.message || t('student.alerts.revokeFailed'));
    }
  };

  const handleOpenProtectedLesson = async (courseId: string, lessonId: string) => {
    setLessonError(null);
    try {
      const res = await api.accessLesson(courseId, lessonId);
      if (res.canAccess) {
        setOpenedLesson({
          title: res.lesson.title,
          type: res.lesson.type,
          url: res.lesson.url,
        });
      }
    } catch (err: any) {
      setLessonError(err.message || t('student.alerts.lessonDenied'));
    }
  };

  const nextSession = sessions.find(s => s.status === 'SCHEDULED' && new Date(s.scheduledAt) >= new Date()) || sessions[0];

  const todayStr = new Date().toISOString().split('T')[0];
  const isSubscriptionActive = Boolean(
    activeSubscription &&
    activeSubscription.status === 'ACTIVE' &&
    activeSubscription.startDate <= todayStr &&
    activeSubscription.endDate >= todayStr
  );

  return (
    <div className="flex-1 flex flex-col bg-slate-50 min-h-screen">
      
      {/* Top Banner Navigation for Student Space */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 gap-3">
            
            {/* Student & Establishment Identity */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[var(--tenant-secondary)] text-white flex items-center justify-center font-bold text-xs shrink-0">
                {user?.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-900 block leading-tight truncate">{user?.name}</span>
                <span className="text-[11px] text-slate-500 truncate block">
                  <span className="font-mono ltr-num">
                    {studentProfile?.studentIdNumber ? ensureWesternDigits(studentProfile.studentIdNumber) : t('common.studentFallback')}
                  </span>
                  {' · '}
                  {tenant?.shortName || t('common.schoolFallback')} ({tenant?.city || studentProfile?.wilaya || t('common.algeria')})
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto py-1">
              {[
                { key: 'home', label: t('student.tabs.home'), icon: BookOpen },
                { key: 'courses', label: t('student.tabs.courses'), icon: FileText },
                { key: 'sessions', label: t('student.tabs.sessions'), icon: Video },
                { key: 'subscription', label: t('student.tabs.subscription'), icon: CreditCard },
                { key: 'attendance', label: t('student.tabs.attendance'), icon: UserCheck },
                { key: 'security', label: t('student.tabs.security'), icon: Shield },
              ].map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                      isActive
                        ? 'bg-[var(--tenant-primary)] text-white font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
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

      {/* Main View Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">

        {/* Global Join Error Alert if blocked */}
        {joinError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800 text-xs shadow-xs animate-shake">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold text-red-900 block text-sm mb-0.5">{t('student.alerts.joinDeniedTitle')}</span>
              <p className="leading-relaxed">{joinError}</p>
              <button
                onClick={() => setActiveTab('subscription')}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline text-red-900 hover:text-red-700"
              >
                <span>{t('student.alerts.checkSubscriptionLink')}</span>
                <ChevronRight className="w-3.5 h-3.5 rtl-flip" />
              </button>
            </div>
            <button onClick={() => setJoinError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Global Payment Declaration Success Alert */}
        {declareSuccess && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-800 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{declareSuccess}</span>
            </div>
            <button onClick={() => setDeclareSuccess(null)} className="text-emerald-500 hover:text-emerald-700">✕</button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: ACCUEIL PERSONNALISÉ */}
        {/* ========================================================================= */}
        {activeTab === 'home' && (
          <div className="space-y-6">
            
            {/* Subscription Banner */}
            <div className={`p-5 rounded-2xl border transition-all ${
              isSubscriptionActive
                ? 'bg-[var(--tenant-primary)] text-white border-slate-800 shadow-sm'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`font-bold ${
                      isSubscriptionActive ? 'text-emerald-300' : 'text-amber-900'
                    }`}>
                      {isSubscriptionActive ? t('student.home.subActiveBadge') : t('student.home.subInactiveBadge')}
                    </span>
                    <span className="opacity-75">
                      · {tenant?.name || t('common.schoolFallback')} · {t('common.currencyLabel')} : <span className="ltr-num">{tenant?.currency || 'DZD'}</span>
                    </span>
                  </div>
                  <h3 className="text-lg font-bold">
                    {isSubscriptionActive
                      ? t('student.home.subActiveHeadline', { date: formatDate(activeSubscription!.endDate, language) })
                      : t('student.home.subInactiveHeadline')}
                  </h3>
                  <p className="text-xs opacity-80 max-w-2xl leading-relaxed">
                    {isSubscriptionActive
                      ? t('student.home.subActiveDesc')
                      : t('student.home.subInactiveDesc')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    onClick={() => {
                      setChargilyInstallmentItem(null);
                      setShowChargilyModal(true);
                    }}
                    className={`px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-xs ${
                      isSubscriptionActive
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                        : 'bg-[var(--tenant-secondary)] hover:opacity-95 text-white'
                    }`}
                  >
                    {t('billing.payOnlineBtn')}
                  </button>
                  {!isSubscriptionActive && (
                    <button
                      onClick={() => {
                        setDeclareInstallmentItem(null);
                        setShowDeclareModal(true);
                      }}
                      className="px-4 py-2 text-xs font-semibold text-amber-950 bg-white border border-amber-300 hover:bg-amber-100 rounded-xl transition-colors"
                    >
                      {t('billing.declareManualShort')}
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab('subscription')}
                    className={`px-3.5 py-2 text-xs font-medium rounded-xl transition-colors ${
                      isSubscriptionActive ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-amber-200/60 hover:bg-amber-200 text-amber-900'
                    }`}
                  >
                    {t('student.home.subDetailsBtn')}
                  </button>
                </div>
              </div>
            </div>

            {/* Quick 2-Column Split: Next Upcoming Session & Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Next Live Session Card (2 cols) */}
              <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-slate-600 text-xs font-semibold uppercase tracking-wider">
                    <Video className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>{t('student.home.nextLiveSessionTitle')}</span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {t('common.timezoneLabel')} : <span className="font-mono ltr-num">Africa/Algiers</span>
                  </span>
                </div>

                {nextSession ? (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-base font-bold text-slate-900">{nextSession.title}</h4>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {nextSession.description || t('student.home.defaultSessionDesc')}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/60 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">{t('student.home.dateTimeLabel')}</span>
                        <span className="font-semibold text-slate-800">
                          {formatDate(nextSession.scheduledAt, language, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">{t('student.home.durationLabel')}</span>
                        <span className="font-semibold text-slate-800">
                          <span className="ltr-num">{formatNumber(nextSession.durationMinutes, language)}</span> {t('common.minutesShort')}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">{t('student.home.platformLabel')}</span>
                        <span className="font-semibold text-slate-800">{t('student.home.platformValue')}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        onClick={() => handleJoinSession(nextSession)}
                        className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl transition-all shadow-sm ${
                          isSubscriptionActive
                            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'
                            : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                        }`}
                      >
                        <Video className="w-4 h-4 shrink-0" />
                        <span>{t('student.home.joinLiveBtn')}</span>
                      </button>

                      <button
                        onClick={() => setActiveTab('sessions')}
                        className="inline-flex items-center gap-1 px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
                      >
                        <span>{t('student.home.viewFullSchedule')}</span>
                        <ChevronRight className="w-3.5 h-3.5 rtl-flip" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-6 text-center">{t('student.home.noUpcomingSession')}</p>
                )}
              </div>

              {/* Attendance & Stats Widget */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    {t('student.home.attendanceCardTitle')}
                  </span>
                </div>

                <div className="text-center py-3">
                  <div className="inline-flex items-baseline gap-1 text-4xl font-extrabold font-mono text-slate-900 tabular-nums ltr-num">
                    <span>{formatNumber(attendanceData.attendanceRate, language)}</span>
                    <span className="text-lg text-slate-500 font-normal">%</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{t('student.home.overallAttendanceLabel')}</p>
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>{t('student.home.sessionsAttended')}</span>
                    <span className="font-mono font-bold text-slate-900 ltr-num">
                      {formatNumber(attendanceData.presentCount, language)} / {formatNumber(attendanceData.totalSessions, language)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('student.home.attendanceStatus')}</span>
                    <span className="font-semibold text-emerald-700">{t('student.home.compliant')}</span>
                  </div>
                </div>

                <button
                  onClick={() => setActiveTab('attendance')}
                  className="w-full py-2 text-center text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50/60 rounded-lg transition-colors block"
                >
                  {t('student.home.viewAttendanceHistory')}
                </button>
              </div>

            </div>

            {/* Courses Overview Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">{t('student.home.enrolledCoursesTitle')}</h3>
                <span className="text-xs text-slate-500 font-mono">
                  {t('student.home.coursesCount', { count: courses.length })}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {courses.map(course => (
                  <div
                    key={course.id}
                    onClick={() => {
                      api.getCourse(course.id).then(res => {
                        setSelectedCourse(res);
                        setOpenedLesson(null);
                        setLessonError(null);
                        loadCourseMaterials(course.id);
                        setActiveTab('courses');
                      });
                    }}
                    className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition-all cursor-pointer group flex flex-col"
                  >
                    <div className="h-40 relative bg-slate-900 overflow-hidden">
                      <img
                        src={course.coverImage}
                        alt={course.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      <div className="absolute bottom-3 start-3 end-3">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-blue-300 block mb-0.5 ltr-num">
                          {ensureWesternDigits(course.code)}
                        </span>
                        <h4 className="text-xs font-bold text-white line-clamp-1">{course.title}</h4>
                      </div>
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                        {course.description}
                      </p>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <span className="text-slate-400 font-mono">
                          {t('student.home.courseDuration', { hours: formatNumber(course.durationHours, language) })}
                        </span>
                        <span className="font-semibold text-blue-600 flex items-center gap-1 ltr:group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition-transform">
                          <span>{t('student.home.openCourse')}</span>
                          <ChevronRight className="w-3.5 h-3.5 rtl-flip" />
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: MES COURS & MODULES */}
        {/* ========================================================================= */}
        {activeTab === 'courses' && selectedCourse && (
          <div className="space-y-6">
            {/* Header of selected course */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="space-y-1 max-w-2xl">
                <span className="text-xs font-mono text-blue-600 uppercase font-semibold ltr-num">
                  {ensureWesternDigits(selectedCourse.course.code)}
                </span>
                <h2 className="text-xl font-bold text-slate-900">{selectedCourse.course.title}</h2>
                <p className="text-xs text-slate-500 leading-relaxed">{selectedCourse.course.description}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={selectedCourse.course.id}
                  onChange={e => {
                    const nextId = e.target.value;
                    setOpenedLesson(null);
                    setLessonError(null);
                    api.getCourse(nextId).then(res => setSelectedCourse(res));
                    loadCourseMaterials(nextId);
                  }}
                  className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-700 font-medium"
                >
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
            </div>

            {lessonError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-red-800 text-xs">
                <span>{lessonError}</span>
                <button onClick={() => setLessonError(null)} className="text-red-500 hover:text-red-700">✕</button>
              </div>
            )}

            {openedLesson && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between gap-4 text-xs text-blue-900">
                <div className="min-w-0">
                  <span className="font-bold block">
                    {t('student.courses.unlockedResource', { title: openedLesson.title })}
                  </span>
                  <span className="text-[11px] font-mono text-blue-700 break-all ltr-num">
                    {openedLesson.type} · {openedLesson.url}
                  </span>
                </div>
                <button
                  onClick={() => setOpenedLesson(null)}
                  className="px-3 py-1.5 font-semibold bg-white border border-blue-200 rounded-lg hover:bg-blue-100 shrink-0"
                >
                  {t('common.close')}
                </button>
              </div>
            )}

            {courseMaterials.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-sm font-bold text-slate-900">
                    {t('student.courses.teacherMaterialsTitle')}
                  </span>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {t('student.courses.documentsCount', { count: courseMaterials.length })}
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {courseMaterials.map(mat => (
                    <div key={mat.id} className="py-2.5 flex items-center justify-between gap-4 text-xs">
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-800 block truncate">{mat.originalName}</span>
                        <span className="text-[11px] text-slate-400 font-mono tabular-nums ltr-num">
                          {mat.mimeType} · {formatNumber(Math.max(1, Math.round(mat.sizeBytes / 1024)), language)} {t('common.kbShort')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => api.downloadUpload(mat.id, mat.originalName)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>{t('common.download')}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modules Syllabus List */}
            <div className="space-y-4">
              {selectedCourse.modules.map((module: any, idx: number) => (
                <div key={module.id} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div>
                      <span className="text-[11px] font-mono font-semibold text-slate-400 uppercase">
                        {t('student.courses.moduleHeader', {
                          index: formatNumber(idx + 1, language),
                          hours: formatNumber(module.durationHours, language),
                        })}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900">{module.title}</h4>
                    </div>
                    <span className="text-xs text-slate-500 font-mono">
                      {t('student.courses.lessonsCount', { count: module.lessons?.length || 0 })}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">{module.description}</p>

                  {/* Lessons */}
                  <div className="space-y-2 pt-1">
                    {module.lessons?.map((les: any) => (
                      <div
                        key={les.id}
                        className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/60 transition-colors text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`p-1.5 rounded-lg shrink-0 ${
                            les.type === 'VIDEO' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {les.type === 'VIDEO' ? <Video className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                          </span>
                          <div>
                            <span className="font-semibold text-slate-800 block">{les.title}</span>
                            <span className="text-[10px] text-slate-400">
                              <span className="ltr-num">{les.type}</span>
                              {les.durationMinutes ? ` · ${formatNumber(les.durationMinutes, language)} ${t('common.minutesShort')}` : ''}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isSubscriptionActive || !les.isProtected ? (
                            <button
                              onClick={() => handleOpenProtectedLesson(selectedCourse.course.id, les.id)}
                              className="px-3 py-1.5 text-[11px] font-semibold text-blue-700 hover:text-white hover:bg-blue-600 bg-white border border-blue-200 rounded-lg transition-colors shadow-xs whitespace-nowrap shrink-0"
                            >
                              {t('student.courses.viewLessonBtn')}
                            </button>
                          ) : (
                            <span className="text-[11px] text-amber-700 font-medium whitespace-nowrap">
                              {t('student.courses.subscriptionRequired')}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: SÉANCES EN DIRECT & CALENDRIER */}
        {/* ========================================================================= */}
        {activeTab === 'sessions' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">{t('student.sessions.title')}</h2>
                <p className="text-xs text-slate-500">{t('student.sessions.subtitle')}</p>
              </div>
            </div>

            <div className="space-y-3">
              {sessions.map(s => {
                const dateObj = new Date(s.scheduledAt);
                const isPast = dateObj < new Date();
                return (
                  <div
                    key={s.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 flex flex-col items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold uppercase">
                          {formatDate(dateObj, language, { month: 'short' })}
                        </span>
                        <span className="text-base font-extrabold font-mono leading-none ltr-num">
                          {formatNumber(dateObj.getDate(), language)}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider ${
                            isPast ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}>
                            {isPast ? t('statuses.COMPLETED_SESSION') : t('statuses.SCHEDULED')}
                          </span>
                          <span className="text-xs text-slate-400 font-mono ltr-num">
                            {formatTime(dateObj, language)} ({formatNumber(s.durationMinutes, language)} {t('common.minutesShort')})
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900">{s.title}</h4>
                        <p className="text-xs text-slate-500 max-w-xl leading-relaxed">
                          {s.description || t('student.sessions.defaultDesc')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isPast ? (
                        <button
                          onClick={() => handleJoinSession(s)}
                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm"
                        >
                          <Video className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('student.sessions.joinBtn')}</span>
                        </button>
                      ) : (
                        s.recordingUrl && (
                          <a
                            href={s.recordingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5 shrink-0 rtl-flip" />
                            <span>{t('student.sessions.watchReplay')}</span>
                          </a>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: MON ABONNEMENT & REÇUS */}
        {/* ========================================================================= */}
        {activeTab === 'subscription' && (
          <div className="space-y-6">
            
            {/* Subscription Detail Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  {t('student.subscription.planCardTitle')}
                </span>
                <span className={`px-2.5 py-0.5 text-xs font-bold rounded-md uppercase tracking-wider ${
                  isSubscriptionActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                }`}>
                  {isSubscriptionActive ? t('statuses.VALID') : t('statuses.EXPIRED_OR_PENDING')}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                  <span className="text-slate-400 block mb-0.5">{t('student.subscription.statusLabel')}</span>
                  <span className="font-bold text-slate-900 text-sm">
                    {activeSubscription?.status ? translateStatus(t, activeSubscription.status) : t('common.none')}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                  <span className="text-slate-400 block mb-0.5">{t('student.subscription.startDateLabel')}</span>
                  <span className="font-bold text-slate-900 text-sm font-mono ltr-num">
                    {activeSubscription?.startDate ? ensureWesternDigits(activeSubscription.startDate) : '—'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                  <span className="text-slate-400 block mb-0.5">{t('student.subscription.endDateLabel')}</span>
                  <span className="font-bold text-slate-900 text-sm font-mono ltr-num">
                    {activeSubscription?.endDate ? ensureWesternDigits(activeSubscription.endDate) : '—'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                  <span className="text-slate-400 block mb-0.5">{t('student.subscription.monthlyFeeLabel')}</span>
                  <span className="font-bold text-blue-900 text-sm font-mono ltr-num">
                    {formatDzd(6500, language)}
                  </span>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {t('student.subscription.renewalHint')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setChargilyInstallmentItem(null);
                      setShowChargilyModal(true);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-xl transition-opacity shadow-xs"
                  >
                    <CreditCard className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('billing.payOnlineBtn')}</span>
                  </button>
                  <button
                    onClick={() => {
                      setDeclareInstallmentItem(null);
                      setShowDeclareModal(true);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    {t('student.subscription.declareBtn')}
                  </button>
                </div>
              </div>
            </div>

            {/* Installment Schedules (Paiement en plusieurs fois) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {t('billing.installments.sectionTitle')}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {t('billing.installments.sectionSubtitle')}
                  </p>
                </div>
              </div>

              {installmentPlans.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  {t('billing.installments.emptyStudent')}
                </p>
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
                            <h4 className="font-bold text-slate-900">{plan.title}</h4>
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
                          <span className="text-xs font-semibold text-slate-700">
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
                          {plan.items.map((item) => {
                            const canPay = item.status !== 'PAID' && item.status !== 'CANCELLED';
                            return (
                              <div
                                key={item.id}
                                className="p-3 flex flex-wrap items-center justify-between gap-3"
                              >
                                <div className="space-y-0.5">
                                  <span className="font-semibold text-slate-900">
                                    {t('billing.installments.trancheLabel', {
                                      num: item.installmentNumber,
                                      total: item.totalInstallments,
                                    })}
                                  </span>
                                  <span className="block text-[11px] text-slate-500 font-mono ltr-num">
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

                                <div className="flex flex-wrap items-center gap-2">
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
                                  {canPay && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setChargilyInstallmentItem(item);
                                          setShowChargilyModal(true);
                                        }}
                                        className="px-2.5 py-1 text-[11px] font-bold text-white bg-[var(--tenant-secondary)] hover:opacity-95 rounded-md transition-opacity whitespace-nowrap"
                                      >
                                        {t('billing.installments.payTrancheOnline')}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDeclareInstallmentItem(item);
                                          setDeclareCourseId(item.courseId);
                                          setDeclareAmount(String(item.amountDzd));
                                          setShowDeclareModal(true);
                                        }}
                                        className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                                      >
                                        {t('billing.installments.declareTrancheManual')}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sequential Fiscal PDF Invoices */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {t('billing.invoices.sectionTitle')}
                </h3>
                <p className="text-xs text-slate-500">
                  {t('billing.invoices.sectionSubtitle')}
                </p>
              </div>

              {invoices.length === 0 ? (
                <p className="text-xs text-slate-500">{t('billing.invoices.empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-xs border border-slate-200 rounded-xl overflow-hidden">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4 text-start">{t('billing.invoices.invoiceNoCol')}</th>
                        <th className="py-2.5 px-4 text-start">{t('billing.invoices.dateCol')}</th>
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

            {/* Payment History & Printable Receipts */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{t('student.subscription.historyTitle')}</h3>
                  <p className="text-xs text-slate-500">{t('student.subscription.historySubtitle')}</p>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {t('student.subscription.receiptsCount', { count: payments.length })}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs border border-slate-200 rounded-xl overflow-hidden">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 text-start">{t('student.subscription.receiptNoCol')}</th>
                      <th className="py-2.5 px-4 text-start">{t('student.subscription.dateCol')}</th>
                      <th className="py-2.5 px-4 text-start">{t('student.subscription.methodCol')}</th>
                      <th className="py-2.5 px-4 text-start">{t('student.subscription.referenceCol')}</th>
                      <th className="py-2.5 px-4 text-end">{t('student.subscription.amountCol')}</th>
                      <th className="py-2.5 px-4 text-center">{t('student.subscription.statusCol')}</th>
                      <th className="py-2.5 px-4 text-end">{t('student.subscription.actionCol')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {payments.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          <span className="ltr-num">{ensureWesternDigits(p.receiptNumber)}</span>
                          {p.invoiceNumber && (
                            <span className="block text-[10px] font-normal text-slate-500 ltr-num">
                              {ensureWesternDigits(p.invoiceNumber)}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">
                          <span className="ltr-num">{ensureWesternDigits(p.paymentDate)}</span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">
                          {translatePaymentMethod(t, p.paymentMethod)}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-500">
                          <span className="ltr-num">{ensureWesternDigits(p.transactionReference)}</span>
                          {p.failureReason && (
                            <span className="block text-[10px] font-sans text-red-600">
                              {p.failureReason}
                            </span>
                          )}
                          {p.refundReason && (
                            <span className="block text-[10px] font-sans text-purple-700">
                              {p.refundReason}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-end font-mono font-bold text-slate-900">
                          <span className="ltr-num">{formatDzd(p.amountDzd, language)}</span>
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
                            {p.status === 'CONFIRMED' ? t('statuses.PAID') : translateStatus(t, p.status)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-end">
                          <div className="flex items-center justify-end gap-1.5">
                            {p.invoiceId && (
                              <button
                                type="button"
                                onClick={() =>
                                  api.downloadInvoicePdf(
                                    p.invoiceId!,
                                    `${p.invoiceNumber || p.receiptNumber}.pdf`
                                  )
                                }
                                className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                              >
                                {t('billing.invoices.downloadPdfBtn')}
                              </button>
                            )}
                            <button
                              onClick={() => setSelectedReceipt(p)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap"
                            >
                              {t('student.subscription.viewReceiptBtn')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {uploadedReceipts.length > 0 && (
                <div className="pt-4 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      {t('student.subscription.uploadedProofsTitle')}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500">
                      {t('student.subscription.filesCount', { count: uploadedReceipts.length })}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                    {uploadedReceipts.map(file => (
                      <div key={file.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                        <div className="min-w-0 pe-4">
                          <span className="font-medium text-slate-900 truncate block">{file.originalName}</span>
                          <span className="text-[11px] text-slate-500 font-mono tabular-nums ltr-num">
                            {file.mimeType} · {formatNumber(Math.max(1, Math.round(file.sizeBytes / 1024)), language)} {t('common.kbShort')} · {ensureWesternDigits(file.createdAt.split('T')[0])}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => api.downloadUpload(file.id, file.originalName)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          <Download className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('common.download')}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: MES PRÉSENCES */}
        {/* ========================================================================= */}
        {activeTab === 'attendance' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{t('student.attendance.title')}</h3>
                  <p className="text-xs text-slate-500">{t('student.attendance.subtitle')}</p>
                </div>
                <div className="text-end">
                  <span className="text-xs text-slate-500 block">{t('student.attendance.globalRate')}</span>
                  <span className="text-lg font-mono font-bold text-emerald-700 ltr-num">
                    {formatNumber(attendanceData.attendanceRate, language)}%
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs border border-slate-200 rounded-xl overflow-hidden">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 text-start">{t('student.attendance.sessionCol')}</th>
                      <th className="py-2.5 px-4 text-start">{t('student.attendance.courseCol')}</th>
                      <th className="py-2.5 px-4 text-start">{t('student.attendance.dateCol')}</th>
                      <th className="py-2.5 px-4 text-center">{t('student.attendance.statusCol')}</th>
                      <th className="py-2.5 px-4 text-start">{t('student.attendance.commentCol')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {attendanceData.records.length > 0 ? (
                      attendanceData.records.map(rec => (
                        <tr key={rec.id} className="hover:bg-slate-50/60">
                          <td className="py-3 px-4 font-semibold text-slate-900">{rec.sessionTitle}</td>
                          <td className="py-3 px-4 text-slate-600">{rec.courseTitle}</td>
                          <td className="py-3 px-4 font-mono text-slate-500">
                            <span className="ltr-num">
                              {rec.sessionDate ? formatDate(rec.sessionDate, language) : '—'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider ${
                              rec.status === 'PRESENT'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : rec.status === 'LATE'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : rec.status === 'EXCUSED'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                              {rec.status === 'PRESENT'
                                ? t('statuses.PRESENT')
                                : rec.status === 'LATE'
                                ? t('student.attendance.lateWithMinutes', { minutes: formatNumber(rec.minutesLate, language) })
                                : rec.status === 'EXCUSED'
                                ? t('statuses.EXCUSED')
                                : t('statuses.ABSENT')}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 italic">{rec.teacherComment || '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-400">
                          {t('student.attendance.empty')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: SÉCURITÉ & SESSIONS ACTIVES */}
        {/* ========================================================================= */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{t('student.security.title')}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-xl">
                    {t('student.security.subtitle')}
                  </p>
                </div>
                <Shield className="w-6 h-6 text-blue-600 shrink-0" />
              </div>

              <div className="space-y-3">
                <span className="text-xs font-semibold text-slate-700 block uppercase tracking-wider">
                  {t('student.security.devicesRegistry')}
                </span>

                <div className="space-y-2">
                  {activeSessions.map(sess => {
                    const isRevoked = Boolean(sess.revokedAt);
                    return (
                      <div
                        key={sess.id}
                        className={`p-4 rounded-xl border flex items-center justify-between gap-4 text-xs ${
                          sess.isCurrent
                            ? 'bg-blue-50/50 border-blue-200'
                            : isRevoked
                            ? 'bg-slate-50/60 border-slate-200 opacity-60'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Smartphone className="w-5 h-5 text-slate-500 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-slate-900 ltr-num">{sess.deviceName}</span>
                              {sess.isCurrent && (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded-md">
                                  {t('student.security.currentSession')}
                                </span>
                              )}
                              {isRevoked && (
                                <span className="px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 rounded-md">
                                  {t('student.security.revokedBadge', {
                                    reason: sess.revokedReason || t('student.security.securityReasonFallback'),
                                  })}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono block">
                              {t('student.security.connectedOn', {
                                ip: ensureWesternDigits(sess.ipAddress),
                                date: formatDateTime(sess.createdAt, language),
                              })}
                            </span>
                          </div>
                        </div>

                        {!isRevoked && !sess.isCurrent && (
                          <button
                            onClick={() => handleRevokeSession(sess.id)}
                            className="px-3 py-1.5 text-[11px] font-medium text-red-700 hover:text-white hover:bg-red-600 bg-white border border-red-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            {t('student.security.revokeDeviceBtn')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Live Classroom Modal */}
      {activeLiveSession && (
        <LiveClassroomModal
          session={activeLiveSession.session}
          joinData={activeLiveSession.joinData}
          currentUserName={user?.name || t('common.studentFallback')}
          onClose={() => setActiveLiveSession(null)}
        />
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

      {/* Chargily Pay V2 Online Checkout Modal (CIB / Edahabia) */}
      {showChargilyModal && (
        <ChargilyCheckoutModal
          courses={courses}
          initialCourseId={declareCourseId}
          installmentItem={chargilyInstallmentItem}
          allowInstallments={tenant?.allowInstallments !== false}
          onSuccess={() => {
            loadData();
            refreshUser();
          }}
          onClose={() => {
            setShowChargilyModal(false);
            setChargilyInstallmentItem(null);
          }}
        />
      )}

      {/* Modal Déclaration de Paiement Manuel */}
      {showDeclareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden text-slate-800">
            <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-900">{t('student.declareModal.title')}</h3>
              <button onClick={() => setShowDeclareModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>

            <form onSubmit={handleDeclarePayment} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-slate-800 text-[11px]">
                <p className="font-semibold text-[var(--tenant-primary)]">
                  {t('student.declareModal.schoolCoordsTitle', { school: tenant?.name || t('app.defaultBrand') })}
                </p>
                <p>
                  · {t('student.declareModal.officialHolder')}{' '}
                  <span className="font-semibold">{tenant?.name || t('app.defaultBrand')} ({tenant?.city || t('common.algiers')})</span>
                </p>
                <p>
                  · {t('student.declareModal.verificationContact')}{' '}
                  <span className="font-mono font-semibold ltr-num">
                    {tenant?.contactEmail || 'scolarite@najahlearn.dz'}
                    {tenant?.contactPhone ? ` · ${ensureWesternDigits(tenant.contactPhone)}` : ''}
                  </span>
                </p>
                <p>
                  · {t('student.declareModal.accountingHours')}{' '}
                  <span className="font-mono">{tenant?.supportHours || t('login.defaultSupportHours')}</span>
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('student.declareModal.courseLabel')}</label>
                <select
                  value={declareCourseId}
                  onChange={e => setDeclareCourseId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                >
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('student.declareModal.methodLabel')}</label>
                  <select
                    value={declareMethod}
                    onChange={e => setDeclareMethod(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="BARIDIMOB_CCP">{t('paymentMethods.BARIDIMOB_CCP')}</option>
                    <option value="BANK_TRANSFER">{t('paymentMethods.BANK_TRANSFER')}</option>
                    <option value="CASH">{t('paymentMethods.CASH')}</option>
                    <option value="CHEQUE">{t('paymentMethods.CHEQUE')}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('student.declareModal.amountLabel')}</label>
                  <input
                    type="number"
                    dir="ltr"
                    value={declareAmount}
                    onChange={e => setDeclareAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('student.declareModal.referenceLabel')}</label>
                <input
                  type="text"
                  dir="ltr"
                  placeholder={t('student.declareModal.referencePlaceholder')}
                  value={declareRef}
                  onChange={e => setDeclareRef(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 font-mono text-start"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('student.declareModal.proofLabel')}
                </label>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={e => setDeclareFile(e.target.files?.[0] || null)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs file:me-3 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 file:font-semibold"
                />
              </div>

              {declareError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-xs">
                  {declareError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeclareModal(false);
                    setDeclareError(null);
                  }}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={declareSubmitting}
                  className="px-5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-xl transition-all shadow-sm whitespace-nowrap shrink-0"
                >
                  {declareSubmitting ? t('student.declareModal.submitting') : t('student.declareModal.submitBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
