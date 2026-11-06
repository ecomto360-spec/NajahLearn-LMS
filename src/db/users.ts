/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { DEFAULT_TENANT_ID, users, studentProfiles } from './schema.ts';
import { getCurrentTenantId } from '../../server/tenantContext.ts';

/**
 * Synchronizes a Firebase-authenticated user with PostgreSQL safely under concurrency,
 * preserving or assigning the active establishment's `tenantId`.
 */
export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string | null,
  avatarUrl?: string | null,
  explicitTenantId?: string
) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const nowIso = new Date().toISOString();
    const targetTenantId = explicitTenantId || getCurrentTenantId() || DEFAULT_TENANT_ID;

    return await db.transaction(async (tx) => {
      const existingByEmail = await tx
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existingByEmail.length > 0 && existingByEmail[0].uid !== uid) {
        const [linked] = await tx
          .update(users)
          .set({
            uid,
            avatar: avatarUrl || existingByEmail[0].avatar,
            updatedAt: nowIso,
          })
          .where(eq(users.id, existingByEmail[0].id))
          .returning();
        return linked;
      }

      if (existingByEmail.length > 0) {
        return existingByEmail[0];
      }

      const fallbackId = `usr_fb_${uid.slice(0, 16)}`;
      const fallbackName =
        displayName?.trim() || normalizedEmail.split('@')[0] || 'Utilisateur NajahLearn';

      const result = await tx
        .insert(users)
        .values({
          id: fallbackId,
          tenantId: targetTenantId,
          uid,
          name: fallbackName,
          email: normalizedEmail,
          role: 'STUDENT',
          status: 'ACTIVE',
          avatar: avatarUrl || null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email: normalizedEmail,
            updatedAt: nowIso,
          },
        })
        .returning();

      const syncedUser = result[0];

      if (syncedUser.role === 'STUDENT') {
        const existingProfile = await tx
          .select()
          .from(studentProfiles)
          .where(eq(studentProfiles.userId, syncedUser.id))
          .limit(1);

        if (existingProfile.length === 0) {
          const uniqueSuffix = uid.slice(-4).toUpperCase();
          await tx
            .insert(studentProfiles)
            .values({
              id: `prf_stu_${syncedUser.id}`,
              tenantId: syncedUser.tenantId,
              userId: syncedUser.id,
              studentIdNumber: `ETU-2026-G${uniqueSuffix}`,
              city: 'Alger',
              wilaya: '16 - Alger',
              academicLevel: 'Formation Continue',
            })
            .onConflictDoNothing();
        }
      }

      return syncedUser;
    });
  } catch (error) {
    console.error('Database user synchronization failed:', error);
    throw new Error('Impossible de synchroniser le profil utilisateur en base de données.', {
      cause: error,
    });
  }
}
