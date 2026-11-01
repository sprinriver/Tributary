// Regression tests for the Phase 9 omics review (shared setup copied from tools.test.ts).
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalRows, runImport, type ImportContext, type ImportResult } from './index.ts';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');
const TOOLS = join(FIXTURES, 'tools');
const EV = '0190a000-0000-7000-8000-0000000000e1';
const PROGRAM = '0190a000-0000-7000-8000-0000000000a1';
const CONTRAST = { id: '0190a000-0000-7000-8000-0000000000c1', label: 'CPD-000001@1 µM vs DMSO' };
const tmp = mkdtempSync(join(tmpdir(), 'importers-tools-'));

const lines = (path: string) => readFileSync(path, 'utf8').trim().split('\n');
function runs(): NonNullable<ImportContext['runs']> {
  const [header, ...rows] = lines(join(TOOLS, 'samples.tsv'));
  const cols = header!.split('\t');
  return rows.map((row) => {
    const c = row.split('\t');
    const get = (n: string) => c[cols.indexOf(n)] ?? null;
    return {
      sample_key: get('sample_key')!,
      instrument_run: get('instrument_run'),
      raw_file: get('raw_file'),
      condition: get('condition'),
    };
  });
}
const ctx = (extra: Partial<ImportContext> = {}): ImportContext => ({
  experimentVersionId: EV,
  programId: PROGRAM,
  runs: runs(),
  ...extra,
});
const write = (name: string, text: string) => {
  const path = join(tmp, name);
  writeFileSync(path, text);
  return path;
};
const errors = (r: ImportResult) => r.failures.filter((f) => f.severity === 'error').map((f) => f.rule_id);

let conn: DuckDBConnection;
beforeAll(async () => {
  conn = await (await DuckDBInstance.create(':memory:')).connect();
});
afterAll(() => conn.closeSync());

describe('DS-06: review fixes (omics-reviewer, Phase 9)', () => {
  it('DS-06: a name that is one sample key and another sample run is ambiguous', async () => {
    const twisted = runs().map((r, i) => (i === 1 ? { ...r, instrument_run: 'TOOLS-S01' } : r));
    const result = await runImport(
      conn,
      'maxquant_protein_groups',
      join(TOOLS, 'maxquant/proteinGroups.txt'),
      ctx({ runs: twisted }),
    );
    expect(errors(result)).toContain('run_ambiguous');
  });
  it('DS-06: two runs mapping to one sample are rejected', async () => {
    const text = readFileSync(join(TOOLS, 'alphadia/precursors.tsv'), 'utf8').replaceAll(
      'TOOLS_run02',
      'TOOLS_run01.raw',
    );
    const result = await runImport(conn, 'alphadia_precursors', write('dup-runs.tsv', text), ctx());
    expect(errors(result)).toContain('sample_multiple_runs');
  });
  it('DS-06: deseq2_results rejects p = 0 (outside (0, 1]) naming the rule — underflow handling is an open decision', async () => {
    const rows = lines(join(TOOLS, 'deseq2/results.csv'));
    const cells = rows[5]!.split(',');
    cells[5] = '0';
    rows[5] = cells.join(',');
    const result = await runImport(
      conn,
      'deseq2_results',
      write('p0.csv', rows.join('\n')),
      ctx({ contrast: CONTRAST }),
    );
    expect(errors(result)).toContain('p_value_range');
  });
  it('DS-06: Spectronaut NaN and Filtered quantities become null intensity and null log2', async () => {
    const [header, first, ...rest] = lines(join(TOOLS, 'spectronaut/report.tsv'));
    const cols = header!.split('\t');
    const q = cols.indexOf('PG.Quantity');
    const set = (line: string, v: string) =>
      line
        .split('\t')
        .map((c, i) => (i === q ? v : c))
        .join('\t');
    const text = [
      header,
      set(first!, 'NaN'),
      ...rest.map((l) =>
        l.split('\t')[3] === first!.split('\t')[3] && l.split('\t')[0] === first!.split('\t')[0]
          ? set(l, 'NaN')
          : l,
      ),
    ].join('\n');
    const result = await runImport(conn, 'spectronaut_report', write('nan.tsv', text), ctx());
    expect(errors(result)).toEqual([]);
    const rows = await canonicalRows(conn, result);
    const nan = rows.filter((r) => r.intensity === null);
    expect(nan.length).toBeGreaterThan(0);
    expect(nan.every((r) => r.log2_intensity === null)).toBe(true);
  });
  it('DS-06: curvecurator rejects a dose unit other than molar', async () => {
    const curves = join(FIXTURES, 'experiments/ONC-DIA-01/curves.txt');
    await expect(
      runImport(
        conn,
        'curvecurator',
        curves,
        ctx({
          options: {
            compound_id: 'CPD-000001',
            doses: [0, 1, 10, 100, 1000, 10000],
            dose_scale: 1,
            dose_unit: 'nM',
          },
        }),
      ),
    ).rejects.toThrow(/dose_unit/);
  });
});
