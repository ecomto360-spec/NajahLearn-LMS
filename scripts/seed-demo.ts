/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
import { createPool } from '../src/db/index.ts';
import { importDatasetTransaction } from '../server/db.ts';
import { getDemoSeedDataset } from '../server/seedData.ts';

dotenv.config();

async function runDemoSeed() {
  console.log('[Seed Démo NajahLearn LMS] Initialisation des 16 entités de démonstration dans PostgreSQL...');
  const dataset = await getDemoSeedDataset();
  const t0 = Date.now();
  const result = await importDatasetTransaction(dataset, { clearExisting: true });
  const elapsed = Date.now() - t0;

  console.log(`[Seed Démo NajahLearn LMS] Seed terminé avec succès en ${elapsed} ms :`);
  console.table(result.counts);
}

runDemoSeed()
  .then(async () => {
    await createPool().end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[Seed Démo NajahLearn LMS] ÉCHEC :', err);
    await createPool().end().catch(() => {});
    process.exit(1);
  });
