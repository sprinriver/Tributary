import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, listMigrationNames, migrateDownAll, migrateToLatest, type Database } from './index.ts';
import { startTestDatabase, type TestDatabase } from './testing/postgres.ts';

// Every SPEC §4 entity has a table, plus auth tables (Phase 3) and the
// manifest editor's ontology cache and mapping presets (Phase 6), and QC overrides and lifecycle
// policies (Phase 7), import presets (Phase 8), pipeline run events (Phase 10) and search documents and
// embeddings (Phase 17), and picklists, group mappings and settings (Phase 18), and assistant conversations (Phase 19), and webhooks (Phase 20).
const TABLES = [
  'access_token',
  'ai_conversation',
  'ai_message',
  'app_group',
  'app_session',
  'app_setting',
  'app_user',
  'assay_type',
  'audit_log',
  'compound',
  'compound_property',
  'contrast',
  'dataset',
  'dataset_release',
  'experiment',
  'experiment_version',
  'file_object',
  'gene_set',
  'gene_set_collection',
  'group_member',
  'group_role_mapping',
  'import_preset',
  'lifecycle_policy',
  'lineage_edge',
  'lineage_node',
  'mapping_preset',
  'metadata_field_def',
  'metadata_template',
  'onboarding_item',
  'onboarding_run',
  'ontology_query_cache',
  'ontology_term_cache',
  'picklist_value',
  'pipeline_definition',
  'pipeline_run',
  'pipeline_run_event',
  'program',
  'qc_override',
  'role_binding',
  'sample',
  'sample_file',
  'saved_view',
  'search_document',
  'search_embedding',
  'target_annotation',
  'webhook_delivery',
  'webhook_subscription',
];

describe('migrations', () => {
  let testDb: TestDatabase;
  let db: Database;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    db = createDb(testDb.url);
  });
  afterAll(async () => {
    await db.destroy();
    await testDb.stop();
  });

  const publicTables = async () =>
    (
      await testDb.pool.query<{ table_name: string }>(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_name not like 'kysely_%' order by table_name`,
      )
    ).rows.map((r) => r.table_name);
  const schemaExists = async (name: string) =>
    (await testDb.pool.query('select 1 from information_schema.schemata where schema_name = $1', [name]))
      .rowCount === 1;

  it('DB-01: migrations apply up, down and up again on a fresh database', async () => {
    const names = listMigrationNames();
    expect(names.length).toBeGreaterThan(0);

    expect(await migrateToLatest(db)).toEqual(names);
    expect(await publicTables()).toEqual(TABLES);
    expect(await schemaExists('pgboss')).toBe(true);

    expect(await migrateDownAll(db)).toEqual([...names].reverse());
    expect(await publicTables()).toEqual([]);
    expect(await schemaExists('pgboss')).toBe(false);

    expect(await migrateToLatest(db)).toEqual(names);
    expect(await publicTables()).toEqual(TABLES);
  });

  it('DB-01: uuidv7() defaults produce version-7 ids', async () => {
    const { rows } = await testDb.pool.query<{ id: string }>('select uuidv7() as id');
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('DB-01: search indexes exist (GIN on jsonb and tsvector, HNSW on the embedding)', async () => {
    const { rows } = await testDb.pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and tablename = 'experiment_version'`,
    );
    const defs = rows.map((r) => r.indexdef).join('\n');
    expect(defs).toMatch(/USING gin \(search_tsv\)/);
    expect(defs).toMatch(/USING gin \(custom\)/);
    expect(defs).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
  });
});
