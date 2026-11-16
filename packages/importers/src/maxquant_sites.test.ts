import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalRows, detectImporters, rowsHash, runImport, type ImportContext } from './index.ts';

// MaxQuant site table (maxquant_sites/SOURCE.md). The synthetic fixture has 41 sites plus one reverse and one
// contaminant row, six samples (the ONC-DIA-05 sample keys) and Intensity <sample>___1…3 columns.
const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');
const SITES = join(FIXTURES, 'tools/maxquant/Phospho_STY_Sites.txt');
const GOLDEN = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden.json'), 'utf8')) as Record<
  string,
  string
>;
const SAMPLES = [1, 2, 3, 4, 5, 6].map((i) => `ONC-DIA-05-S0${i}`);
const runs = SAMPLES.map((s, i) => ({
  sample_key: s,
  instrument_run: `ONC-DIA-05_run0${i + 1}`,
  raw_file: `ONC-DIA-05_run0${i + 1}.raw`,
}));
const ctx = (options: Record<string, unknown> = {}, more: Partial<ImportContext> = {}): ImportContext => ({
  experimentVersionId: '0190a000-0000-7000-8000-0000000000e1',
  programId: '0190a000-0000-7000-8000-0000000000a1',
  runs,
  options,
  ...more,
});
const tmp = mkdtempSync(join(tmpdir(), 'importers-sites-'));
const write = (name: string, text: string) => {
  const path = join(tmp, name);
  writeFileSync(path, text);
  return path;
};
/** The fixture with each header passed through `header` and, optionally, each column dropped by `keep`. */
const edited = (name: string, header: (h: string) => string, keep: (h: string) => boolean = () => true) => {
  const [head, ...lines] = readFileSync(SITES, 'utf8').trim().split('\n');
  const cols = head!.split('\t');
  const k = cols.map(keep);
  return write(
    name,
    [
      cols
        .filter((_, i) => k[i])
        .map(header)
        .join('\t'),
      ...lines.map((l) =>
        l
          .split('\t')
          .filter((_, i) => k[i])
          .join('\t'),
      ),
    ].join('\n'),
  );
};
const severity = (r: Awaited<ReturnType<typeof runImport>>, s: 'error' | 'warn') =>
  r.failures.filter((f) => f.severity === s).map((f) => f.rule_id);

let conn: DuckDBConnection;
beforeAll(async () => {
  conn = await (await DuckDBInstance.create(':memory:')).connect();
});
afterAll(() => conn.closeSync());

describe('PTM-01: maxquant_sites', { timeout: 30_000 }, () => {
  it('PTM-01: maxquant_sites is detected from the header of a MaxQuant site table', async () => {
    const found = await detectImporters(conn, SITES);
    expect(found).toContain('maxquant_sites');
    expect(found).not.toContain('maxquant_protein_groups');
  });

  it('PTM-01: maxquant_sites golden — one row per site × sample × multiplicity; flagged rows removed and counted', async () => {
    const result = await runImport(conn, 'maxquant_sites', SITES, ctx());
    expect(severity(result, 'error')).toEqual([]);
    expect(severity(result, 'warn')).toContain('flagged_rows_removed');
    const rows = await canonicalRows(conn, result);
    expect(rows).toHaveLength(41 * 6 * 3);
    expect(rowsHash(rows), 'maxquant_sites golden').toBe(GOLDEN.maxquant_sites);
    const s473 = rows.filter((r) => r.site_id === 'P31749_S473');
    expect(s473).toHaveLength(18);
    expect(s473[0]).toMatchObject({
      protein: 'P31749',
      protein_ids: ['P31749'],
      gene_names: ['AKT1'],
      amino_acid: 'S',
      position: 473,
      modification: 'Phospho (STY)',
      method: 'MaxQuant',
      method_version: 'unknown',
    });
    expect(s473[0]!.localization_prob).toBeCloseTo(0.800479, 6);
    expect(String(s473[0]!.sequence_window)).toHaveLength(31);
    expect(String(s473[0]!.sequence_window)[15]).toBe('S');
    expect(new Set(s473.map((r) => r.multiplicity))).toEqual(new Set([1, 2, 3]));
    expect(new Set(s473.map((r) => r.sample_key))).toEqual(new Set(SAMPLES));
    expect(
      rows.some((r) => String(r.protein).startsWith('REV__') || String(r.protein).startsWith('CON__')),
    ).toBe(false);
    const steps = result.transformations.map((t) => t.step);
    expect(steps).toEqual(expect.arrayContaining(['melt', 'site_id', 'filter', 'zeros']));
  });

  it('PTM-01: maxquant_sites keeps a site on several proteins with each position, and zeros as reported', async () => {
    const rows = await canonicalRows(conn, await runImport(conn, 'maxquant_sites', SITES, ctx()));
    const shared = rows.find((r) => (r.protein_ids as string[]).length > 1)!;
    expect(shared.protein_ids).toEqual(['P04637', 'P60484']);
    expect(shared.positions_in_proteins).toEqual(['138', '101']);
    expect(shared.site_id).toBe('P04637_T138');
    const zero = rows.find((r) => r.intensity === 0)!;
    expect(zero.log2_intensity).toBeNull();
    const nan = rows.filter((r) => r.localization_prob_sample === null && Number(r.intensity) > 0);
    expect(nan.length).toBeGreaterThan(0); // NaN read as null, never as a probability
  });

  it('PTM-01: maxquant_sites keeps flagged rows on request and reads tables without multiplicity columns', async () => {
    const kept = await canonicalRows(
      conn,
      await runImport(conn, 'maxquant_sites', SITES, ctx({ keep_flagged: true })),
    );
    expect(kept).toHaveLength(43 * 6 * 3);
    const flat = await runImport(
      conn,
      'maxquant_sites',
      edited(
        'flat.tsv',
        (h) => h,
        (h) => !/___\d$/.test(h),
      ),
      ctx(),
    );
    expect(severity(flat, 'error')).toEqual([]);
    const rows = await canonicalRows(conn, flat);
    expect(rows).toHaveLength(41 * 6);
    expect(rows.every((r) => r.multiplicity === null)).toBe(true);
  });

  it('PTM-01: maxquant_sites names the modification from the probabilities column, or needs it as an option', async () => {
    const renamed = edited('acetyl.tsv', (h) => h.replaceAll('Phospho (STY)', 'Acetyl (K)'));
    const rows = await canonicalRows(conn, await runImport(conn, 'maxquant_sites', renamed, ctx()));
    expect(rows[0]!.modification).toBe('Acetyl (K)');
    const none = edited(
      'nomod.tsv',
      (h) => h,
      (h) => !h.endsWith(' Probabilities'),
    );
    await expect(runImport(conn, 'maxquant_sites', none, ctx())).rejects.toThrow(/modification/);
    const given = await canonicalRows(
      conn,
      await runImport(conn, 'maxquant_sites', none, ctx({ modification: 'Phospho (STY)' })),
    );
    expect(given[0]!.modification).toBe('Phospho (STY)');
  });

  it('PTM-01: maxquant_sites refuses a labelled-only table and reports samples missing from the manifest', async () => {
    const silac = edited(
      'silac.tsv',
      (h) => h.replace(/^Intensity (ONC)/, 'Intensity L $1'),
      (h) => h !== 'Intensity' && !/^Intensity___/.test(h),
    );
    await expect(runImport(conn, 'maxquant_sites', silac, ctx())).rejects.toThrow(/labelled/);
    const result = await runImport(conn, 'maxquant_sites', SITES, ctx({}, { runs: runs.slice(1) }));
    expect(severity(result, 'error')).toContain('run_in_manifest');
  });

  it('PTM-01: maxquant_sites rejects a localisation probability outside [0, 1], naming the rule', async () => {
    const [head, ...lines] = readFileSync(SITES, 'utf8').trim().split('\n');
    const at = head!.split('\t').indexOf('Localization prob');
    const first = lines[0]!.split('\t');
    first[at] = '1.4';
    const result = await runImport(
      conn,
      'maxquant_sites',
      write('bad.tsv', [head, first.join('\t'), ...lines.slice(1)].join('\n')),
      ctx(),
    );
    expect(severity(result, 'error')).toContain('localization_prob_range');
  });
});
