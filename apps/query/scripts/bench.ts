// Query benchmark (Phase 12, QRY-05): generates synthetic differential-abundance releases of 5M and 50M rows and
// times typical QuerySpecs through the compiler + DuckDB, as the query service runs them. Local numbers only.
// Usage: pnpm bench:query [-- --rows 5000000,50000000 --runs 10]
import { DuckDBInstance } from '@duckdb/node-api';
import { DATASET_CONTRACTS, type QuerySpec } from '@tributary/contracts';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Sources } from '../src/compiler/index.ts';
import { runQuery } from '../src/run.ts';

const { values } = parseArgs({
  options: {
    rows: { type: 'string', default: '5000000,50000000' },
    runs: { type: 'string', default: '10' },
    dir: { type: 'string', default: join(tmpdir(), 'tributary-bench') },
  },
});
const sizes = values.rows.split(',').map(Number);
const runs = Number(values.runs);
mkdirSync(values.dir, { recursive: true });

const instance = await DuckDBInstance.create(':memory:');
const conn = await instance.connect();
const EV = '019a2b3c-4d5e-7f00-8a00-0000000000e1';

/** One DA release: 10 contrasts × N/10 features; ~5% two-protein groups; seeded pseudo-random statistics. */
async function daFile(rows: number): Promise<string> {
  const file = join(values.dir, `da-${rows}.parquet`);
  if (existsSync(file)) return file;
  await conn.run(`SELECT setseed(0.42)`);
  await conn.run(`COPY (
    SELECT '${EV}'::UUID AS experiment_version_id,
      ('019a2b3c-4d5e-7f00-8a00-00000000c0' || lpad((i % 10)::VARCHAR, 2, '0'))::UUID AS contrast_id,
      'C' || (i % 10) || ' vs DMSO' AS contrast_label, 'protein_group' AS feature_type,
      'P' || lpad((i // 10)::VARCHAR, 8, '0') AS feature_id,
      CASE WHEN i % 20 = 0 THEN ['P' || lpad((i // 10)::VARCHAR, 8, '0'), 'Q' || lpad((i // 10)::VARCHAR, 8, '0')]
           ELSE ['P' || lpad((i // 10)::VARCHAR, 8, '0')] END AS protein_ids,
      ['GENE' || ((i // 10) % 20000)] AS gene_names,
      (random() - 0.5) * 8 AS log2_fc, NULL::DOUBLE AS ci_low, NULL::DOUBLE AS ci_high, NULL::DOUBLE AS se,
      (random() - 0.5) * 20 AS t_stat, greatest(random(), 1e-12) AS p_value, greatest(random(), 1e-12) AS adj_p_value,
      'BH' AS adj_method, 15 + random() * 10 AS avg_log2_abundance, 3::INTEGER AS n_obs_num, 3::INTEGER AS n_obs_den,
      NULL::DOUBLE AS missing_pct, NULL::DOUBLE AS imputed_pct, NULL::VARCHAR AS missingness_class,
      NULL::VARCHAR AS na_reason, NULL::VARCHAR AS issue, 'limma' AS method, 'bench' AS method_version,
      '{}'::JSON AS source_columns
    FROM range(${rows}) t(i)) TO '${file}' (FORMAT parquet, COMPRESSION zstd)`);
  return file;
}

async function annotationFile(): Promise<string> {
  const file = join(values.dir, 'annotation.parquet');
  if (existsSync(file)) return file;
  await conn.run(`COPY (
    SELECT 'P' || lpad((i * 50)::VARCHAR, 8, '0') AS uniprot_accession, 'GENE' || i AS gene_symbol,
      'kinase' AS family, 'family' AS key, 'fam-' || (i % 40) AS value
    FROM range(20000) t(i)) TO '${file}' (FORMAT parquet)`);
  return file;
}

const scope = { programIds: [] };
const base: QuerySpec = { source: { kind: 'differential_abundance', scope } };
const filtered: QuerySpec = {
  ...base,
  where: {
    combinator: 'and',
    rules: [
      { field: 'gene_names', operator: 'contains', value: 'GENE1234' },
      { field: 'adj_p_value', operator: '<', value: 0.5 },
    ],
  },
  orderBy: [{ column: 'log2_fc', dir: 'desc' }],
};
const byContrast: QuerySpec = {
  ...base,
  where: {
    combinator: 'and',
    rules: [
      { field: 'contrast_label', operator: '=', value: 'C3 vs DMSO' },
      { field: 'adj_p_value', operator: '<', value: 0.05 },
    ],
  },
  orderBy: [{ column: 'log2_fc', dir: 'desc' }],
  page: { size: 100 },
};
const specs: { name: string; spec: QuerySpec; join?: boolean; page?: number }[] = [
  { name: 'first page, no filter', spec: { ...base, page: { size: 100 } } },
  { name: 'contrast + adj_p < 0.05, sort by log2_fc, page 1', spec: byContrast },
  { name: 'contrast + adj_p < 0.05, sort by log2_fc, page 3', spec: byContrast, page: 3 },
  { name: 'gene contains + adj_p, sort, page 1', spec: { ...filtered, page: { size: 100 } } },
  {
    name: 'explode join to annotations (inner), sort',
    join: true,
    spec: {
      ...base,
      joins: [
        {
          type: 'inner',
          target: { kind: 'target_annotation', scope },
          alias: 'ta',
          on: [{ left: 'protein_ids', op: '=', right: 'ta.uniprot_accession' }],
          explode: 'protein_ids',
        },
      ],
      orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
      page: { size: 100 },
    },
  },
];

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

console.log(
  `DuckDB ${(await conn.runAndReadAll('select version() v')).getRowObjectsJson()[0]!.v}, ` +
    `${cpus().length} vCPU, ${Math.round(totalmem() / 2 ** 30)} GiB RAM, local NVMe/disk, ${runs} runs after 1 warm-up`,
);
console.log('\n| Rows | Query | p50 ms | p95 ms | total rows |\n|---:|---|---:|---:|---:|');
const annotations = await annotationFile();
for (const rows of sizes) {
  const t0 = performance.now();
  const file = await daFile(rows);
  const generated = Math.round((performance.now() - t0) / 1000);
  const sources = (join?: boolean): Sources => ({
    source: { contract: DATASET_CONTRACTS.differential_abundance, files: [file] },
    joins: join ? [{ contract: DATASET_CONTRACTS.target_annotation, files: [annotations] }] : [],
  });
  for (const { name, spec, join: withJoin, page } of specs) {
    const times: number[] = [];
    let total = 0;
    for (let run = 0; run <= runs; run++) {
      const start = performance.now();
      let result = await runQuery(conn, spec, sources(withJoin), { timeoutMs: 600_000 });
      for (let p = 1; p < (page ?? 1) && result.nextCursor; p++) {
        result = await runQuery(
          conn,
          { ...spec, page: { size: 100, cursor: result.nextCursor } },
          sources(withJoin),
          {
            timeoutMs: 600_000,
          },
        );
      }
      if (run > 0) times.push(performance.now() - start);
      total = result.totalRows;
    }
    times.sort((a, b) => a - b);
    console.log(
      `| ${rows.toLocaleString('en')} | ${name} | ${Math.round(pct(times, 50))} | ${Math.round(pct(times, 95))} | ${total.toLocaleString('en')} |`,
    );
  }
  console.error(
    `(${rows} rows: file ${(statSync(file).size / 2 ** 20).toFixed(0)} MiB, generated in ${generated} s)`,
  );
}
conn.closeSync();
instance.closeSync();
