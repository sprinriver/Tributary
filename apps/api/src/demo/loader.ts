// Demo data loader (DEMO-01): imports the synthetic tool outputs in fixtures/ into their seeded experiments and
// publishes them, through the API's own routes and as the caller, so authorisation, validation, immutability and
// audit are exactly those of a scientist doing it in the browser. Idempotent: a dataset that already has a
// published release for its experiment is left alone.
import type { DatasetSummary } from '@tributary/contracts';

export type Call = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface DemoDeps {
  call: Call;
  /** Bytes of a file under fixtures/. */
  readFixture(path: string): Uint8Array;
  /** PUTs one part to a presigned upload URL; returns its ETag. */
  putPart(url: string, bytes: Uint8Array): Promise<string | null>;
  /** Lets queued ingest jobs run before each status check (tests drain an in-memory queue; the CLI waits). */
  settleIngest?(): Promise<void>;
  log?(line: string): void;
}

export interface DemoDataset {
  /** Seeded experiment key: the experiment name starts with `<key>:`. */
  experiment: string;
  file: string;
  importer: string;
  dataset: string;
  /** Contrast label for statistical results (numerator vs denominator). */
  contrast?: string;
  options?: Record<string, unknown>;
}

export interface DemoResult {
  dataset: string;
  status: 'created' | 'exists';
  release: string;
  rows: number;
}

export const DEMO_DATASETS: DemoDataset[] = [
  {
    experiment: 'ONC-DIA-05',
    file: 'experiments/ONC-DIA-05/toptable.tsv',
    importer: 'limma_toptable',
    dataset: 'ONC-DIA-05 differential abundance',
    contrast: 'CPD-000005@1 µM vs DMSO',
  },
  {
    experiment: 'ONC-DIA-05',
    file: 'experiments/ONC-DIA-05/report.pg_matrix.tsv',
    importer: 'diann_pg_matrix',
    dataset: 'ONC-DIA-05 protein quant',
  },
  {
    // Doses exactly as in the CurveCurator TOML that produced curves.txt (fixtures/README.md): nM, control = 0.
    experiment: 'ONC-DIA-01',
    file: 'experiments/ONC-DIA-01/curves.txt',
    importer: 'curvecurator',
    dataset: 'ONC-DIA-01 dose response',
    options: {
      compound_id: 'CPD-000001',
      doses: [0, 1, 10, 100, 1000, 10000],
      dose_scale: 1e-9,
      dose_unit: 'M',
    },
  },
  {
    experiment: 'IMM-DIA-06',
    file: 'experiments/IMM-DIA-06/toptable.tsv',
    importer: 'limma_toptable',
    dataset: 'IMM-DIA-06 differential abundance',
    contrast: 'CPD-000006@1 µM vs DMSO',
  },
];

const REASON = 'Demo data (synthetic fixtures, pnpm demo:data)';
const INGEST_TIMEOUT_MS = 120_000;

async function ok(deps: DemoDeps, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  const res = await deps.call(method, url, payload);
  if (res.status >= 300)
    throw new Error(
      `${method} ${url} → ${res.status} ${res.body?.code ?? 'error'}: ${res.body?.message ?? 'request failed'}`,
    );
  return res.body;
}

async function findExperiment(deps: DemoDeps, key: string): Promise<{ id: string; name: string }> {
  const list = await ok(deps, 'GET', `/v1/experiments?name=${encodeURIComponent(key)}&limit=100`);
  const found = (list.items as { id: string; name: string }[]).find((e) => e.name.startsWith(`${key}:`));
  if (!found) throw new Error(`Experiment ${key} not found: run \`pnpm db:seed\` first.`);
  return found;
}

/** The published release of `name` already made from this experiment, if any. */
async function existingRelease(deps: DemoDeps, experimentId: string, name: string) {
  const list = await ok(deps, 'GET', `/v1/datasets?q=${encodeURIComponent(name)}`);
  const match = (list.items as DatasetSummary[]).find(
    (d) => d.name === name && d.experiment_id === experimentId && d.latest_release?.status === 'published',
  );
  return match?.latest_release
    ? { release: match.latest_release.id, rows: match.latest_release.row_count }
    : null;
}

async function waitForQc(deps: DemoDeps, fileId: string): Promise<void> {
  const deadline = Date.now() + INGEST_TIMEOUT_MS;
  for (;;) {
    await deps.settleIngest?.();
    const file = await ok(deps, 'GET', `/v1/files/${fileId}`);
    if (file.ingest_status === 'qc_passed') return;
    if (['qc_failed', 'rejected'].includes(file.ingest_status))
      throw new Error(`File ${file.name} did not pass QC (${file.ingest_status}).`);
    if (Date.now() > deadline)
      throw new Error(`File ${file.name} still ${file.ingest_status} after 2 minutes.`);
    if (!deps.settleIngest) await new Promise((r) => setTimeout(r, 500));
  }
}

async function upload(deps: DemoDeps, versionId: string, path: string): Promise<string> {
  const bytes = deps.readFixture(path);
  const started = await ok(deps, 'POST', '/v1/files/uploads', {
    experiment_version_id: versionId,
    name: path.split('/').pop(),
    size_bytes: bytes.length,
    role: 'processed',
  });
  const etag = await deps.putPart(started.parts[0].url, bytes);
  await ok(deps, 'POST', `/v1/files/${started.file.id}/complete`, { parts: [{ part_number: 1, etag }] });
  await waitForQc(deps, started.file.id);
  return started.file.id;
}

/** Imports and publishes every missing demo dataset; returns one result per entry of DEMO_DATASETS. */
export async function loadDemoData(deps: DemoDeps): Promise<DemoResult[]> {
  const log = deps.log ?? (() => {});
  const results = new Map<DemoDataset, DemoResult>();
  const experiments = [...new Set(DEMO_DATASETS.map((d) => d.experiment))];
  for (const key of experiments) {
    const experiment = await findExperiment(deps, key);
    const wanted = DEMO_DATASETS.filter((d) => d.experiment === key);
    const missing: DemoDataset[] = [];
    for (const d of wanted) {
      const found = await existingRelease(deps, experiment.id, d.dataset);
      if (found) {
        results.set(d, { dataset: d.dataset, status: 'exists', ...found });
        log(`  = ${d.dataset}: already published (${found.rows} rows)`);
      } else missing.push(d);
    }
    if (missing.length === 0) continue;

    // Published versions are immutable: new files go into a draft version (reused if a previous run left one).
    const versions = (await ok(deps, 'GET', `/v1/experiments/${experiment.id}/versions`)).items as {
      id: string;
      version_number: number;
      status: string;
    }[];
    const latest = versions.reduce((a, b) => (b.version_number > a.version_number ? b : a));
    const draft =
      latest.status === 'draft' ? latest.id : (await ok(deps, 'POST', `/v1/versions/${latest.id}/clone`)).id;
    log(`${experiment.name}: importing into draft version ${draft}`);
    const contrasts = (await ok(deps, 'GET', `/v1/versions/${draft}/contrasts`)).items as {
      id: string;
      label: string;
    }[];

    for (const d of missing) {
      const contrast = d.contrast ? contrasts.find((c) => c.label === d.contrast) : undefined;
      if (d.contrast && !contrast) throw new Error(`${experiment.name} has no contrast "${d.contrast}".`);
      const fileId = await upload(deps, draft, d.file);
      const staged = await ok(deps, 'POST', '/v1/imports', {
        file_id: fileId,
        importer: d.importer,
        dataset_name: d.dataset,
        ...(contrast ? { contrast_id: contrast.id } : {}),
        ...(d.options ? { options: d.options } : {}),
      });
      if (!staged.validation?.passed)
        throw new Error(`${d.dataset}: quality rules failed; release left staged.`);
      await ok(deps, 'POST', `/v1/releases/${staged.id}/publish`, { reason: REASON });
      results.set(d, { dataset: d.dataset, status: 'created', release: staged.id, rows: staged.row_count });
      log(`  + ${d.dataset}: published (${staged.row_count} rows)`);
    }
    await ok(deps, 'POST', `/v1/versions/${draft}/publish`, { reason: REASON });
    log(`  ${experiment.name}: version published`);
  }
  return DEMO_DATASETS.map((d) => results.get(d)!);
}
