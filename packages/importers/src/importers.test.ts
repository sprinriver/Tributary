import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  canonicalRows,
  detectImporters,
  IMPORTERS,
  rowsHash,
  runImport,
  type ImportContext,
} from './index.ts';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');
const GOLDEN = JSON.parse(readFileSync(resolve(import.meta.dirname, 'golden.json'), 'utf8')) as Record<
  string,
  string
>;
const EV = '0190a000-0000-7000-8000-0000000000e1';
const PROGRAM = '0190a000-0000-7000-8000-0000000000a1';
const CONTRAST = { id: '0190a000-0000-7000-8000-0000000000c1', label: 'CPD-000005@1 µM vs DMSO' };
const tmp = mkdtempSync(join(tmpdir(), 'importers-'));

/** Runs from a manifest TSV (sample_key, instrument_run, raw_file). */
function runsOf(manifest: string): NonNullable<ImportContext['runs']> {
  const [header, ...lines] = readFileSync(manifest, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((line) => {
    const cells = line.split('\t');
    const get = (name: string) => cells[cols.indexOf(name)] ?? null;
    return {
      sample_key: get('sample_key')!,
      instrument_run: get('instrument_run'),
      raw_file: get('raw_file'),
    };
  });
}
const write = (name: string, text: string) => {
  const path = join(tmp, name);
  writeFileSync(path, text);
  return path;
};
const failedRules = (r: { failures: { rule_id: string; severity: string }[] }) =>
  r.failures.filter((f) => f.severity === 'error').map((f) => f.rule_id);

let conn: DuckDBConnection;
beforeAll(async () => {
  conn = await (await DuckDBInstance.create(':memory:')).connect();
});
afterAll(() => conn.closeSync());

const PG = join(FIXTURES, 'experiments/ONC-DIA-01/report.pg_matrix.tsv');
const PG_RUNS = runsOf(join(FIXTURES, 'experiments/ONC-DIA-01/samples.tsv'));
const TOPTABLE = join(FIXTURES, 'experiments/ONC-DIA-05/toptable.tsv');

describe('importer registry', () => {
  it('DS-01: every importer targets a contract kind and declares its tool', () => {
    expect(Object.keys(IMPORTERS)).toEqual(
      expect.arrayContaining(['diann_pg_matrix', 'limma_toptable', 'custom_tabular']),
    );
    for (const importer of Object.values(IMPORTERS)) {
      expect(importer.kind).toBeTruthy();
      expect(importer.tool).toBeTruthy();
    }
  });

  it('DS-01: detection suggests the importer from the header', async () => {
    expect(await detectImporters(conn, PG)).toContain('diann_pg_matrix');
    expect(await detectImporters(conn, TOPTABLE)).toContain('limma_toptable');
    expect(await detectImporters(conn, PG)).not.toContain('limma_toptable');
  });
});

describe('DS-02: diann_pg_matrix', () => {
  const ctx = { experimentVersionId: EV, programId: PROGRAM, runs: PG_RUNS };

  it('DS-02: diann_pg_matrix golden — melts the wide matrix to protein_quant, keeping empty cells as nulls', async () => {
    const result = await runImport(conn, 'diann_pg_matrix', PG, ctx);
    expect(failedRules(result)).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.kind).toBe('protein_quant');
    // Every protein group × 12 runs, nothing dropped.
    const groups = readFileSync(PG, 'utf8').trim().split('\n').length - 1;
    expect(result.row_count).toBe(groups * 12);
    const rows = await canonicalRows(conn, result);
    const p53 = rows.find((r) => r.protein_group === 'P04637' && r.instrument_run === 'ONC-DIA-01_run01');
    expect(p53).toMatchObject({
      experiment_version_id: EV,
      sample_key: 'ONC-DIA-01-S01',
      protein_ids: ['P04637'],
      gene_names: ['TP53'],
      intensity: 4026427.8,
      is_imputed: false,
      q_value: null,
    });
    expect(p53!.log2_intensity).toBeCloseTo(Math.log2(4026427.8), 10);
    const missing = rows.filter((r) => r.intensity === null);
    expect(missing.length).toBeGreaterThan(0);
    for (const r of missing) expect(r.log2_intensity).toBeNull();
    expect(result.transformations.map((t) => t.step)).toEqual(
      expect.arrayContaining(['melt', 'map_runs', 'split', 'derive']),
    );
    expect(result.source.original_columns.slice(0, 4)).toEqual([
      'Protein.Group',
      'Protein.Names',
      'Genes',
      'First.Protein.Description',
    ]);
    expect(rowsHash(rows)).toBe(GOLDEN.diann_pg_matrix);
  });

  it('DS-02: diann_pg_matrix accepts the Protein.Ids annotation column (header variant)', async () => {
    const [header, ...lines] = readFileSync(PG, 'utf8').trim().split('\n');
    const cols = header!.split('\t');
    const withIds = [
      ['Protein.Group', 'Protein.Ids', ...cols.slice(1)].join('\t'),
      ...lines.map((l) => {
        const cells = l.split('\t');
        return [cells[0], cells[0], ...cells.slice(1)].join('\t');
      }),
    ].join('\n');
    const result = await runImport(conn, 'diann_pg_matrix', write('ids.pg_matrix.tsv', withIds), ctx);
    expect(result.passed).toBe(true);
    expect(rowsHash(await canonicalRows(conn, result))).toBe(GOLDEN.diann_pg_matrix);
  });

  it('DS-02: diann_pg_matrix rejects a run missing from the manifest and a negative intensity, naming the rules', async () => {
    const text = readFileSync(PG, 'utf8').replace('\t4026427.8\t', '\t-5\t');
    const result = await runImport(conn, 'diann_pg_matrix', write('broken.pg_matrix.tsv', text), {
      ...ctx,
      runs: PG_RUNS.slice(1),
    });
    expect(result.passed).toBe(false);
    expect(failedRules(result)).toEqual(
      expect.arrayContaining(['run_in_manifest', 'intensity_non_negative']),
    );
    const run = result.failures.find((f) => f.rule_id === 'run_in_manifest')!;
    expect(run.message).toMatch(/ONC-DIA-01_run01/);
    expect(run.source).toBeTruthy();
  });

  it('DS-02: diann_pg_matrix rejects a non-numeric quantity naming the column', async () => {
    const text = readFileSync(PG, 'utf8').replace('\t4026427.8\t', '\tabc\t');
    const result = await runImport(conn, 'diann_pg_matrix', write('nan.pg_matrix.tsv', text), ctx);
    expect(failedRules(result)).toContain('intensity_numeric');
  });
});

describe('DS-03: limma_toptable', () => {
  const ctx = { experimentVersionId: EV, programId: PROGRAM, contrast: CONTRAST };

  it('DS-03: limma_toptable golden — maps topTable columns to differential_abundance', async () => {
    const result = await runImport(conn, 'limma_toptable', TOPTABLE, ctx);
    expect(failedRules(result)).toEqual([]);
    expect(result.kind).toBe('differential_abundance');
    const rows = await canonicalRows(conn, result);
    expect(rows).toHaveLength(readFileSync(TOPTABLE, 'utf8').trim().split('\n').length - 1);
    const first = readFileSync(TOPTABLE, 'utf8').split('\n')[1]!.split('\t');
    const row = rows.find((r) => r.feature_id === first[0])!;
    expect(row).toMatchObject({
      contrast_id: CONTRAST.id,
      contrast_label: CONTRAST.label,
      feature_type: 'protein_group',
      protein_ids: first[0]!.split(';'),
      gene_names: first[1]!.split(';'),
      log2_fc: Number(first[2]),
      ci_low: Number(first[3]),
      ci_high: Number(first[4]),
      avg_log2_abundance: Number(first[5]),
      t_stat: Number(first[6]),
      p_value: Number(first[7]),
      adj_p_value: Number(first[8]),
      adj_method: 'BH',
      method: 'limma',
      se: null,
    });
    expect(row.source_columns).toMatchObject({ log2_fc: 'logFC', adj_p_value: 'adj.P.Val' });
    expect(rowsHash(rows)).toBe(GOLDEN.limma_toptable);
  });

  it('DS-03: limma_toptable reads a decimal-comma export identically', async () => {
    const text = readFileSync(TOPTABLE, 'utf8')
      .split('\n')
      .map((line, i) => (i === 0 ? line : line.replace(/(\d)\.(\d)/g, '$1,$2')))
      .join('\n');
    const result = await runImport(conn, 'limma_toptable', write('comma.toptable.tsv', text), ctx);
    expect(failedRules(result)).toEqual([]);
    expect(result.source.decimal).toBe(',');
    expect(result.transformations.map((t) => t.step)).toContain('decimal_comma');
    expect(rowsHash(await canonicalRows(conn, result))).toBe(GOLDEN.limma_toptable);
  });

  it('DS-03: limma_toptable rejects p-values outside (0, 1] naming the rule', async () => {
    const lines = readFileSync(TOPTABLE, 'utf8').trim().split('\n');
    const cells = lines[1]!.split('\t');
    cells[7] = '1.5';
    lines[1] = cells.join('\t');
    const zero = lines[2]!.split('\t');
    zero[7] = '0';
    lines[2] = zero.join('\t');
    const result = await runImport(conn, 'limma_toptable', write('badp.toptable.tsv', lines.join('\n')), ctx);
    expect(result.passed).toBe(false);
    const failure = result.failures.find((f) => f.rule_id === 'p_value_range')!;
    expect(failure.failing_rows).toBe(2);
    expect(failure.source).toMatch(/Science conventions/);
  });

  it('DS-03: limma_toptable requires a contrast', async () => {
    await expect(
      runImport(conn, 'limma_toptable', TOPTABLE, { experimentVersionId: EV, programId: PROGRAM }),
    ).rejects.toThrow(/contrast/i);
  });
});

describe('DS-04: custom_tabular and reference imports', () => {
  it('DS-04: custom_tabular maps arbitrary columns to a kind with a saved mapping', async () => {
    const path = write(
      'custom.csv',
      'Accession,Sample,Run,Abundance\nP1;P2,S1,r1,10.5\nP3,S1,r1,\nP1;P2,S2,r2,7\n',
    );
    const result = await runImport(conn, 'custom_tabular', path, {
      experimentVersionId: EV,
      programId: PROGRAM,
      options: {
        kind: 'protein_quant',
        columns: {
          protein_group: 'Accession',
          sample_key: 'Sample',
          instrument_run: 'Run',
          intensity: 'Abundance',
        },
        constants: { is_imputed: 'false' },
      },
    });
    expect(failedRules(result)).toEqual([]);
    const rows = await canonicalRows(conn, result);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      protein_group: 'P1;P2',
      protein_ids: ['P1', 'P2'],
      intensity: 10.5,
      gene_names: [],
    });
    expect(result.source.mapping).toMatchObject({ intensity: 'Abundance' });
  });

  it('DS-04: custom_tabular names unmapped required columns', async () => {
    const path = write('custom2.csv', 'Accession,Abundance\nP1,1\n');
    await expect(
      runImport(conn, 'custom_tabular', path, {
        experimentVersionId: EV,
        programId: PROGRAM,
        options: { kind: 'protein_quant', columns: { protein_group: 'Accession', intensity: 'Abundance' } },
      }),
    ).rejects.toThrow(/sample_key/);
  });

  it('DS-04: reference imports — compounds, compound properties and target annotations from the fixtures', async () => {
    const compounds = await runImport(conn, 'reference_compound', join(FIXTURES, 'reference/compounds.tsv'), {
      programId: PROGRAM,
    });
    expect(failedRules(compounds)).toEqual([]);
    expect(compounds.row_count).toBe(8);
    const props = await runImport(
      conn,
      'reference_compound_property',
      join(FIXTURES, 'reference/compound_properties.tsv'),
      { programId: PROGRAM },
    );
    expect(failedRules(props)).toEqual([]);
    expect(props.row_count).toBe(32);
    const targets = await runImport(
      conn,
      'reference_target_annotation',
      join(FIXTURES, 'reference/target_annotations.tsv'),
      { programId: PROGRAM },
    );
    expect(failedRules(targets)).toEqual([]);
    expect(targets.row_count).toBe(34);
    expect(rowsHash(await canonicalRows(conn, props))).toBe(GOLDEN.reference_compound_property);
  });

  it('DS-04: a compound property with an unknown qualifier is rejected naming the rule', async () => {
    const text = readFileSync(join(FIXTURES, 'reference/compound_properties.tsv'), 'utf8').replace(
      '\t=\t',
      '\t~\t',
    );
    const result = await runImport(conn, 'reference_compound_property', write('props.tsv', text), {
      programId: PROGRAM,
    });
    expect(failedRules(result)).toContain('qualifier_values');
  });

  it('DS-04: id_mapping is versioned by its source release', async () => {
    const path = write(
      'idmap.tsv',
      'uniprot_accession\tgene_symbol\tensembl_gene_id\nP04637\tTP53\tENSG00000141510\nP00533\tEGFR\tENSG00000146648\n',
    );
    await expect(
      runImport(conn, 'reference_id_mapping', path, {
        programId: PROGRAM,
        options: { species: 'NCBITaxon:9606' },
      }),
    ).rejects.toThrow(/source_release/);
    const result = await runImport(conn, 'reference_id_mapping', path, {
      programId: PROGRAM,
      options: { species: 'NCBITaxon:9606', source: 'UniProt', source_release: '2026_04' },
    });
    expect(failedRules(result)).toEqual([]);
    expect((await canonicalRows(conn, result))[0]).toMatchObject({
      source: 'UniProt',
      source_release: '2026_04',
    });
  });
});

describe('DS-01: quality rules and column stats', () => {
  it('DS-01: column stats per canonical column', async () => {
    const result = await runImport(conn, 'diann_pg_matrix', PG, {
      experimentVersionId: EV,
      programId: PROGRAM,
      runs: PG_RUNS,
    });
    const intensity = result.column_stats.intensity!;
    expect(intensity.null_count).toBeGreaterThan(0);
    expect(intensity.min).toBeGreaterThan(0);
    expect(result.column_stats.sample_key!.distinct_count).toBe(12);
  });
});

describe('review fixes (omics-reviewer, Phase 8)', () => {
  it('DS-04: custom_tabular never rounds a non-integral integer value', async () => {
    const path = write(
      'charge.csv',
      'run,precursor,seq,charge,group\nr1,p1,PEPTIDE,2.7,P1\nr1,p2,PEPTIDES,2,P1\n',
    );
    const result = await runImport(conn, 'custom_tabular', path, {
      experimentVersionId: EV,
      programId: PROGRAM,
      options: {
        kind: 'precursor_quant',
        columns: {
          instrument_run: 'run',
          sample_key: 'run',
          precursor_id: 'precursor',
          modified_sequence: 'seq',
          charge: 'charge',
          protein_group: 'group',
        },
      },
    });
    expect(failedRules(result)).toContain('charge_numeric');
  });

  it('DS-02: diann_pg_matrix maps runs by the file name of a raw_file URI and rejects ambiguous runs', async () => {
    const byUri = PG_RUNS.map((r) => ({
      ...r,
      instrument_run: null,
      raw_file: `s3://raw/ONC-DIA-01/${r.raw_file}`,
    }));
    const ok = await runImport(conn, 'diann_pg_matrix', PG, {
      experimentVersionId: EV,
      programId: PROGRAM,
      runs: byUri,
    });
    expect(failedRules(ok)).toEqual([]);
    const twice = [...PG_RUNS, { ...PG_RUNS[0]!, sample_key: 'DUPLICATE' }];
    const ambiguous = await runImport(conn, 'diann_pg_matrix', PG, {
      experimentVersionId: EV,
      programId: PROGRAM,
      runs: twice,
    });
    expect(failedRules(ambiguous)).toContain('run_ambiguous');
  });

  it('DS-03: limma_toptable refuses a table without identifiers instead of using a statistic as the ID', async () => {
    const lines = readFileSync(TOPTABLE, 'utf8').trim().split('\n');
    const noId = lines.map((l) => l.split('\t').slice(2).join('\t')).join('\n');
    await expect(
      runImport(conn, 'limma_toptable', write('noid.toptable.tsv', noId), {
        experimentVersionId: EV,
        programId: PROGRAM,
        contrast: CONTRAST,
      }),
    ).rejects.toThrow(/identifier/);
  });
});
