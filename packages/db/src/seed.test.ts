import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrateToLatest, seedDatabase, type Database } from './index.ts';
import { startTestDatabase, type TestDatabase } from './testing/postgres.ts';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');
const tsvRows = (path: string) =>
  readFileSync(resolve(FIXTURES, path), 'utf8').trimEnd().split('\n').length - 1;

interface FixtureExperiment {
  key: string;
  manifest: string;
  contrasts: unknown[];
}

describe('db:seed', () => {
  let testDb: TestDatabase;
  let db: Database;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    db = createDb(testDb.url);
    await migrateToLatest(db);
  });
  afterAll(async () => {
    await db.destroy();
    await testDb.stop();
  });

  it('SYN-01: seed loads the synthetic corpus and reports row counts', async () => {
    const experiments = JSON.parse(
      readFileSync(resolve(FIXTURES, 'experiments.json'), 'utf8'),
    ) as FixtureExperiment[];
    const samples = experiments.reduce((n, e) => n + tsvRows(`experiments/${e.key}/${e.manifest}`), 0);
    const contrasts = experiments.reduce((n, e) => n + e.contrasts.length, 0);

    const counts = await seedDatabase(db, { fixturesDir: FIXTURES });
    expect(counts).toMatchObject({
      program: 2,
      experiment: 12,
      experiment_version: 12,
      sample: samples,
      contrast: contrasts,
      compound: tsvRows('reference/compounds.tsv'),
      compound_property: tsvRows('reference/compound_properties.tsv'),
      target_annotation: tsvRows('reference/target_annotations.tsv'),
    });
    expect(counts.audit_log).toBeGreaterThan(0);

    const { rows } = await testDb.pool.query<{ status: string }>(
      'select distinct status from experiment_version',
    );
    expect(rows).toEqual([{ status: 'published' }]);
  });

  it('SYN-01: seeding twice changes nothing', async () => {
    const before = await seedDatabase(db, { fixturesDir: FIXTURES });
    const after = await seedDatabase(db, { fixturesDir: FIXTURES });
    expect(after).toEqual(before);
  });
});
