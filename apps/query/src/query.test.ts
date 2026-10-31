import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { DATASET_CONTRACTS, type DatasetContract, type QuerySpec } from '@tributary/contracts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DUCKDB_TYPE, type SourceInput } from './compiler/index.ts';
import { exportQuery, QueryError, runQuery } from './run.ts';

type Row = Record<string, unknown>;
const scope = { programIds: ['019a2b3c-4d5e-7f00-8a00-000000000001'] };
const EV = '019a2b3c-4d5e-7f00-8a00-0000000000e1';
const CONTRAST = '019a2b3c-4d5e-7f00-8a00-0000000000c1';

let dir: string;
let instance: DuckDBInstance;
let conn: DuckDBConnection;

/** Writes rows (missing contract columns are NULL) as a Parquet file with the contract's column types. */
async function parquet(name: string, contract: DatasetContract, rows: Row[]): Promise<string> {
  const json = join(dir, `${name}.ndjson`);
  writeFileSync(json, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const columns = contract.columns.map((c) => `'${c.name}': '${DUCKDB_TYPE[c.type]}'`).join(', ');
  const file = join(dir, `${name}.parquet`);
  await conn.run(
    `COPY (SELECT * FROM read_json('${json}', columns = {${columns}}, format = 'newline_delimited')) TO '${file}' (FORMAT parquet)`,
  );
  return file;
}

const all = async (sql: string): Promise<Row[]> =>
  (await conn.runAndReadAll(sql)).getRowObjectsJson() as Row[];

const daRow = (i: number, extra: Row = {}): Row => ({
  experiment_version_id: EV,
  contrast_id: CONTRAST,
  contrast_label: 'CPD-000005@1 µM vs DMSO',
  feature_type: 'protein_group',
  feature_id: `P${String(i).padStart(3, '0')}`,
  protein_ids: [`P${String(i).padStart(3, '0')}`],
  gene_names: [i % 10 === 0 ? `CDK${i}` : `GENE${i}`],
  log2_fc: Math.round(((i * 37) % 41) - 20) / 10,
  adj_p_value: ((i * 13) % 100) / 1000 + 0.0001,
  p_value: ((i * 13) % 100) / 2000 + 0.00005,
  adj_method: 'BH',
  method: 'limma',
  method_version: '3.62.0',
  source_columns: {},
  ...extra,
});

let daFile: string;
let doseFile: string;
let compoundFile: string;
let annotationFile: string;
const da = (): SourceInput => ({ contract: DATASET_CONTRACTS.differential_abundance, files: [daFile] });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'trb-query-test-'));
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  daFile = await parquet(
    'da',
    DATASET_CONTRACTS.differential_abundance,
    Array.from({ length: 60 }, (_, i) =>
      daRow(
        i + 1,
        i === 1
          ? { protein_ids: ['P002', 'P902'], feature_id: 'P002;P902' }
          : i === 2
            ? { log2_fc: null }
            : {},
      ),
    ),
  );
  doseFile = await parquet(
    'dose',
    DATASET_CONTRACTS.dose_response,
    ['CPD-000001', 'CPD-000002', 'CPD-000003', 'OTHER-1'].map((compound_id, i) => ({
      experiment_version_id: EV,
      feature_id: `P00${i}`,
      protein_ids: [`P00${i}`],
      gene_names: [`GENE${i}`],
      compound_id,
      n_doses: 8,
      doses_molar: [1e-9, 1e-8],
      responses: [1, 0.5],
      pec50: 6 + i / 10,
      regulation: 'down',
      method: 'CurveCurator',
      method_version: '0.6.0',
    })),
  );
  compoundFile = await parquet(
    'compound',
    DATASET_CONTRACTS.compound,
    ['CPD-000001', 'CPD-000002', 'CPD-000003', 'OTHER-1'].map((compound_id, i) => ({
      compound_id,
      name: i === 3 ? 'Other' : `CPD ${i}`,
      external_ids: {},
      program_id: scope.programIds[0],
    })),
  );
  annotationFile = await parquet(
    'annotation',
    DATASET_CONTRACTS.target_annotation,
    ['P001', 'P002', 'P902'].map((uniprot_accession) => ({
      uniprot_accession,
      key: 'family',
      value: `fam-${uniprot_accession}`,
    })),
  );
});
afterAll(() => {
  conn.closeSync();
  instance.closeSync();
  rmSync(dir, { recursive: true, force: true });
});

async function allPages(spec: QuerySpec, sources: Parameters<typeof runQuery>[2]): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | undefined;
  do {
    const page = await runQuery(
      conn,
      { ...spec, page: { size: 25, ...(cursor ? { cursor } : {}) } },
      sources,
    );
    rows.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

describe('query execution against Parquet releases', () => {
  it('QRY-01: a filter returns the same rows as hand-written SQL', async () => {
    const result = await runQuery(
      conn,
      {
        source: { kind: 'differential_abundance', scope },
        where: {
          combinator: 'or',
          rules: [
            { field: 'gene_names', operator: 'contains', value: 'CDK10' },
            {
              combinator: 'and',
              rules: [
                { field: 'adj_p_value', operator: '<', value: 0.02 },
                { field: 'log2_fc', operator: '>', value: 0 },
              ],
            },
          ],
        },
        select: ['feature_id', 'log2_fc'],
        orderBy: [{ column: 'feature_id', dir: 'asc' }],
      },
      { source: da(), joins: [] },
    );
    const expected = await all(
      `SELECT feature_id, log2_fc FROM '${daFile}'
       WHERE list_contains(gene_names, 'CDK10') OR (adj_p_value < 0.02 AND log2_fc > 0) ORDER BY feature_id`,
    );
    expect(result.rows).toEqual(expected);
    expect(result.totalRows).toBe(expected.length);
    expect(result.columns.map((c) => c.name)).toEqual(['feature_id', 'log2_fc']);
  });

  it('QRY-01: negations keep rows whose value is NULL (nothing is dropped silently)', async () => {
    const count = async (where: QuerySpec['where']) =>
      (
        await runQuery(
          conn,
          { source: { kind: 'differential_abundance', scope }, where },
          { source: da(), joins: [] },
        )
      ).totalRows;
    // P003 has log2_fc NULL; every other row has |log2_fc| <= 2.
    expect(
      await count({
        combinator: 'and',
        rules: [{ field: 'log2_fc', operator: 'notBetween', value: [-100, 100] }],
      }),
    ).toBe(1);
    expect(
      await count({
        combinator: 'and',
        not: true,
        rules: [{ field: 'log2_fc', operator: '>', value: -100 }],
      }),
    ).toBe(1);
    expect(await count({ combinator: 'and', rules: [{ field: 'log2_fc', operator: '!=', value: 99 }] })).toBe(
      60,
    );
    expect(
      await count({ combinator: 'and', rules: [{ field: 'log2_fc', operator: 'notIn', value: [99] }] }),
    ).toBe(60);
  });

  it('QRY-02: a LEFT join with a per-join filter keeps every primary row', async () => {
    const result = await runQuery(
      conn,
      {
        source: { kind: 'dose_response', scope },
        joins: [
          {
            type: 'left',
            target: { kind: 'compound', scope },
            alias: 'cpd',
            on: [{ left: 'compound_id', op: '=', right: 'cpd.compound_id' }],
            where: { combinator: 'and', rules: [{ field: 'name', operator: 'beginsWith', value: 'CPD' }] },
          },
        ],
        select: ['compound_id', 'pec50', 'cpd.name'],
        orderBy: [{ column: 'compound_id', dir: 'asc' }],
      },
      {
        source: { contract: DATASET_CONTRACTS.dose_response, files: [doseFile] },
        joins: [{ contract: DATASET_CONTRACTS.compound, files: [compoundFile] }],
      },
    );
    const expected = await all(
      `SELECT d.compound_id, d.pec50, c.name AS "cpd.name" FROM '${doseFile}' d
       LEFT JOIN (SELECT * FROM '${compoundFile}' WHERE starts_with(name, 'CPD')) c ON d.compound_id = c.compound_id
       ORDER BY d.compound_id`,
    );
    expect(result.rows).toEqual(expected);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.find((r) => r.compound_id === 'OTHER-1')?.['cpd.name']).toBeNull();
  });

  it('QRY-02: explode joins each accession of a protein group and flags the ambiguity', async () => {
    const result = await runQuery(
      conn,
      {
        source: { kind: 'differential_abundance', scope },
        joins: [
          {
            type: 'inner',
            target: { kind: 'target_annotation', scope },
            alias: 'ta',
            on: [{ left: 'protein_ids', op: '=', right: 'ta.uniprot_accession' }],
            explode: 'protein_ids',
          },
        ],
        select: ['feature_id', 'ta.value'],
        orderBy: [{ column: 'ta.value', dir: 'asc' }],
      },
      { source: da(), joins: [{ contract: DATASET_CONTRACTS.target_annotation, files: [annotationFile] }] },
    );
    expect(result.rows).toEqual([
      { feature_id: 'P001', 'ta.value': 'fam-P001', explode_value: 'P001', explode_ambiguous: false },
      { feature_id: 'P002;P902', 'ta.value': 'fam-P002', explode_value: 'P002', explode_ambiguous: true },
      { feature_id: 'P002;P902', 'ta.value': 'fam-P902', explode_value: 'P902', explode_ambiguous: true },
    ]);
  });

  it('QRY-01: sort and cursor pagination return every row once, in order', async () => {
    const spec: QuerySpec = {
      source: { kind: 'differential_abundance', scope },
      select: ['feature_id', 'log2_fc'],
      orderBy: [{ column: 'log2_fc', dir: 'desc' }],
    };
    const rows = await allPages(spec, { source: da(), joins: [] });
    const expected = await all(
      `SELECT feature_id, log2_fc FROM read_parquet('${daFile}', file_row_number = true)
       ORDER BY log2_fc DESC NULLS LAST, file_row_number`,
    );
    expect(rows).toEqual(expected);
    expect(rows).toHaveLength(60);
    const first = await runQuery(conn, { ...spec, page: { size: 25 } }, { source: da(), joins: [] });
    expect(first.totalRows).toBe(60);
    await expect(
      runQuery(
        conn,
        {
          ...spec,
          orderBy: [{ column: 'feature_id', dir: 'asc' }],
          page: { size: 25, cursor: first.nextCursor! },
        },
        { source: da(), joins: [] },
      ),
    ).rejects.toMatchObject({ code: 'invalid_cursor' });
  });

  it('QRY-03: limitRows caps the result; a slow query is interrupted at the timeout', async () => {
    const capped = await allPages(
      { source: { kind: 'differential_abundance', scope }, select: ['feature_id'], limitRows: 30 },
      { source: da(), joins: [] },
    );
    expect(capped).toHaveLength(30);
    const big = join(dir, 'big.parquet');
    await conn.run(
      `COPY (SELECT * EXCLUDE (range) REPLACE (md5(range::VARCHAR) AS feature_id)
       FROM read_parquet('${daFile}') CROSS JOIN range(5000)) TO '${big}' (FORMAT parquet)`,
    );
    const slow = runQuery(
      conn,
      {
        source: { kind: 'differential_abundance', scope },
        where: { combinator: 'and', rules: [{ field: 'feature_id', operator: 'contains', value: 'ab' }] },
        orderBy: [{ column: 'feature_id', dir: 'desc' }],
      },
      { source: { contract: DATASET_CONTRACTS.differential_abundance, files: [big] }, joins: [] },
      { timeoutMs: 1 },
    );
    await expect(slow).rejects.toBeInstanceOf(QueryError);
    await expect(slow).rejects.toMatchObject({ code: 'query_timeout' });
  });

  it('QRY-06: a metadata table joins to a release on experiment_version_id with a per-join filter', async () => {
    await conn.run(
      `CREATE OR REPLACE TEMP TABLE meta_sample_test AS SELECT * FROM (VALUES
        ('${EV}'::UUID, 'S1', 'MCF-7', 1e-6, 24.0), ('${EV}'::UUID, 'S2', 'HeLa', 0.0, 24.0))
        t(experiment_version_id, sample_key, cell_line, dose_molar, time_hours)`,
    );
    const contract = {
      ...DATASET_CONTRACTS.sample,
      columns: DATASET_CONTRACTS.sample.columns.filter((c) =>
        ['experiment_version_id', 'sample_key', 'cell_line', 'dose_molar', 'time_hours'].includes(c.name),
      ),
    };
    const result = await runQuery(
      conn,
      {
        source: { kind: 'differential_abundance', scope },
        joins: [
          {
            type: 'inner',
            target: { kind: 'sample', scope },
            alias: 's',
            on: [{ left: 'experiment_version_id', op: '=', right: 's.experiment_version_id' }],
            where: { combinator: 'and', rules: [{ field: 'cell_line', operator: '=', value: 'MCF-7' }] },
          },
        ],
        where: { combinator: 'and', rules: [{ field: 'feature_id', operator: '=', value: 'P001' }] },
        select: ['feature_id', 's.cell_line', 's.dose_molar', 's.time_hours'],
      },
      { source: da(), joins: [{ contract, table: 'meta_sample_test' }] },
    );
    expect(result.rows).toEqual([
      { feature_id: 'P001', 's.cell_line': 'MCF-7', 's.dose_molar': 1e-6, 's.time_hours': 24 },
    ]);
  });

  it('QRY-04: CSV, TSV and Parquet exports equal the paged rows for the same spec', async () => {
    const spec: QuerySpec = {
      source: { kind: 'differential_abundance', scope },
      where: { combinator: 'and', rules: [{ field: 'adj_p_value', operator: '<', value: 0.05 }] },
      select: ['feature_id', 'gene_names', 'log2_fc', 'adj_p_value'],
      orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
    };
    const sources = { source: da(), joins: [] };
    const rows = await allPages(spec, sources);
    expect(rows.length).toBeGreaterThan(25);

    const pq = join(dir, 'export.parquet');
    expect((await exportQuery(conn, spec, sources, 'parquet', pq)).row_count).toBe(rows.length);
    expect(await all(`SELECT * FROM '${pq}'`)).toEqual(rows);

    const csv = join(dir, 'export.csv');
    await exportQuery(conn, spec, sources, 'csv', csv);
    const lines = readFileSync(csv, 'utf8').trim().split('\n');
    expect(lines[0]).toBe('feature_id,gene_names,log2_fc,adj_p_value');
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(rows.map((r) => r.feature_id));

    const tsv = join(dir, 'export.tsv');
    await exportQuery(conn, spec, sources, 'tsv', tsv);
    const tsvLines = readFileSync(tsv, 'utf8').trim().split('\n');
    expect(tsvLines[0]).toBe('feature_id\tgene_names\tlog2_fc\tadj_p_value');
    expect(tsvLines).toHaveLength(rows.length + 1);
  });
});
