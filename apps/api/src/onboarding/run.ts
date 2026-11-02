// Legacy onboarding runs (ING-06): executes a plan through the API's own routes, in process and as the caller,
// so authorisation, validation, immutability and audit are exactly those of the normal endpoints. Items record
// their status, attempts and errors; a resume continues pending items and retries failed ones.
import type { OnboardingPlan, OnboardingSpec } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import type { AuditActor } from '../audit.ts';

type Item = {
  id: string;
  kind: 'experiment' | 'file' | 'import';
  key: string;
  experiment: string;
  status: 'pending' | 'done' | 'failed';
  entity_id: string | null;
  attempts: number;
};
type Call = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StoredRun {
  spec: OnboardingSpec;
  plan: OnboardingPlan;
}

const FORWARDED = ['authorization', 'cookie', 'x-csrf-token', 'x-change-reason', 'x-request-id'];
const json = (value: unknown) => JSON.stringify(value);

/** Calls this API in process with the caller's own credentials (session or token, CSRF, change reason). */
export function callerInject(request: FastifyRequest, defaultReason: string): Call {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  headers['x-change-reason'] ??= defaultReason;
  return async (method, url, payload) => {
    const res = await request.server.inject({
      method,
      url,
      headers: payload === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    const text = res.body;
    return { status: res.statusCode, body: text ? JSON.parse(text) : null };
  };
}

const describe = (res: { status: number; body: { code?: string; message?: string } | null }) =>
  `${res.status} ${res.body?.code ?? 'error'}: ${res.body?.message ?? 'request failed'}`;

/** Creates the run and one item per experiment, file and import of the plan. */
export async function createRun(
  db: Database,
  actor: AuditActor,
  spec: OnboardingSpec,
  plan: OnboardingPlan,
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const run = await trx
      .insertInto('onboarding_run')
      .values({
        tenant_id: actor.tenantId,
        created_by: actor.userId,
        program_id: spec.program_id,
        prefix: spec.prefix,
        spec: json({ spec, plan } satisfies StoredRun),
        unmatched: plan.unmatched,
        status: 'running',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const base = { tenant_id: actor.tenantId, created_by: actor.userId, run_id: run.id, status: 'pending' };
    const rows: { kind: string; key: string; experiment: string; position: number }[] = [];
    for (const e of plan.experiments) {
      rows.push({ kind: 'experiment', key: e.name, experiment: e.name, position: rows.length });
      for (const f of e.files)
        rows.push({ kind: 'file', key: f.key, experiment: e.name, position: rows.length });
      for (const f of e.files.filter((x) => x.importer)) {
        rows.push({ kind: 'import', key: f.key, experiment: e.name, position: rows.length });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      await trx
        .insertInto('onboarding_item')
        .values(rows.slice(i, i + 500).map((r) => ({ ...base, ...r })))
        .execute();
    }
    return run.id;
  });
}

async function update(
  db: Database,
  item: Item,
  set: Partial<Pick<Item, 'status' | 'entity_id'>> & { error?: string | null },
) {
  await db
    .updateTable('onboarding_item')
    .set({ ...set, attempts: item.attempts })
    .where('id', '=', item.id)
    .execute();
  Object.assign(item, set);
}

async function latestVersion(db: Database, experimentId: string) {
  return db
    .selectFrom('experiment_version')
    .select(['id', 'status'])
    .where('experiment_id', '=', experimentId)
    .where('deleted_at', 'is', null)
    .orderBy('version_number', 'desc')
    .executeTakeFirstOrThrow();
}

/** The experiment for this name in the program: found, or created with its inferred samples. */
async function onboardExperiment(
  db: Database,
  call: Call,
  stored: StoredRun,
  item: Item,
): Promise<string | null> {
  const { spec, plan } = stored;
  const planned = plan.experiments.find((e) => e.name === item.key)!;
  item.attempts += 1;
  let experimentId = (
    await db
      .selectFrom('experiment')
      .select('id')
      .where('program_id', '=', spec.program_id)
      .where('name', '=', item.key)
      .where('deleted_at', 'is', null)
      .orderBy('id')
      .executeTakeFirst()
  )?.id;
  if (!experimentId) {
    const res = await call('POST', '/v1/experiments', {
      program_id: spec.program_id,
      assay_type: spec.assay_type,
      name: item.key,
    });
    if (res.status !== 201) {
      await update(db, item, { status: 'failed', error: describe(res) });
      return null;
    }
    experimentId = res.body.id as string;
  }
  const version = await latestVersion(db, experimentId);
  if (version.status !== 'draft') {
    await update(db, item, {
      status: 'failed',
      entity_id: experimentId,
      error: 'The latest version is published: create a new version, then resume to add files.',
    });
    return null;
  }
  // Only samples the version does not have yet: curated values are never overwritten.
  const existing = new Set(
    (
      await db
        .selectFrom('sample')
        .select('sample_key')
        .where('experiment_version_id', '=', version.id)
        .where('deleted_at', 'is', null)
        .execute()
    ).map((s) => s.sample_key),
  );
  const rows = planned.samples.filter((s) => !existing.has(s.sample_key!));
  if (rows.length) {
    const res = await call('PUT', `/v1/versions/${version.id}/samples`, { rows });
    if (res.status !== 200) {
      await update(db, item, { status: 'failed', entity_id: experimentId, error: describe(res) });
      return null;
    }
  }
  await update(db, item, { status: 'done', entity_id: experimentId, error: null });
  return version.id;
}

async function onboardFile(db: Database, call: Call, stored: StoredRun, item: Item, versionId: string) {
  const planned = stored.plan.experiments.flatMap((e) => e.files).find((f) => f.key === item.key)!;
  item.attempts += 1;
  // Linking takes a prefix: refuse when another object's key starts with this one (it would be linked too).
  const allKeys = [
    ...stored.plan.experiments.flatMap((e) => e.files.map((f) => f.key)),
    ...stored.plan.unmatched,
  ];
  if (allKeys.some((k) => k !== item.key && k.startsWith(item.key))) {
    await update(db, item, {
      status: 'failed',
      error: 'Another object key starts with this key; link this file by hand.',
    });
    return;
  }
  const res = await call('POST', '/v1/files/link', {
    experiment_version_id: versionId,
    prefix: item.key,
    role: planned.role,
  });
  if (res.status !== 201) {
    await update(db, item, { status: 'failed', error: describe(res) });
    return;
  }
  const file = await db
    .selectFrom('file_object')
    .select('id')
    .where('key', '=', item.key)
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .where('ingest_status', '!=', 'rejected')
    .executeTakeFirst();
  if (!file) {
    await update(db, item, {
      status: 'failed',
      error: 'Linked elsewhere: the object belongs to another version.',
    });
    return;
  }
  await update(db, item, { status: 'done', entity_id: file.id, error: null });
}

async function onboardImport(
  db: Database,
  call: Call,
  stored: StoredRun,
  item: Item,
  fileItem: Item | undefined,
) {
  if (fileItem?.status !== 'done' || !fileItem.entity_id) return; // waits for its file
  const file = await db
    .selectFrom('file_object')
    .select('ingest_status')
    .where('id', '=', fileItem.entity_id)
    .executeTakeFirstOrThrow();
  if (file.ingest_status === 'qc_failed') {
    item.attempts += 1;
    await update(db, item, { status: 'failed', error: 'The file failed QC; an approver can override it.' });
    return;
  }
  if (file.ingest_status !== 'qc_passed') return; // checksums and QC still running: stays pending
  const planned = stored.plan.experiments.flatMap((e) => e.files).find((f) => f.key === item.key)!;
  // Already imported with this importer (an earlier run, or by hand): reuse that release, never import twice.
  const previous = await db
    .selectFrom('dataset_release')
    .select('id')
    .where('file_id', '=', fileItem.entity_id)
    .where('importer', '=', planned.importer)
    .where('status', '!=', 'rejected')
    .where('deleted_at', 'is', null)
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (previous) {
    await update(db, item, { status: 'done', entity_id: previous.id, error: null });
    return;
  }
  const pattern = stored.spec.patterns.find((p) => p.importer === planned.importer);
  item.attempts += 1;
  const res = await call('POST', '/v1/imports', {
    file_id: fileItem.entity_id,
    importer: planned.importer,
    ...(pattern?.options ? { options: pattern.options } : {}),
  });
  if (res.status !== 201) await update(db, item, { status: 'failed', error: describe(res) });
  else await update(db, item, { status: 'done', entity_id: res.body.id as string, error: null });
}

/** Processes up to `max_experiments` experiments that still have work, then sets the run's status. */
export async function processRun(db: Database, call: Call, runId: string): Promise<void> {
  const run = await db
    .selectFrom('onboarding_run')
    .select('spec')
    .where('id', '=', runId)
    .executeTakeFirstOrThrow();
  const stored = run.spec as unknown as StoredRun;
  const items = (await db
    .selectFrom('onboarding_item')
    .select(['id', 'kind', 'key', 'experiment', 'status', 'entity_id', 'attempts'])
    .where('run_id', '=', runId)
    .orderBy('position')
    .execute()) as Item[];
  const groups = new Map<string, Item[]>();
  for (const item of items) groups.set(item.experiment, [...(groups.get(item.experiment) ?? []), item]);

  let processed = 0;
  for (const group of groups.values()) {
    if (group.every((i) => i.status === 'done')) continue;
    // The batch size caps registration work; imports of already registered experiments always get their turn.
    const registering = group.some((i) => i.kind !== 'import' && i.status !== 'done');
    if (registering && processed++ >= stored.spec.max_experiments) continue;
    const experiment = group.find((i) => i.kind === 'experiment')!;
    let versionId: string | null;
    if (experiment.status !== 'done' || !experiment.entity_id) {
      versionId = await onboardExperiment(db, call, stored, experiment);
    } else {
      const version = await latestVersion(db, experiment.entity_id);
      versionId = version.status === 'draft' ? version.id : null;
    }
    const files = new Map(group.filter((i) => i.kind === 'file').map((i) => [i.key, i]));
    if (versionId) {
      for (const file of files.values()) {
        if (file.status !== 'done') await onboardFile(db, call, stored, file, versionId);
      }
    }
    for (const item of group.filter((i) => i.kind === 'import' && i.status !== 'done')) {
      await onboardImport(db, call, stored, item, files.get(item.key));
    }
  }

  const fresh = await db
    .selectFrom('onboarding_item')
    .select(['status'])
    .where('run_id', '=', runId)
    .execute();
  const status = fresh.some((i) => i.status === 'pending')
    ? 'incomplete'
    : fresh.some((i) => i.status === 'failed')
      ? 'completed_with_failures'
      : 'completed';
  await db.updateTable('onboarding_run').set({ status }).where('id', '=', runId).execute();
}
