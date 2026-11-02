// Migration report (ING-06): counts per kind and status, failures, unmatched objects, and for every file its
// checksum, size and ingest status, read live from the file records (checksums finish asynchronously).
import type { OnboardingRun } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { notFound } from '../errors.ts';

type Status = 'pending' | 'done' | 'failed';

export async function loadReport(
  db: Database,
  runId: string,
): Promise<OnboardingRun & { tenant_id: string }> {
  const run = await db
    .selectFrom('onboarding_run')
    .select(['id', 'tenant_id', 'program_id', 'prefix', 'status', 'unmatched', 'created_at', 'updated_at'])
    .where('id', '=', runId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!run) throw notFound('onboarding run');
  const rows = await db
    .selectFrom('onboarding_item as i')
    .leftJoin('file_object as f', (j) => j.onRef('f.id', '=', 'i.entity_id').on('i.kind', '=', 'file'))
    .select([
      'i.kind',
      'i.key',
      'i.experiment',
      'i.status',
      'i.entity_id',
      'i.error',
      'i.attempts',
      'f.sha256',
      'f.size_bytes',
      'f.ingest_status',
    ])
    .where('i.run_id', '=', runId)
    .orderBy('i.position')
    .execute();
  const items = rows.map((r) => ({
    kind: r.kind as 'experiment' | 'file' | 'import',
    key: r.key,
    experiment: r.experiment,
    status: r.status as Status,
    entity_id: r.entity_id,
    error: r.error,
    attempts: r.attempts,
    sha256: r.sha256 ?? null,
    size_bytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
    ingest_status: r.ingest_status ?? null,
  }));
  const count = (kind: string) => {
    const of = items.filter((i) => i.kind === kind);
    const n = (s: Status) => of.filter((i) => i.status === s).length;
    return { done: n('done'), pending: n('pending'), failed: n('failed') };
  };
  const files = items.filter((i) => i.kind === 'file' && i.status === 'done');
  return {
    id: run.id,
    tenant_id: run.tenant_id,
    program_id: run.program_id,
    prefix: run.prefix,
    status: run.status as OnboardingRun['status'],
    created_at: run.created_at.toISOString(),
    updated_at: run.updated_at.toISOString(),
    counts: { experiments: count('experiment'), files: count('file'), imports: count('import') },
    totals: { files: files.length, bytes: files.reduce((n, f) => n + (f.size_bytes ?? 0), 0) },
    unmatched: run.unmatched,
    failures: items.filter((i) => i.status === 'failed'),
    items,
  };
}
