/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createPool } from '../src/db/index.ts';
import { importDatasetTransaction } from '../server/db.ts';
import type { DatabaseSchema } from '../server/seedData.ts';

dotenv.config();

async function migrateJsonToPostgres() {
  const customPath = process.argv[2];
  const jsonPath = path.resolve(process.cwd(), customPath || 'data/najahlearn.json');
  const includeQaArtifacts = process.argv.includes('--include-qa');

  console.log(`[Migration JSON -> PostgreSQL] Lecture du fichier source : ${jsonPath}`);

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Fichier JSON introuvable : ${jsonPath}`);
  }

  const rawContent = fs.readFileSync(jsonPath, 'utf-8');
  const parsed = JSON.parse(rawContent) as DatabaseSchema;

  // Optionally strip leftover QA test artifacts from legacy JSON runs unless --include-qa is set
  const cleanedDataset: DatabaseSchema = includeQaArtifacts
    ? parsed
    : {
        ...parsed,
        users: (parsed.users || []).filter(
          (u) => !u.id.startsWith('usr_test_') && !u.email.startsWith('test.student.')
        ),
        enrollments: (parsed.enrollments || []).filter((e) => !e.id.startsWith('enr_test_')),
        sessions: (parsed.sessions || []).filter((s) => !s.id.startsWith('ses_qa_')),
        attendanceRecords: (parsed.attendanceRecords || []).filter(
          (a) => !a.id.startsWith('att_qa_')
        ),
        payments: (parsed.payments || []).filter((p) => !p.id.startsWith('pay_qa_')),
      };

  const t0 = Date.now();
  const result = await importDatasetTransaction(cleanedDataset, { clearExisting: true });
  const elapsed = Date.now() - t0;

  console.log(`[Migration JSON -> PostgreSQL] Migration transactionnelle terminée en ${elapsed} ms :`);
  console.table(result.counts);
}

migrateJsonToPostgres()
  .then(async () => {
    await createPool().end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[Migration JSON -> PostgreSQL] ÉCHEC (Transaction annulée) :', err);
    await createPool().end().catch(() => {});
    process.exit(1);
  });
