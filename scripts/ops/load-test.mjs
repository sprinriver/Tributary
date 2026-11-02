// Load test (Phase 22, OPS-04): concurrent users against the running stack, end to end (api → query/compute).
// It measures p50/p95 for the SPEC §9 scenarios that the seeded data can exercise, plus the heatmap-clustering
// target on a seeded synthetic 2,000 × 100 matrix sent straight to the compute service. Engine scaling to
// 5M–50M rows is measured separately by `pnpm bench:query`.
// Dependency-free: Node's fetch only.
// Usage: pnpm run load:test [-- --base http://localhost:3000 --compute http://localhost:8000 --users 8 --iterations 10]
//   TRIBUTARY_TOKEN: a personal access token. Without it, a local run mints one with `pnpm dev:token`.
import { execFileSync } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.TRIBUTARY_URL ?? 'http://localhost:3000' },
    compute: { type: 'string', default: process.env.COMPUTE_URL ?? 'http://localhost:8000' },
    users: { type: 'string', default: '8' },
    iterations: { type: 'string', default: '10' },
  },
});
const users = Number(args.users);
const iterations = Number(args.iterations);
const base = args.base.replace(/\/$/, '');

function token() {
  if (process.env.TRIBUTARY_TOKEN) return process.env.TRIBUTARY_TOKEN;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) {
    throw new Error('Set TRIBUTARY_TOKEN (a personal access token) for a non-local --base.');
  }
  return execFileSync('node', ['apps/api/scripts/dev-token.ts'], { encoding: 'utf8' }).trim();
}
const headers = { authorization: `Bearer ${token()}`, 'content-type': 'application/json' };

async function call(path, body, url = base) {
  const res = await fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const layout = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};
const kind = (k, scope = {}) => ({ kind: k, scope });

// Discover one experiment version that has both DA results and protein quantities (seeded demo data).
const first = await call('/v1/query', { source: kind('protein_quant'), page: { size: 25 } });
const ev = first.rows[0]?.experiment_version_id;
if (!ev) throw new Error('No protein_quant data: run `pnpm db:seed` first.');
const one = (k) => kind(k, { experimentVersionIds: [ev] });
const significant = { combinator: 'and', rules: [{ field: 'adj_p_value', operator: '<', value: 0.05 }] };

/** Scenario → request, SPEC §9 target (p95, ms) or null when the SPEC sets none for the server. */
const scenarios = [
  {
    name: 'Explorer, one experiment: filter + sort + page',
    target: 2000,
    run: () =>
      call('/v1/query', {
        source: one('differential_abundance'),
        where: significant,
        orderBy: [{ column: 'log2_fc', dir: 'desc' }],
        page: { size: 100 },
      }),
  },
  {
    name: 'Cross-experiment query (all programs)',
    target: 8000,
    run: () =>
      call('/v1/query', {
        source: kind('differential_abundance'),
        where: significant,
        orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
        page: { size: 100 },
      }),
  },
  {
    name: 'Join with reference table (target annotations)',
    target: 3000,
    run: () =>
      call('/v1/query', {
        source: kind('differential_abundance'),
        joins: [
          {
            type: 'left',
            target: kind('target_annotation'),
            alias: 'ta',
            on: [{ left: 'protein_ids', op: '=', right: 'ta.uniprot_accession' }],
            explode: 'protein_ids',
          },
        ],
        orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
        page: { size: 100 },
      }),
  },
  {
    name: 'Volcano render, one experiment (figure JSON)',
    target: null,
    run: () =>
      call('/v1/charts/render', {
        spec: {
          type: 'volcano',
          data: { source: one('differential_abundance') },
          encodings: { x: 'log2_fc', y: 'adj_p_value', label: 'feature_id' },
          options: { fc_threshold: 1, p_threshold: 0.05, label_top: 10 },
          layout,
        },
      }),
  },
  {
    name: 'Heatmap, one experiment, rows + columns clustered',
    target: 10000,
    run: () =>
      call('/v1/charts/render', {
        spec: {
          type: 'heatmap',
          data: { source: one('protein_quant') },
          encodings: { x: 'sample_key', values: 'log2_intensity', rowLabel: 'protein_group' },
          options: { cluster_rows: true, cluster_columns: true, dendrograms: true },
          layout,
        },
      }),
  },
];

// SPEC §9: heatmap clustering 2,000 × 100 in < 10 s. Seeded pseudo-random matrix (seed 42), sent to compute.
function matrix(rows, cols, seed) {
  let s = seed >>> 0;
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => rand() * 10));
}
const big = matrix(2000, 100, 42);
scenarios.push({
  name: 'Clustering 2,000 × 100, both axes (compute)',
  target: 10000,
  single: true,
  run: () =>
    call(
      '/stats/cluster',
      {
        values: big,
        row_labels: big.map((_, i) => `P${i}`),
        column_labels: big[0].map((_, j) => `S${j}`),
        axis: 'both',
        method: 'average',
        metric: 'euclidean',
        leaf_ordering: 'default',
        bootstrap_n: 0,
        seed: 42,
      },
      args.compute.replace(/\/$/, ''),
    ),
});

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

console.log(
  `${cpus().length} vCPU, ${Math.round(totalmem() / 2 ** 30)} GiB RAM; ${users} concurrent users × ` +
    `${iterations} requests each, after one warm-up per scenario; base ${base}\n`,
);
console.log(
  '| Scenario | Requests | Errors | p50 ms | p95 ms | Target p95 | Result |\n|---|---:|---:|---:|---:|---:|---|',
);
let failed = 0;
for (const s of scenarios) {
  await s.run(); // warm-up (caches, connections, DuckDB metadata)
  const times = [];
  const errors = [];
  // The 2,000 × 100 clustering target is per request: run it sequentially.
  const n = s.single ? 1 : users;
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let i = 0; i < (s.single ? Math.min(iterations, 3) : iterations); i++) {
        const t0 = performance.now();
        try {
          await s.run();
          times.push(performance.now() - t0);
        } catch (e) {
          errors.push(e.message);
        }
      }
    }),
  );
  times.sort((a, b) => a - b);
  const p50 = times.length ? Math.round(pct(times, 50)) : NaN;
  const p95 = times.length ? Math.round(pct(times, 95)) : NaN;
  const ok = errors.length === 0 && (s.target === null || p95 < s.target);
  if (!ok) failed++;
  console.log(
    `| ${s.name} | ${times.length + errors.length} | ${errors.length} | ${p50} | ${p95} | ` +
      `${s.target === null ? 'interactive (client)' : `< ${s.target}`} | ${ok ? 'pass' : 'FAIL'} |`,
  );
  if (errors.length) console.error(`  first error: ${errors[0]}`);
}
console.log(
  failed ? `\nload test: ${failed} scenario(s) missed` : '\nload test: all scenarios within target',
);
process.exit(failed ? 1 : 0);
