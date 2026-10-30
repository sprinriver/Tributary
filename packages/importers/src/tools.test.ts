import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  canonicalRows,
  IMPORTERS,
  rowsHash,
  runImport,
  type ImportContext,
  type ImportResult,
} from './index.ts';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');
const TOOLS = join(FIXTURES, 'tools');
const GOLDEN = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden.json'), 'utf8')) as Record<
  string,
  string
>;
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
const warnings = (r: ImportResult) => r.failures.filter((f) => f.severity === 'warn');

let conn: DuckDBConnection;
beforeAll(async () => {
  conn = await (await DuckDBInstance.create(':memory:')).connect();
});
afterAll(() => conn.closeSync());

/** Parquet written by DuckDB from the committed TSV fixtures (the fixtures stay text so `pnpm synth` owns them). */
async function parquet(name: string, select: string): Promise<string> {
  const path = join(tmp, name);
  await conn.run(`COPY (${select}) TO '${path}' (FORMAT parquet)`);
  return path;
}

async function golden(key: string, result: ImportResult): Promise<Record<string, unknown>[]> {
  expect(errors(result), JSON.stringify(result.failures)).toEqual([]);
  const rows = await canonicalRows(conn, result);
  expect(rowsHash(rows), `${key} golden`).toBe(GOLDEN[key]);
  return rows;
}

it('DS-06: every §6.3 importer is registered with a SOURCE.md', () => {
  const keys = [
    'diann_report_parquet',
    'diann_report_qc',
    'alphadia_precursors',
    'alphadia_pg_matrix',
    'mzqc',
    'spectronaut_report',
    'maxquant_protein_groups',
    'fragpipe_combined_protein',
    'quantms_qpx',
    'msstats_comparison',
    'deqms_result',
    'deseq2_results',
    'curvecurator',
    'mageck_gene_summary',
  ];
  for (const key of keys) expect(IMPORTERS[key], key).toBeDefined();
});

describe('DS-06: DIA-NN main report', () => {
  const report = () =>
    parquet(
      'report.parquet',
      `SELECT * FROM read_csv('${join(TOOLS, 'diann/report.tsv')}', delim = '\t', header = true)`,
    );

  it('DS-06: diann_report_parquet golden — precursors from report.parquet', async () => {
    const result = await runImport(conn, 'diann_report_parquet', await report(), ctx());
    expect(result.kind).toBe('precursor_quant');
    expect(result.row_count).toBe(lines(join(TOOLS, 'diann/report.tsv')).length - 1);
    const rows = await golden('diann_report_parquet', result);
    expect(rows[0]).toMatchObject({ sample_key: expect.stringMatching(/^TOOLS-S0\d$/), charge: 2 });
  });

  it('DS-06: diann_report_qc counts precursors and protein groups per run; status only with a threshold', async () => {
    const path = await report();
    const result = await runImport(conn, 'diann_report_qc', path, ctx());
    expect(result.kind).toBe('qc_metrics');
    const rows = await golden('diann_report_qc', result);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['not_assessed']));
    const judged = await canonicalRows(
      conn,
      await runImport(conn, 'diann_report_qc', path, ctx({ options: { min_precursors: 18 } })),
    );
    const precursors = judged.filter((r) => r.metric === 'precursors');
    expect(
      precursors.every((r) => r.threshold === 18 && (r.status === 'pass') === (r.value as number) >= 18),
    ).toBe(true);
  });
});

describe('DS-06: AlphaDIA', () => {
  it('DS-06: alphadia_precursors golden', async () => {
    const result = await runImport(
      conn,
      'alphadia_precursors',
      join(TOOLS, 'alphadia/precursors.tsv'),
      ctx(),
    );
    const rows = await golden('alphadia_precursors', result);
    expect(rows.every((r) => r.retention_time === null)).toBe(true);
  });
  it('DS-06: alphadia_pg_matrix golden', async () => {
    const result = await runImport(conn, 'alphadia_pg_matrix', join(TOOLS, 'alphadia/pg.matrix.tsv'), ctx());
    expect(result.row_count).toBe(20 * 4);
    await golden('alphadia_pg_matrix', result);
  });
});

describe('DS-06: mzQC', () => {
  it('DS-06: mzqc golden — numeric run metrics; non-numeric values counted, not imported', async () => {
    const result = await runImport(conn, 'mzqc', join(TOOLS, 'mzqc/runs.mzqc.json'), ctx());
    expect(result.kind).toBe('qc_metrics');
    const rows = await golden('mzqc', result);
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => String(r.metric).startsWith('chromatography duration'))).toMatchObject({
      unit: 'minute',
      scope: 'run',
    });
    expect(JSON.stringify(result.transformations)).toMatch(/4 non-numeric/);
  });
  it('DS-06: mzqc rejects a file that is not mzQC', async () => {
    await expect(runImport(conn, 'mzqc', write('x.mzqc.json', '{"hello": 1}'), ctx())).rejects.toThrow(
      /mzQC/,
    );
  });
});

describe('DS-06: Spectronaut', () => {
  it('DS-06: spectronaut_report golden — one row per protein group and run', async () => {
    const result = await runImport(conn, 'spectronaut_report', join(TOOLS, 'spectronaut/report.tsv'), ctx());
    expect(warnings(result).map((w) => w.rule_id)).not.toContain('condition_matches_manifest');
    await golden('spectronaut_report', result);
  });
  it('DS-06: spectronaut_report reads a decimal-comma export identically', async () => {
    const text = lines(join(TOOLS, 'spectronaut/report.tsv'))
      .map((l, i) => (i === 0 ? l : l.replace(/(\d)\.(\d)/g, '$1,$2')))
      .join('\n');
    await golden(
      'spectronaut_report',
      await runImport(conn, 'spectronaut_report', write('sn.tsv', text), ctx()),
    );
  });
  it('DS-06: spectronaut_report warns when R.Condition disagrees with the manifest', async () => {
    const text = readFileSync(join(TOOLS, 'spectronaut/report.tsv'), 'utf8').replaceAll(
      '\tDMSO\t',
      '\tvehicle\t',
    );
    const result = await runImport(conn, 'spectronaut_report', write('sn2.tsv', text), ctx());
    expect(warnings(result).map((w) => w.rule_id)).toContain('condition_matches_manifest');
  });
});

describe('DS-06: MaxQuant', () => {
  const path = join(TOOLS, 'maxquant/proteinGroups.txt');
  it('DS-06: maxquant_protein_groups golden — flagged rows removed and counted', async () => {
    const result = await runImport(conn, 'maxquant_protein_groups', path, ctx());
    expect(result.row_count).toBe(20 * 4);
    expect(warnings(result).find((w) => w.rule_id === 'flagged_rows_removed')?.failing_rows).toBe(2);
    await golden('maxquant_protein_groups', result);
  });
  it('DS-06: maxquant_protein_groups keeps flagged rows on request', async () => {
    const result = await runImport(
      conn,
      'maxquant_protein_groups',
      path,
      ctx({ options: { keep_flagged: true } }),
    );
    expect(result.row_count).toBe(22 * 4);
  });
  it('DS-06: maxquant_protein_groups accepts the older "Contaminant" column name', async () => {
    const text = readFileSync(path, 'utf8').replace('\tPotential contaminant\t', '\tContaminant\t');
    const result = await runImport(conn, 'maxquant_protein_groups', write('pg-old.txt', text), ctx());
    await golden('maxquant_protein_groups', result);
  });
});

describe('DS-06: FragPipe', () => {
  const path = join(TOOLS, 'fragpipe/combined_protein.tsv');
  it('DS-06: fragpipe_combined_protein golden — MaxLFQ intensities', async () => {
    const result = await runImport(conn, 'fragpipe_combined_protein', path, ctx());
    expect(JSON.stringify(result.transformations)).toMatch(/MaxLFQ Intensity/);
    await golden('fragpipe_combined_protein', result);
  });
  it('DS-06: fragpipe_combined_protein falls back to top-N Intensity without MaxLFQ columns', async () => {
    const [header, ...rows] = lines(path).map((l) => l.split('\t'));
    const keep = header!.map((h, i) => (h.endsWith('MaxLFQ Intensity') ? -1 : i)).filter((i) => i >= 0);
    const text = [header!, ...rows].map((r) => keep.map((i) => r[i]).join('\t')).join('\n');
    const result = await runImport(conn, 'fragpipe_combined_protein', write('fp.tsv', text), ctx());
    expect(errors(result)).toEqual([]);
    expect(JSON.stringify(result.transformations)).toMatch(/top-N/);
  });
});

describe('DS-06: quantms QPX', () => {
  const pg = (grouped: string) =>
    parquet(
      `pg-${grouped.length}.parquet`,
      `SELECT pg_id::BIGINT AS pg_id, string_split(pg_accessions, ';') AS pg_accessions, string_split(gg_names, ';') AS gg_names,
         anchor_protein, ${grouped} AS grouped_runs, global_qvalue::DOUBLE AS global_qvalue, pg_qvalue::DOUBLE AS pg_qvalue,
         label, intensity::FLOAT AS intensity, is_decoy::BOOLEAN AS is_decoy, contaminant::BOOLEAN AS contaminant
       FROM read_csv('${join(TOOLS, 'qpx/pg.tsv')}', delim = '\t', header = true, all_varchar = true)`,
    );
  it('DS-06: quantms_qpx golden — list columns from Parquet', async () => {
    const result = await runImport(conn, 'quantms_qpx', await pg('[grouped_runs]'), ctx());
    expect(result.row_count).toBe(80);
    await golden('quantms_qpx', result);
  });
  it('DS-06: quantms_qpx rejects fractionated units', async () => {
    const result = await runImport(conn, 'quantms_qpx', await pg("[grouped_runs, 'fraction2.raw']"), ctx());
    expect(errors(result)).toContain('single_run_unit');
  });
});

describe('DS-06: differential tables', () => {
  it('DS-06: msstats_comparison golden — labels matched to registered contrasts, NA reasons, percentages', async () => {
    const result = await runImport(
      conn,
      'msstats_comparison',
      join(TOOLS, 'msstats/comparison.csv'),
      ctx({ contrasts: [CONTRAST] }),
    );
    const rows = await golden('msstats_comparison', result);
    const missing = rows.find((r) => r.issue === 'oneConditionMissing')!;
    expect(missing).toMatchObject({
      log2_fc: 'Infinity',
      p_value: null,
      na_reason: 'MSstats: one condition missing',
      contrast_id: CONTRAST.id,
    });
    expect(rows[0]!.adj_method).toBe('BH');
    expect(Math.max(...rows.map((r) => r.missing_pct as number))).toBeGreaterThan(1);
  });
  it('DS-06: msstats_comparison rejects a label that is not a registered contrast', async () => {
    const result = await runImport(
      conn,
      'msstats_comparison',
      join(TOOLS, 'msstats/comparison.csv'),
      ctx({ contrasts: [{ ...CONTRAST, label: 'other' }] }),
    );
    expect(errors(result)).toContain('contrast_in_registry');
  });
  it('DS-06: msstats_comparison reads the log base from the header (log10FC) and rejects a contradicting option', async () => {
    const path = join(TOOLS, 'msstats/comparison.csv');
    const base2 = await canonicalRows(
      conn,
      await runImport(conn, 'msstats_comparison', path, ctx({ contrasts: [CONTRAST] })),
    );
    const log10 = write('log10.csv', readFileSync(path, 'utf8').replace('"log2FC"', '"log10FC"'));
    const result = await runImport(conn, 'msstats_comparison', log10, ctx({ contrasts: [CONTRAST] }));
    const base10 = await canonicalRows(conn, result);
    expect(base10[0]!.log2_fc as number).toBeCloseTo((base2[0]!.log2_fc as number) * Math.log2(10), 9);
    expect(result.transformations.map((t) => t.step)).toContain('log_base');
    await expect(
      runImport(conn, 'msstats_comparison', path, ctx({ contrasts: [CONTRAST], options: { log_base: 10 } })),
    ).rejects.toThrow(/contradicts/);
  });
  it('DS-06: deqms_result golden — sca.* statistics', async () => {
    const result = await runImport(
      conn,
      'deqms_result',
      join(TOOLS, 'deqms/deqms.tsv'),
      ctx({ contrast: CONTRAST }),
    );
    const rows = await golden('deqms_result', result);
    const first = lines(join(TOOLS, 'deqms/deqms.tsv'))[1]!.split('\t');
    expect(rows.find((r) => r.feature_id === first[6])).toMatchObject({
      method: 'DEqMS',
      t_stat: Number(first[8]),
      p_value: Number(first[9]),
      adj_p_value: Number(first[10]),
    });
  });
  it('DS-06: deseq2_results golden — NA p-values carry the documented reason', async () => {
    const result = await runImport(
      conn,
      'deseq2_results',
      join(TOOLS, 'deseq2/results.csv'),
      ctx({ contrast: CONTRAST }),
    );
    const rows = await golden('deseq2_results', result);
    const reason = (id: string) => rows.find((r) => r.feature_id === id)!.na_reason;
    expect(reason('ENSG00000100000')).toBe('DESeq2: all counts zero');
    expect(reason('ENSG00000100001')).toBe("DESeq2: count outlier (Cook's distance)");
    expect(reason('ENSG00000100002')).toBe('DESeq2: removed by independent filtering');
    expect(rows.every((r) => r.feature_type === 'gene')).toBe(true);
  });
});

describe('DS-06: dose response and CRISPR', () => {
  const curves = join(FIXTURES, 'experiments/ONC-DIA-01/curves.txt');
  const doses = {
    compound_id: 'CPD-000001',
    doses: [0, 1, 10, 100, 1000, 10000],
    dose_scale: 1e-9,
    dose_unit: 'M',
  };
  it('DS-06: curvecurator golden — doses in molar, EC50 from pEC50, unclassified curves marked unclear', async () => {
    const result = await runImport(conn, 'curvecurator', curves, ctx({ options: doses }));
    const rows = await golden('curvecurator', result);
    const fitted = rows.find((r) => r.pec50 !== null)!;
    expect(fitted.ec50_molar as number).toBeCloseTo(10 ** -(fitted.pec50 as number), 15);
    expect(fitted.doses_molar).toEqual([0, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5]);
    expect(fitted.n_doses).toBe(5);
    expect(new Set(rows.map((r) => r.regulation))).toContain('not');
  });
  it('DS-06: curvecurator needs doses in molar', async () => {
    await expect(
      runImport(conn, 'curvecurator', curves, ctx({ options: { ...doses, dose_unit: 'g/L' } })),
    ).rejects.toThrow(/molar|dose_unit/i);
    await expect(
      runImport(conn, 'curvecurator', curves, ctx({ options: { compound_id: 'CPD-000001' } })),
    ).rejects.toThrow(/doses/);
  });
  it('DS-06: mageck_gene_summary golden', async () => {
    const path = join(FIXTURES, 'experiments/ONC-CRI-11/gene_summary.txt');
    const result = await runImport(conn, 'mageck_gene_summary', path, ctx());
    expect(result.kind).toBe('crispr_gene_summary');
    expect(result.row_count).toBe(lines(path).length - 1);
    await golden('mageck_gene_summary', result);
  });
});
