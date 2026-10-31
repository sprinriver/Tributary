import { sql, type Transaction } from 'kysely';
import type { Database } from '../client.ts';
import type { DB } from '../generated/db.ts';

/**
 * The local test pipeline (pipelines/demo) as a definition for the local runner. Idempotent, so existing local
 * databases gain it on the next `pnpm db:seed`.
 */
export async function seedDemoPipeline(
  db: Database,
  tenant: string,
  seedActor: (trx: Transaction<DB>, tenant: string) => Promise<string>,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const found = await trx
      .selectFrom('pipeline_definition')
      .select('id')
      .where('tenant_id', '=', tenant)
      .where('key', '=', 'demo')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (found) return;
    const actor = await seedActor(trx, tenant);
    await trx
      .insertInto('pipeline_definition')
      .values({
        tenant_id: tenant,
        created_by: actor,
        key: 'demo',
        name: 'Demo DIA pipeline (local)',
        repo: 'pipelines/demo',
        revision: 'local',
        runner_types: ['local'],
        assay_types: sql`array['proteomics_dia']::assay_type_key[]`,
        params_schema: JSON.stringify({
          $defs: {
            inputs: {
              title: 'Inputs',
              required: ['pg_matrix', 'toptable'],
              properties: {
                pg_matrix: {
                  type: 'string',
                  format: 'file-path',
                  description: 'DIA-NN protein-group matrix (fixture path)',
                },
                toptable: {
                  type: 'string',
                  format: 'file-path',
                  description: 'limma topTable for the contrast (fixture path)',
                },
                delay_seconds: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 600,
                  default: 0,
                  description: 'Wait before finishing (testing)',
                },
              },
            },
          },
          allOf: [{ $ref: '#/$defs/inputs' }],
        }),
        default_params: JSON.stringify({
          pg_matrix: '/fixtures/experiments/ONC-DIA-05/report.pg_matrix.tsv',
          toptable: '/fixtures/experiments/ONC-DIA-05/toptable.tsv',
        }),
        output_importers: JSON.stringify({
          diann_pg_matrix: 'report.pg_matrix.tsv',
          limma_toptable: 'toptable.tsv',
        }),
      })
      .execute();
  });
}
