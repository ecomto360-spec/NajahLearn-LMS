/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Users,
  Video,
  UserCheck,
  CheckCircle,
  AlertCircle,
  FileText,
  Save,
  Upload,
  Download,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../services/api.js';
import { LiveClassroomModal } from './LiveClassroomModal.js';
import {
  ensureWesternDigits,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
} from '../i18n/format.js';
import type { SessionEntity, AttendanceStatus, UploadedFileMetadata } from '../types/index.js';

export const TeacherPortal: React.FC = () => {
  const { t } = useTranslation();
  const { user, tenant, teacherProfile, language } = useAuth();
  const [activeTab, setActiveTab] = useState<'classes' | 'schedule' | 'attendance' | 'materials'>('classes');
  const [classes, setClasses] = useState<any[]>([]);
  const [sessions, setSessions] = useState<SessionEntity[]>([]);
  const [selectedSessionForAttendance, setSelectedSessionForAttendance] = useState<SessionEntity | null>(null);
  const [roster, setRoster] = useState<any[]>([]);
  const [attendanceEntries, setAttendanceEntries] = useState<Record<string, { status: AttendanceStatus; minutesLate?: number; teacherComment?: string }>>({});
  const [savingAttendance, setSavingAttendance] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Secure Course Materials Upload State
  const [materials, setMaterials] = useState<UploadedFileMetadata[]>([]);
  const [materialCourseId, setMaterialCourseId] = useState<string>('');
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [uploadingMaterial, setUploadingMaterial] = useState<boolean>(false);

  // Live video modal state
  const [activeLiveSession, setActiveLiveSession] = useState<{ session: SessionEntity; joinData: any } | null>(null);

  const loadData = async () => {
    try {
      const [clsRes, sesRes, uplRes] = await Promise.all([
        api.getClasses(),
        api.getSessionsList({ teacherId: user?.id }),
        api.getUploads({ category: 'COURSE_MATERIAL' }).catch(() => ({ files: [] })),
      ]);
      const loadedClasses = clsRes.classes || [];
      setClasses(loadedClasses);
      if (loadedClasses.length > 0) {
        setMaterialCourseId((prev) =>
          loadedClasses.some((c: any) => c.courseId === prev) ? prev : loadedClasses[0].courseId
        );
      } else {
        setMaterialCourseId('');
      }
      setSessions(sesRes.sessions || []);
      setMaterials(uplRes.files || []);

      if (sesRes.sessions && sesRes.sessions.length > 0) {
        loadSessionAttendance(sesRes.sessions[0]);
      } else {
        setSelectedSessionForAttendance(null);
        setRoster([]);
      }
    } catch (err) {
      console.error('Teacher data load error:', err);
    }
  };

  const loadSessionAttendance = async (session: SessionEntity) => {
    setSelectedSessionForAttendance(session);
    setSaveSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await api.getSessionAttendance(session.id);
      setRoster(res.roster || []);
      const initialMap: Record<string, any> = {};
      (res.roster || []).forEach((item: any) => {
        initialMap[item.studentId] = {
          status: item.status || 'PRESENT',
          minutesLate: item.minutesLate || 0,
          teacherComment: item.teacherComment || '',
        };
      });
      setAttendanceEntries(initialMap);
    } catch (err) {
      console.error('Attendance load error:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleLaunchSession = async (session: SessionEntity) => {
    setErrorMsg(null);
    try {
      const joinData = await api.joinSessionProtected(session.id);
      setActiveLiveSession({ session, joinData });
    } catch (err: any) {
      setErrorMsg(err.message || t('teacher.messages.launchError'));
    }
  };

  const handleSaveAttendance = async () => {
    if (!selectedSessionForAttendance) return;
    setSavingAttendance(true);
    setSaveSuccessMsg(null);
    setErrorMsg(null);
    try {
      const entries = Object.entries(attendanceEntries).map(([studentId, data]) => ({
        studentId,
        status: data.status,
        minutesLate: data.minutesLate,
        teacherComment: data.teacherComment,
      }));

      await api.saveSessionAttendance(selectedSessionForAttendance.id, entries);
      setSaveSuccessMsg(t('teacher.messages.attendanceSaved'));
    } catch (err: any) {
      setErrorMsg(err.message || t('teacher.messages.attendanceError'));
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleUploadMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!materialFile || !materialCourseId) return;
    setUploadingMaterial(true);
    setErrorMsg(null);
    setSaveSuccessMsg(null);
    try {
      await api.uploadFile({
        file: materialFile,
        category: 'COURSE_MATERIAL',
        courseId: materialCourseId,
      });
      setMaterialFile(null);
      const uplRes = await api.getUploads({ category: 'COURSE_MATERIAL' });
      setMaterials(uplRes.files || []);
      setSaveSuccessMsg(t('teacher.messages.materialUploaded'));
    } catch (err: any) {
      setErrorMsg(err.message || t('teacher.messages.uploadDenied'));
    } finally {
      setUploadingMaterial(false);
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    setErrorMsg(null);
    try {
      await api.deleteUpload(id);
      const uplRes = await api.getUploads({ category: 'COURSE_MATERIAL' });
      setMaterials(uplRes.files || []);
    } catch (err: any) {
      setErrorMsg(err.message || t('teacher.messages.deleteDenied'));
    }
  };

  const totalRoster = roster.length;
  const presentCount = Object.values(attendanceEntries).filter(e => e.status === 'PRESENT').length;
  const currentSessionRate = totalRoster > 0 ? Math.round((presentCount / totalRoster) * 100) : 100;
  const assignedCourses = Array.from(
    new Map(classes.filter(c => c.course).map(c => [c.course.id, c.course])).values()
  );

  return (
    <div className="flex-1 flex flex-col bg-slate-50 min-h-screen">
      
      {/* Top Banner Navigation for Teacher */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 gap-3">
            
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[var(--tenant-secondary)] text-white flex items-center justify-center font-bold text-xs shrink-0">
                {user?.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-900 block leading-tight truncate">{user?.name}</span>
                <span className="text-[11px] text-slate-500 truncate block">
                  {teacherProfile?.specialty || t('common.teacherFallback')} · {tenant?.name || t('common.schoolFallback')}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto py-1">
              {[
                { key: 'classes', label: t('teacher.tabs.classes'), icon: Users },
                { key: 'schedule', label: t('teacher.tabs.schedule'), icon: Video },
                { key: 'attendance', label: t('teacher.tabs.attendance'), icon: UserCheck },
                { key: 'materials', label: t('teacher.tabs.materials'), icon: FileText },
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">

        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-red-800 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg(null)}>✕</button>
          </div>
        )}

        {/* TAB 1: MES CLASSES */}
        {activeTab === 'classes' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">{t('teacher.classes.title')}</h2>
                <p className="text-xs text-slate-500">{t('teacher.classes.subtitle')}</p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {t('teacher.classes.activeClassesCount', { count: classes.length })}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {classes.map(cls => (
                <div key={cls.id} className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between space-y-4 shadow-xs">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-semibold text-indigo-600 uppercase bg-indigo-50 px-2 py-0.5 rounded-md ltr-num">
                        {ensureWesternDigits(cls.code)}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {t('teacher.classes.studentsCapacity', {
                          enrolled: formatNumber(cls.enrolledStudents?.length || 0, language),
                          capacity: formatNumber(cls.capacity, language),
                        })}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900">{cls.name}</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {cls.course?.title || t('teacher.classes.continuingEducation')}
                    </p>
                  </div>

                  {/* Student list preview */}
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                      {t('teacher.classes.enrolledStudentsLabel')}
                    </span>
                    <div className="space-y-1">
                      {cls.enrolledStudents?.slice(0, 4).map((stu: any) => (
                        <div key={stu.id} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                          <span className="truncate">{stu.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono ltr-num truncate">{stu.email}</span>
                        </div>
                      ))}
                      {(cls.enrolledStudents?.length || 0) > 4 && (
                        <span className="text-[11px] text-indigo-600 font-medium block">
                          {t('teacher.classes.moreStudents', {
                            count: (cls.enrolledStudents?.length || 0) - 4,
                          })}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const ses = sessions.find(s => s.classId === cls.id);
                      if (ses) loadSessionAttendance(ses);
                      setActiveTab('attendance');
                    }}
                    className="w-full py-2 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
                  >
                    <span>{t('teacher.classes.takeAttendanceBtn')}</span>
                    <ChevronRight className="w-3.5 h-3.5 rtl-flip" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: SCHEDULE & VISIOCONFERENCE */}
        {activeTab === 'schedule' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">{t('teacher.schedule.title')}</h2>
                <p className="text-xs text-slate-500">{t('teacher.schedule.subtitle')}</p>
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
                      <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex flex-col items-center justify-center shrink-0">
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
                            {isPast ? t('statuses.ARCHIVED_SESSION') : t('statuses.SCHEDULED')}
                          </span>
                          <span className="text-xs text-slate-400 font-mono ltr-num">
                            {formatTime(dateObj, language)} ({formatNumber(s.durationMinutes, language)} {t('common.minutesShort')})
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900">{s.title}</h4>
                        <p className="text-xs text-slate-500">{s.description || t('teacher.schedule.onlineSessionFallback')}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleLaunchSession(s)}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-sm"
                      >
                        <Video className="w-3.5 h-3.5 shrink-0" />
                        <span>{t('teacher.schedule.startHostBtn')}</span>
                      </button>

                      <button
                        onClick={() => {
                          loadSessionAttendance(s);
                          setActiveTab('attendance');
                        }}
                        className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                      >
                        {t('teacher.schedule.attendanceBtn')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: ATTENDANCE SHEET */}
        {activeTab === 'attendance' && selectedSessionForAttendance && (
          <div className="space-y-6">
            
            {/* Session Selector & Stats Bar */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-xs">
              <div className="space-y-1">
                <span className="text-xs font-mono text-indigo-600 font-semibold uppercase">
                  {t('teacher.attendance.kicker')}
                </span>
                <h2 className="text-lg font-bold text-slate-900">{selectedSessionForAttendance.title}</h2>
                <p className="text-xs text-slate-500">
                  {t('teacher.attendance.dateAndDuration', {
                    date: formatDateTime(selectedSessionForAttendance.scheduledAt, language),
                    minutes: formatNumber(selectedSessionForAttendance.durationMinutes, language),
                  })}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-end">
                  <span className="text-xs text-slate-500 block">{t('teacher.attendance.attendanceRateLabel')}</span>
                  <span className="text-xl font-mono font-bold text-emerald-700 ltr-num">
                    {formatNumber(currentSessionRate, language)}%
                  </span>
                </div>

                <button
                  onClick={handleSaveAttendance}
                  disabled={savingAttendance}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-all shadow-sm disabled:opacity-50"
                >
                  <Save className="w-4 h-4 shrink-0" />
                  <span>{savingAttendance ? t('common.saving') : t('teacher.attendance.saveBtn')}</span>
                </button>
              </div>
            </div>

            {saveSuccessMsg && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-800 text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{saveSuccessMsg}</span>
                </div>
                <button onClick={() => setSaveSuccessMsg(null)}>✕</button>
              </div>
            )}

            {/* Attendance Roster Table */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
              <table className="w-full text-start text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 text-start">{t('teacher.attendance.studentCol')}</th>
                    <th className="py-3 px-4 text-start">{t('teacher.attendance.idCol')}</th>
                    <th className="py-3 px-4 text-center">{t('teacher.attendance.statusCol')}</th>
                    <th className="py-3 px-4 text-start">{t('teacher.attendance.minutesLateCol')}</th>
                    <th className="py-3 px-4 text-start">{t('teacher.attendance.commentCol')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {roster.map(item => {
                    const currentEntry = attendanceEntries[item.studentId] || { status: 'PRESENT' };
                    return (
                      <tr key={item.studentId} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-900 block">{item.studentName}</span>
                          <span className="text-[11px] text-slate-400 ltr-num">{item.studentEmail}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-500">
                          <span className="ltr-num">{ensureWesternDigits(item.studentIdNumber || 'ETU-2026')}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            {[
                              { key: 'PRESENT', label: t('statuses.PRESENT'), color: 'bg-emerald-500 text-white' },
                              { key: 'LATE', label: t('statuses.LATE'), color: 'bg-amber-500 text-white' },
                              { key: 'ABSENT', label: t('statuses.ABSENT'), color: 'bg-red-500 text-white' },
                              { key: 'EXCUSED', label: t('statuses.EXCUSED'), color: 'bg-blue-500 text-white' },
                            ].map(btn => {
                              const isSelected = currentEntry.status === btn.key;
                              return (
                                <button
                                  key={btn.key}
                                  type="button"
                                  onClick={() => {
                                    setAttendanceEntries(prev => ({
                                      ...prev,
                                      [item.studentId]: {
                                        ...prev[item.studentId],
                                        status: btn.key as AttendanceStatus,
                                      },
                                    }));
                                  }}
                                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap ${
                                    isSelected
                                      ? btn.color
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                                >
                                  {btn.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {currentEntry.status === 'LATE' && (
                            <input
                              type="number"
                              dir="ltr"
                              min="1"
                              max="120"
                              value={currentEntry.minutesLate || 15}
                              onChange={e => {
                                const val = parseInt(e.target.value, 10) || 0;
                                setAttendanceEntries(prev => ({
                                  ...prev,
                                  [item.studentId]: {
                                    ...prev[item.studentId],
                                    minutesLate: val,
                                  },
                                }));
                              }}
                              className="w-20 px-2 py-1 bg-slate-50 border border-slate-300 rounded text-slate-800 text-xs font-mono text-start"
                              placeholder={t('common.minutesShort')}
                            />
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="text"
                            placeholder={t('teacher.attendance.commentPlaceholder')}
                            value={currentEntry.teacherComment || ''}
                            onChange={e => {
                              const val = e.target.value;
                              setAttendanceEntries(prev => ({
                                ...prev,
                                [item.studentId]: {
                                  ...prev[item.studentId],
                                  teacherComment: val,
                                },
                              }));
                            }}
                            className="w-full px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 text-xs"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* TAB 4: SUPPORTS PÉDAGOGIQUES SÉCURISÉS */}
        {activeTab === 'materials' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {t('teacher.materials.title')}
                </h2>
                <p className="text-xs text-slate-500">
                  {t('teacher.materials.subtitle')}
                </p>
              </div>

              {saveSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-800 text-xs">
                  <span>{saveSuccessMsg}</span>
                  <button onClick={() => setSaveSuccessMsg(null)}>✕</button>
                </div>
              )}

              <form onSubmit={handleUploadMaterial} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('teacher.materials.courseLabel')}</label>
                  <select
                    value={materialCourseId}
                    onChange={e => setMaterialCourseId(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
                  >
                    {assignedCourses.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('teacher.materials.fileLabel')}</label>
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    onChange={e => setMaterialFile(e.target.files?.[0] || null)}
                    required
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 file:me-3 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-semibold"
                  />
                </div>

                <button
                  type="submit"
                  disabled={uploadingMaterial || !materialFile}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl transition-all whitespace-nowrap shrink-0"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>{uploadingMaterial ? t('teacher.materials.verifying') : t('teacher.materials.uploadBtn')}</span>
                </button>
              </form>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">{t('teacher.materials.listTitle')}</h3>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {t('teacher.materials.filesCount', { count: materials.length })}
                </span>
              </div>

              {materials.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  {t('teacher.materials.empty')}
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {materials.map(mat => (
                    <div key={mat.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-900 block truncate">{mat.originalName}</span>
                        <span className="text-[11px] font-mono text-slate-500 tabular-nums ltr-num">
                          {mat.mimeType} · {formatNumber(Math.max(1, Math.round(mat.sizeBytes / 1024)), language)} {t('common.kbShort')} · {ensureWesternDigits(mat.createdAt.split('T')[0])}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => api.downloadUpload(mat.id, mat.originalName)}
                          className="flex items-center gap-1.5 px-3 py-1.5 font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('common.download')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMaterial(mat.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('common.delete')}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Live Classroom Modal */}
      {activeLiveSession && (
        <LiveClassroomModal
          session={activeLiveSession.session}
          joinData={activeLiveSession.joinData}
          currentUserName={user?.name || t('common.teacherFallback')}
          onClose={() => setActiveLiveSession(null)}
        />
      )}

    </div>
  );
};
