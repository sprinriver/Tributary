import type { Database } from '@tributary/db';
import { insertAudit } from '../audit.ts';
import type { ApiConfig } from '../config.ts';
import { importFile } from '../datasets/import-file.ts';
import { loadFile } from '../ingest/files.ts';
import { runIngest } from '../ingest/job.ts';
import { serviceActor, transitionFile } from '../ingest/state.ts';
import type { Storage } from '../storage.ts';
import { notifyWatchers } from '../watch/notify.ts';
import { releasePublished } from '../notifications/emit.ts';
import { linkLineage } from './lineage.ts';
import { parseS3Uri } from './runner.ts';

export interface OutputDeps {
  db: Database;
  config: ApiConfig;
  storage: Storage;
  fetch: typeof fetch;
}

/**
 * Imports the outputs of a succeeded run (SPEC M4): each `output_importers` entry (importer → path under the run's
 * output prefix) becomes a file of the run, goes through ingest QC, is imported and — when every rule passes — its
 * release is published by the pipelines service account. Lineage: version → run → file → release. Runs once per
 * run (claimed by `outputs_processed_at`).
 */
export async function processRunOutputs(deps: OutputDeps, runId: string): Promise<void> {
  const { db, storage } = deps;
  const claimed = await db
    .updateTable('pipeline_run')
    .set({ outputs_processed_at: new Date() })
    .where('id', '=', runId)
    .where('status', '=', 'succeeded')
    .where('outputs_processed_at', 'is', null)
    .returning(['id', 'tenant_id', 'experiment_version_id', 'output_uri', 'pipeline_definition_id', 'params'])
    .executeTakeFirst();
  if (!claimed || !claimed.output_uri) return;
  const actor = { ...(await serviceActor(db, claimed.tenant_id, 'pipelines')), requestId: `run:${runId}` };
  try {
    const definition = await db
      .selectFrom('pipeline_definition')
      .select(['output_importers'])
      .where('id', '=', claimed.pipeline_definition_id)
      .executeTakeFirstOrThrow();
    const { bucket, prefix } = parseS3Uri(claimed.output_uri);
    const objects = new Map((await storage.list(prefix, bucket)).map((o) => [o.key, o]));
    const run = { kind: 'pipeline_run' as const, id: runId };
    await linkLineage(
      db,
      claimed.tenant_id,
      actor.userId,
      { kind: 'experiment_version', id: claimed.experiment_version_id },
      'input_to',
      run,
    );
    const params = claimed.params as Record<string, unknown>;
    for (const [importer, path] of Object.entries(definition.output_importers as Record<string, string>)) {
      const object = objects.get(`${prefix}${path}`);
      if (!object) {
        await insertAudit(db, actor, {
          action: 'run.output_missing',
          entityType: 'pipeline_run',
          entityId: runId,
          after: { importer, path },
        });
        continue;
      }
      const name = path.split('/').at(-1)!;
      const file = await db
        .insertInto('file_object')
        .values({
          tenant_id: claimed.tenant_id,
          created_by: actor.userId,
          experiment_version_id: claimed.experiment_version_id,
          pipeline_run_id: runId,
          name,
          role: 'processed',
          bucket,
          key: object.key,
          size_bytes: object.size,
          ingest_status: 'registered',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transitionFile(db, actor, file.id, 'uploaded', { details: { pipeline_run_id: runId } });
      await linkLineage(db, claimed.tenant_id, actor.userId, run, 'produced', { kind: 'file', id: file.id });
      await runIngest({ db, storage }, file.id);
      const loaded = await loadFile(db, file.id);
      if (loaded.ingest_status !== 'qc_passed') continue;
      const releaseId = await importFile(deps, actor, loaded, {
        importer,
        dataset_name: `${name} (pipeline)`,
        // The launch recorded the contrast the pipeline was run for (its orientation is the pipeline's input).
        contrast_id: typeof params.contrast_id === 'string' ? params.contrast_id : undefined,
      });
      await linkLineage(db, claimed.tenant_id, actor.userId, { kind: 'file', id: file.id }, 'input_to', {
        kind: 'dataset_release',
        id: releaseId,
      });
      await publishRelease(db, actor, releaseId, `Published from pipeline run ${runId}`);
      await notifyWatchers(deps, releaseId, actor);
      await releasePublished(deps, actor, releaseId);
    }
  } catch (error) {
    await db
      .updateTable('pipeline_run')
      .set({ outputs_processed_at: null })
      .where('id', '=', runId)
      .execute();
    throw error;
  }
}

async function publishRelease(
  db: Database,
  actor: Awaited<ReturnType<typeof serviceActor>>,
  releaseId: string,
  reason: string,
) {
  await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('dataset_release')
      .set({ status: 'published', published_at: new Date(), status_reason: reason })
      .where('id', '=', releaseId)
      .where('status', '=', 'staged')
      .returning('id')
      .executeTakeFirst();
    if (!updated) return; // Rejected by its rules: stays rejected and visible.
    await insertAudit(trx, actor, {
      action: 'release.publish',
      entityType: 'dataset_release',
      entityId: releaseId,
      before: { status: 'staged' },
      after: { status: 'published' },
      reason,
    });
  });
}
