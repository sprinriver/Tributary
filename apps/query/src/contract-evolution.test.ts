import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { DATASET_CONTRACTS, type DatasetContract } from '@tributary/contracts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DUCKDB_TYPE } from './compiler/index.ts';
import { QueryError, runQuery } from './run.ts';

// Releases are immutable Parquet files written under the contract version of their day (dataset_release.contract_version).
// A later, additive contract version must not make them unreadable (ADR 0032).
type Row = Record<string, unknown>;
const EV = '019a2b3c-4d5e-7f00-8a00-0000000000e1';
const PQ = DATASET_CONTRACTS.protein_quant;

let dir: string;
let instance: DuckDBInstance;
let conn: DuckDBConnection;

/** A Parquet file with only some of the contract's columns (as an older contract version wrote it). */
async function parquet(
  name: string,
  contract: DatasetContract,
  rows: Row[],
  without: string[],
): Promise<string> {
  const json = join(dir, `${name}.ndjson`);
  writeFileSync(json, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const columns = contract.columns
    .filter((c) => !without.includes(c.name))
    .map((c) => `'${c.name}': '${DUCKDB_TYPE[c.type]}'`)
    .join(', ');
  const file = join(dir, `${name}.parquet`);
  await conn.run(
    `COPY (SELECT * FROM read_json('${json}', columns = {${columns}}, format = 'newline_delimited')) TO '${file}' (FORMAT parquet)`,
  );
  return file;
}

const row = (i: number): Row => ({
  experiment_version_id: EV,
  sample_key: `S0${i}`,
  instrument_run: `run0${i}`,
  protein_group: `P0000${i}`,
  protein_ids: [`P0000${i}`],
  gene_names: [`GENE${i}`],
  intensity: 1000 * i,
  log2_intensity: Math.log2(1000 * i),
  q_value: 0.001,
  n_precursors: i,
  is_imputed: false,
  normalisation: 'none',
});

let oldFile: string;
let newFile: string;
let brokenFile: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'trb-evolution-'));
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  // An older contract version without two nullable columns.
  oldFile = await parquet('old', PQ, [1, 2, 3].map(row), ['n_precursors', 'normalisation']);
  newFile = await parquet('new', PQ, [4, 5].map(row), []);
  // A file without a required column cannot be read as this kind.
  brokenFile = await parquet('broken', PQ, [6].map(row), ['protein_group']);
});
afterAll(() => {
  conn.closeSync();
  instance.closeSync();
  rmSync(dir, { recursive: true, force: true });
});

const spec = (select: string[], where?: Row) => ({
  source: { kind: 'protein_quant', scope: {} },
  select,
  ...(where ? { where } : {}),
  orderBy: [{ column: 'protein_group', dir: 'asc' }],
});

describe('CON-04: releases written under an older contract version stay readable', () => {
  it('CON-04: nullable columns the release does not have come back as null', async () => {
    const result = await runQuery(
      conn,
      spec(['protein_group', 'intensity', 'n_precursors', 'normalisation']),
      {
        source: { contract: PQ, files: [oldFile] },
        joins: [],
      },
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      protein_group: 'P00001',
      intensity: 1000,
      n_precursors: null,
      normalisation: null,
    });
  });

  it('CON-04: filters and sorting on such a column work, and old and new files read together', async () => {
    const filtered = await runQuery(
      conn,
      spec(['protein_group', 'n_precursors'], {
        combinator: 'and',
        rules: [{ field: 'n_precursors', operator: 'notNull' }],
      }),
      { source: { contract: PQ, files: [oldFile] }, joins: [] },
    );
    expect(filtered.rows).toEqual([]);
    const both = await runQuery(conn, spec(['protein_group', 'n_precursors']), {
      source: { contract: PQ, files: [oldFile, newFile] },
      joins: [],
    });
    expect(both.rows.map((r) => r.n_precursors)).toEqual([null, null, null, 4, 5]);
  });

  it('CON-04: a release without a required column is refused, naming the column', async () => {
    const run = runQuery(conn, spec(['protein_group']), {
      source: { contract: PQ, files: [brokenFile] },
      joins: [],
    });
    await expect(run).rejects.toBeInstanceOf(QueryError);
    await expect(run).rejects.toMatchObject({ code: 'release_schema_outdated', status: 409 });
    await expect(run).rejects.toThrow(/protein_group/);
  });
});
