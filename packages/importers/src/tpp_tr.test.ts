import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalRows, detectImporters, rowsHash, runImport, type ImportContext } from './index.ts';

// TPP-TR result table (SOURCE.md: Bioconductor TPP 3.40.2). The fixture has 30 proteins, experiments Vehicle_1,
// Vehicle_2, CPD5_1 and CPD5_2, and ten isobaric labels measured at 37–67 °C.
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/tools/tpp/tr_results.tsv');
const GOLDEN = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden.json'), 'utf8')) as Record<
  string,
  string
>;
const LABELS = ['126', '127L', '127H', '128L', '128H', '129L', '129H', '130L', '130H', '131L'];
const TEMPERATURES = [37, 41, 44, 47, 50, 53, 56, 59, 63, 67];
const temperatures = Object.fromEntries(LABELS.map((l, i) => [l, TEMPERATURES[i]!]));
const ctx = (options: Record<string, unknown> = {}): ImportContext => ({
  experimentVersionId: '0190a000-0000-7000-8000-0000000000e1',
  programId: '0190a000-0000-7000-8000-0000000000a1',
  options: { compound_id: 'CPD-000005', feature_type: 'gene', temperatures, ...options },
});
const tmp = mkdtempSync(join(tmpdir(), 'importers-tpp-'));
const write = (name: string, text: string) => {
  const path = join(tmp, name);
  writeFileSync(path, text);
  return path;
};

let conn: DuckDBConnection;
beforeAll(async () => {
  conn = await (await DuckDBInstance.create(':memory:')).connect();
});
afterAll(() => conn.closeSync());

describe('TPP-01: tpp_tr', () => {
  it('TPP-01: tpp_tr is detected from the header of a TPP-TR result table', async () => {
    expect(await detectImporters(conn, FIXTURE)).toContain('tpp_tr');
  });

  it('TPP-01: tpp_tr golden — one row per protein and comparison, with ΔTm = treatment − vehicle', async () => {
    const result = await runImport(conn, 'tpp_tr', FIXTURE, ctx());
    expect(result.failures.filter((f) => f.severity === 'error')).toEqual([]);
    const rows = await canonicalRows(conn, result);
    expect(rows).toHaveLength(60);
    expect(rowsHash(rows), 'tpp_tr golden').toBe(GOLDEN.tpp_tr);
    const tp53 = rows.find((r) => r.feature_id === 'TP53' && r.comparison === 'CPD5_1 vs Vehicle_1')!;
    expect(tp53).toMatchObject({
      compound_id: 'CPD-000005',
      treatment_experiment: 'CPD5_1',
      vehicle_experiment: 'Vehicle_1',
      gene_names: ['TP53'],
      protein_ids: [],
      melt_point_treatment: 57.2536,
      melt_point_vehicle: 51.162,
      delta_tm: 6.09159,
      adj_p_value: 0.00288461,
      adj_method: 'BH (TPP robust z-test within slope bins)',
      passed_filter: true,
      fulfills_all_requirements: true,
      fold_change_normalised: true,
      temperatures_c: TEMPERATURES,
      method: 'TPP',
      method_version: 'unknown', // the importers' shared default when options.tool_version is absent
    });
    expect((tp53.fc_vehicle as number[])[0]).toBe(1); // relative to the lowest temperature
    expect(tp53.fc_vehicle as number[]).toHaveLength(10);
    expect(tp53.a_treatment).toBeGreaterThan(0);
    expect(result.transformations.map((t) => t.step)).toEqual(
      expect.arrayContaining(['reshape', 'temperatures', 'adjusted_p']),
    );
  });

  it('TPP-01: tpp_tr keeps NA as null: no p-value when the filter failed, no parameters when a curve was not fitted', async () => {
    const rows = await canonicalRows(conn, await runImport(conn, 'tpp_tr', FIXTURE, ctx()));
    const filtered = rows.find((r) => r.feature_id === 'PTEN' && r.comparison === 'CPD5_1 vs Vehicle_1')!;
    expect(filtered).toMatchObject({ passed_filter: false, adj_p_value: null });
    expect(filtered.delta_tm).toBeCloseTo(1.42879, 5); // the shift is kept
    const unfitted = rows.find((r) => r.feature_id === 'CDK2' && r.comparison === 'CPD5_2 vs Vehicle_2')!;
    expect(unfitted).toMatchObject({
      melt_point_treatment: null,
      delta_tm: null,
      adj_p_value: null,
      fulfills_all_requirements: null,
    });
    expect((unfitted.fc_treatment as (number | null)[]).every((v) => v === null)).toBe(true);
  });

  it('TPP-01: tpp_tr orders fold changes by temperature, whatever the order of the labels given', async () => {
    const reversed = Object.fromEntries(Object.entries(temperatures).reverse());
    const a = await canonicalRows(conn, await runImport(conn, 'tpp_tr', FIXTURE, ctx()));
    const b = await canonicalRows(
      conn,
      await runImport(conn, 'tpp_tr', FIXTURE, ctx({ temperatures: reversed })),
    );
    expect(rowsHash(b)).toBe(rowsHash(a));
  });

  it('TPP-01: tpp_tr needs the temperature of every label and a compound', async () => {
    await expect(runImport(conn, 'tpp_tr', FIXTURE, ctx({ temperatures: undefined }))).rejects.toThrow(
      /temperatures/,
    );
    const { '131L': _dropped, ...nine } = temperatures;
    await expect(runImport(conn, 'tpp_tr', FIXTURE, ctx({ temperatures: nine }))).rejects.toThrow(/131L/);
    await expect(runImport(conn, 'tpp_tr', FIXTURE, ctx({ compound_id: undefined }))).rejects.toThrow(
      /compound_id/,
    );
  });

  it('TPP-01: tpp_tr reads older tables: no a/b columns, raw rel_fc columns, the quality check under its other name', async () => {
    const [header, ...lines] = readFileSync(FIXTURE, 'utf8').trim().split('\n');
    const cols = header!.split('\t');
    const keep = cols.map((c) => !/^[ab]_/.test(c));
    const rename = (c: string) =>
      c
        .replace(/^norm_rel_fc_/, 'rel_fc_')
        .replace('min_pVals_less_0.1_and_max_pVals_less_0.2', 'min_pVals_less_0.05_and_max_pVals_less_0.1');
    const text = [
      cols
        .filter((_, i) => keep[i])
        .map(rename)
        .join('\t'),
      ...lines.map((l) =>
        l
          .split('\t')
          .filter((_, i) => keep[i])
          .join('\t'),
      ),
    ].join('\n');
    const result = await runImport(conn, 'tpp_tr', write('old.tsv', text), ctx());
    expect(result.failures.filter((f) => f.severity === 'error')).toEqual([]);
    const rows = await canonicalRows(conn, result);
    const tp53 = rows.find((r) => r.feature_id === 'TP53' && r.comparison === 'CPD5_1 vs Vehicle_1')!;
    expect(tp53).toMatchObject({ a_treatment: null, b_vehicle: null, fold_change_normalised: false });
    expect(tp53.delta_tm).toBeCloseTo(6.09159, 5);
  });

  it('TPP-01: tpp_tr rejects an adjusted p-value outside (0, 1], naming the rule', async () => {
    const [header, ...lines] = readFileSync(FIXTURE, 'utf8').trim().split('\n');
    const at = header!.split('\t').indexOf('pVal_adj_CPD5_1_vs_Vehicle_1');
    const first = lines[0]!.split('\t');
    first[at] = '1.5';
    const result = await runImport(
      conn,
      'tpp_tr',
      write('bad.tsv', [header, first.join('\t'), ...lines.slice(1)].join('\n')),
      ctx(),
    );
    expect(result.failures.filter((f) => f.severity === 'error').map((f) => f.rule_id)).toContain(
      'adj_p_value_range',
    );
  });
});
