/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import i18n, {
  getStoredGuestLanguage,
  setStoredGuestLanguage,
  getStoredUserLanguage,
  setStoredUserLanguage,
  syncDocumentDirectionAndLang,
} from '../i18n/index.js';
import { normalizeLanguage } from '../i18n/format.js';
import {
  api,
  setCsrfToken,
  clearCsrfToken,
  setActiveTenantHeader,
} from '../services/api.js';
import type {
  User,
  StudentProfile,
  TeacherProfile,
  Subscription,
  UserRole,
  Tenant,
  TenantPublicSummary,
  SupportedLanguage,
} from '../types/index.js';

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  language: SupportedLanguage;
  isRtl: boolean;
  setLanguage: (lang: SupportedLanguage) => Promise<void>;
  tenant: TenantPublicSummary | null;
  fullTenant: Tenant | null;
  publicTenants: TenantPublicSummary[];
  selectedPublicTenantId: string;
  selectPublicTenant: (tenantId: string) => void;
  inspectedTenantId: string | null;
  inspectTenantAsSuperAdmin: (tenantId: string | null) => Promise<void>;
  studentProfile: StudentProfile | null;
  teacherProfile: TeacherProfile | null;
  activeSubscription: Subscription | null;
  loading: boolean;
  duplicateSessionModal: boolean;
  dismissDuplicateModal: () => void;
  login: (
    email: string,
    password: string,
    expectedRole?: 'SUPER_ADMIN' | 'ADMIN' | 'TEACHER' | 'STUDENT',
    remember?: boolean
  ) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  switchDemoRole: (targetRole?: UserRole, userId?: string, tenantId?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshPublicTenants: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function applyTenantThemeVariables(summary: TenantPublicSummary | null) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--tenant-primary', summary?.primaryColor || '#101B33');
  root.style.setProperty('--tenant-secondary', summary?.secondaryColor || '#2457C5');
  root.style.setProperty('--tenant-accent', summary?.accentColor || '#16845B');
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [language, setLanguageState] = useState<SupportedLanguage>(() =>
    normalizeLanguage(i18n.language || getStoredGuestLanguage())
  );
  const [tenant, setTenant] = useState<TenantPublicSummary | null>(null);
  const [fullTenant, setFullTenant] = useState<Tenant | null>(null);
  const [publicTenants, setPublicTenants] = useState<TenantPublicSummary[]>([]);
  const [selectedPublicTenantId, setSelectedPublicTenantId] = useState<string>('tnt_najahlearn');
  const [inspectedTenantId, setInspectedTenantId] = useState<string | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);
  const [activeSubscription, setActiveSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [duplicateSessionModal, setDuplicateSessionModal] = useState<boolean>(false);

  const applyUserLanguagePreference = useCallback(async (authenticatedUser: User) => {
    const resolved: SupportedLanguage =
      authenticatedUser.preferredLanguage ||
      getStoredUserLanguage(authenticatedUser.id) ||
      'fr';
    setStoredUserLanguage(authenticatedUser.id, resolved);
    setLanguageState(resolved);
    syncDocumentDirectionAndLang(resolved);
    if (normalizeLanguage(i18n.language) !== resolved) {
      await i18n.changeLanguage(resolved);
    }
  }, []);

  const setLanguage = useCallback(
    async (nextLang: SupportedLanguage) => {
      const normalized = normalizeLanguage(nextLang);
      setLanguageState(normalized);
      syncDocumentDirectionAndLang(normalized);
      await i18n.changeLanguage(normalized);

      if (user) {
        setStoredUserLanguage(user.id, normalized);
        setUser((prev) => (prev ? { ...prev, preferredLanguage: normalized } : null));
        try {
          const res = await api.updatePreferences(normalized);
          if (res?.user) {
            setUser(res.user);
          }
        } catch (err) {
          console.error('Failed to persist user language preference:', err);
        }
      } else {
        setStoredGuestLanguage(normalized);
      }
    },
    [user]
  );

  const refreshPublicTenants = useCallback(async () => {
    try {
      const res = await api.getPublicTenants();
      const list = res.tenants || [];
      setPublicTenants(list);
      if (list.length > 0 && !list.some((t) => t.id === selectedPublicTenantId)) {
        setSelectedPublicTenantId(list[0].id);
      }
    } catch {
      // Ignore transient bootstrap error
    }
  }, [selectedPublicTenantId]);

  const selectPublicTenant = useCallback(
    (tenantId: string) => {
      setSelectedPublicTenantId(tenantId);
      if (!user) {
        setActiveTenantHeader(tenantId);
        const found = publicTenants.find((t) => t.id === tenantId) || null;
        if (found) {
          applyTenantThemeVariables(found);
        }
      }
    },
    [user, publicTenants]
  );

  const fetchCurrentUser = useCallback(async () => {
    try {
      const data = await api.getMe();
      if (data.csrfToken) {
        setCsrfToken(data.csrfToken);
      }
      setUser(data.user);
      await applyUserLanguagePreference(data.user);
      setTenant(data.tenant || null);
      setFullTenant(data.fullTenant || null);
      setStudentProfile(data.studentProfile || null);
      setTeacherProfile(data.teacherProfile || null);
      setActiveSubscription(data.activeSubscription || null);
      if (data.user.role !== 'SUPER_ADMIN') {
        setInspectedTenantId(null);
        setActiveTenantHeader(null);
      }
      applyTenantThemeVariables(data.tenant || null);
    } catch {
      clearCsrfToken();
      setUser(null);
      setTenant(null);
      setFullTenant(null);
      setInspectedTenantId(null);
      setActiveTenantHeader(selectedPublicTenantId);
      setStudentProfile(null);
      setTeacherProfile(null);
      setActiveSubscription(null);
      const guestLang = getStoredGuestLanguage();
      setLanguageState(guestLang);
      syncDocumentDirectionAndLang(guestLang);
      if (normalizeLanguage(i18n.language) !== guestLang) {
        await i18n.changeLanguage(guestLang);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedPublicTenantId, applyUserLanguagePreference]);

  const inspectTenantAsSuperAdmin = useCallback(
    async (targetTenantId: string | null) => {
      if (user?.role !== 'SUPER_ADMIN') return;
      setInspectedTenantId(targetTenantId);
      setActiveTenantHeader(targetTenantId);
      try {
        const me = await api.getMe();
        setTenant(me.tenant || null);
        setFullTenant(me.fullTenant || null);
        applyTenantThemeVariables(me.tenant || null);
      } catch (err) {
        console.error('Erreur inspection établissement Super Admin:', err);
      }
    },
    [user]
  );

  const switchDemoRole = async (targetRole?: UserRole, userId?: string, tenantId?: string) => {
    setLoading(true);
    setInspectedTenantId(null);
    setActiveTenantHeader(null);
    try {
      const res = await api.demoSwitch(targetRole, userId, tenantId);
      setCsrfToken(res.csrfToken);
      setUser(res.user);
      await applyUserLanguagePreference(res.user);
      setTenant(res.tenant || null);
      setFullTenant(res.fullTenant || null);
      setStudentProfile(res.studentProfile || null);
      setTeacherProfile(res.teacherProfile || null);
      applyTenantThemeVariables(res.tenant || null);
      await refreshPublicTenants();
      const me = await api.getMe();
      setActiveSubscription(me.activeSubscription || null);
    } catch (err) {
      console.error('Erreur bascule de rôle démo:', err);
    } finally {
      setLoading(false);
    }
  };

  const login = async (
    email: string,
    pass: string,
    expectedRole?: 'SUPER_ADMIN' | 'ADMIN' | 'TEACHER' | 'STUDENT',
    _remember: boolean = true
  ) => {
    setLoading(true);
    setInspectedTenantId(null);
    setActiveTenantHeader(null);
    try {
      const res = await api.login(email, pass, expectedRole);
      setCsrfToken(res.csrfToken);
      setUser(res.user);
      await applyUserLanguagePreference(res.user);
      setTenant(res.tenant || null);
      setFullTenant(res.fullTenant || null);
      setStudentProfile(res.studentProfile || null);
      setTeacherProfile(res.teacherProfile || null);
      applyTenantThemeVariables(res.tenant || null);
      await refreshPublicTenants();
      const me = await api.getMe();
      setActiveSubscription(me.activeSubscription || null);
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    setInspectedTenantId(null);
    setActiveTenantHeader(selectedPublicTenantId);
    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await credential.user.getIdToken();
      const res = await api.firebaseLogin(idToken);
      setActiveTenantHeader(null);
      setCsrfToken(res.csrfToken);
      setUser(res.user);
      await applyUserLanguagePreference(res.user);
      setTenant(res.tenant || null);
      setFullTenant(res.fullTenant || null);
      setStudentProfile(res.studentProfile || null);
      setTeacherProfile(res.teacherProfile || null);
      applyTenantThemeVariables(res.tenant || null);
      const me = await api.getMe();
      setActiveSubscription(me.activeSubscription || null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore
    }
    try {
      await signOut(auth);
    } catch {
      // Ignore
    }
    clearCsrfToken();
    setInspectedTenantId(null);
    setActiveTenantHeader(selectedPublicTenantId);
    setUser(null);
    setTenant(null);
    setFullTenant(null);
    setStudentProfile(null);
    setTeacherProfile(null);
    setActiveSubscription(null);
    const pub = publicTenants.find((t) => t.id === selectedPublicTenantId) || null;
    applyTenantThemeVariables(pub);
  };

  const dismissDuplicateModal = () => {
    setDuplicateSessionModal(false);
    logout();
  };

  useEffect(() => {
    const handleRevocation = () => {
      setDuplicateSessionModal(true);
    };

    window.addEventListener('session-revoked-duplicate-login', handleRevocation);
    refreshPublicTenants();
    fetchCurrentUser();

    return () => {
      window.removeEventListener('session-revoked-duplicate-login', handleRevocation);
    };
  }, [fetchCurrentUser, refreshPublicTenants]);

  useEffect(() => {
    if (!user && publicTenants.length > 0) {
      const currentPub =
        publicTenants.find((t) => t.id === selectedPublicTenantId) || publicTenants[0];
      setActiveTenantHeader(currentPub.id);
      applyTenantThemeVariables(currentPub);
    }
  }, [user, publicTenants, selectedPublicTenantId]);

  const activePublicOrAuthTenant =
    tenant || publicTenants.find((t) => t.id === selectedPublicTenantId) || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || null,
        language,
        isRtl: language === 'ar',
        setLanguage,
        tenant: activePublicOrAuthTenant,
        fullTenant,
        publicTenants,
        selectedPublicTenantId,
        selectPublicTenant,
        inspectedTenantId,
        inspectTenantAsSuperAdmin,
        studentProfile,
        teacherProfile,
        activeSubscription,
        loading,
        duplicateSessionModal,
        dismissDuplicateModal,
        login,
        loginWithGoogle,
        logout,
        switchDemoRole,
        refreshUser: fetchCurrentUser,
        refreshPublicTenants,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
