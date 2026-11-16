import { describe, expect, it } from 'vitest';
import { calls, shape, type Json } from './shape-testing.ts';

describe('MA plot, PCA and QC panel', () => {
  it('VIZ-07: MA plot — hits by |M| and adjusted p, labels', async () => {
    const enc = { x: 'b', y: 'a', z: 'd', label: 'id' };
    const base = await shape('ma', enc, { fc_threshold: 3 });
    expect(base.data.map((t: Json) => t.name)).toEqual(['Up (2)', 'Down (0)', 'Not significant (4)']);
    expect((await shape('ma', enc, { fc_threshold: 3, p_threshold: 0.5 })).data[0].name).toBe('Up (3)');
    expect((await shape('ma', { x: 'b', y: 'a' }, { fc_threshold: 3 })).data[0].name).toBe('Up (4)');
    expect((await shape('ma', enc, { fc_threshold: 3, label_top: 1 })).layout.annotations).toHaveLength(1);
    expect((await shape('ma', enc, { webgl: false })).data[0].type).toBe('scatter');
  });

  it('VIZ-07: PCA — scores with variance explained; chosen components; scale reaches compute', async () => {
    calls.length = 0;
    const enc = { rowLabel: 'id', values: ['a', 'b', 'c'], color: 'g' };
    const base = await shape('pca', enc);
    expect(base.layout.xaxis.title.text).toBe('PC1 (50.0%)');
    expect(base.layout.yaxis.title.text).toBe('PC2 (25.0%)');
    expect(base.data).toHaveLength(2);
    const pc3 = await shape('pca', enc, { components: 3, pc_y: 3 });
    expect(pc3.layout.yaxis.title.text).toBe('PC3 (16.7%)');
    await shape('pca', enc, { scale: true });
    expect(calls.filter((c) => c.path === 'pca').map((c) => c.body.scale)).toEqual([false, false, true]);
    // Long data: rows of one sample pivot to one observation; features with missing values are dropped and reported.
    const longRows = ['r1', 'r2', 'r3'].flatMap((run, i) =>
      ['F1', 'F2', 'F3'].flatMap((f, j) =>
        f === 'F3' && run !== 'r1' ? [] : [{ run, f, v: i * 3 + j + 1 }],
      ),
    );
    const long = await shape('pca', { rowLabel: 'run', x: 'f', values: 'v' }, {}, longRows);
    expect(long.transformations.join(' ')).toMatch(/1 feature\(s\) with missing values left out/);
    expect(calls.at(-1)!.body.values).toEqual([
      [1, 2],
      [4, 5],
      [7, 8],
    ]);
  });

  it('VIZ-08: QC panel — IDs per run, completeness, CVs, intensity distributions; panels toggle', async () => {
    const enc = { x: 'run', rowLabel: 'id', values: 'b', color: 'cond' };
    const base = await shape('qc_panel', enc);
    const names = (s: Json) => s.data.map((t: Json) => t.name);
    expect(names(base)).toEqual(
      expect.arrayContaining(['IDs per run', 'Missing values (%)', 'CV (%)', 'log2 intensity']),
    );
    const ids = base.data.find((t: Json) => t.name === 'IDs per run');
    expect(ids.x).toEqual(['r1', 'r2', 'r3']);
    expect(ids.y).toEqual([2, 2, 2]);
    expect(names(await shape('qc_panel', enc, { show_cv: false }))).not.toContain('CV (%)');
    expect(names(await shape('qc_panel', enc, { show_ids: false, show_completeness: false }))).toEqual([
      'CV (%)',
      'log2 intensity',
    ]);
    const raw = await shape('qc_panel', enc, { log2: false });
    expect(raw.data.find((t: Json) => t.name === 'intensity').y).toContain(59);
  });

  it('QCD-04: runs not in the sample sheet get their own labelled box and a note, never "all runs"', async () => {
    const joined = ['F1', 'F2'].flatMap((id, f) =>
      [
        ['r1', 'DMSO'],
        ['r2', 'DMSO'],
        ['r3', null],
        ['r4', null],
      ].map(([run, condition], i) => ({ id, run, b: 100 * (f + 1) + 10 * i, 's.condition': condition })),
    );
    const s = await shape(
      'qc_panel',
      { x: 'run', rowLabel: 'id', values: 'b', color: 's.condition' },
      {},
      joined,
    );
    const cv = s.data.find((t: Json) => t.name === 'CV (%)');
    expect(new Set(cv.x)).toEqual(new Set(['DMSO', 'not in the sample sheet']));
    expect(s.transformations.join(' ')).toContain('2 run(s) not in the sample sheet');
  });

  it('QCD-04: the CV note counts feature–condition pairs without a CV and names conditions with none', async () => {
    const joined = ['F1', 'F2'].flatMap((id, f) =>
      [
        ['r1', 'DMSO'],
        ['r2', 'DMSO'],
        ['r3', 'CPD'],
      ].map(([run, condition], i) => ({ id, run, b: 100 * (f + 1) + 10 * i, 's.condition': condition })),
    );
    const s = await shape(
      'qc_panel',
      { x: 'run', rowLabel: 'id', values: 'b', color: 's.condition' },
      {},
      joined,
    );
    const note = s.transformations.join(' ');
    expect(note).toContain('2 feature–condition pair(s) with < 2 quantified values have no CV');
    expect(note).toContain('no CV for: CPD');
  });

  it('QCD-04: imputed values count as not quantified (IDs, missing values, CVs) and are counted in a note', async () => {
    const data = ['F1', 'F2'].flatMap((id, f) =>
      ['r1', 'r2'].map((run, i) => ({
        id,
        run,
        b: 100 * (f + 1) + 10 * i,
        is_imputed: id === 'F2' && run === 'r2',
      })),
    );
    const s = await shape('qc_panel', { x: 'run', rowLabel: 'id', values: 'b' }, {}, data);
    expect(s.data.find((t: Json) => t.name === 'IDs per run').y).toEqual([2, 1]);
    expect(s.transformations.join(' ')).toContain('1 imputed value(s) counted as not quantified');
  });

  it('QCD-04: CVs per condition from a joined sample sheet; the note names the column without the join alias', async () => {
    // Two features measured in two replicate runs of each condition.
    const joined = ['F1', 'F2'].flatMap((id, f) =>
      [
        ['r1', 'DMSO'],
        ['r2', 'DMSO'],
        ['r3', 'CPD'],
        ['r4', 'CPD'],
      ].map(([run, condition], i) => ({ id, run, b: 100 * (f + 1) + 10 * i, 's.condition': condition })),
    );
    const s = await shape(
      'qc_panel',
      { x: 'run', rowLabel: 'id', values: 'b', color: 's.condition' },
      {},
      joined,
    );
    const cv = s.data.find((t: Json) => t.name === 'CV (%)');
    expect(new Set(cv.x)).toEqual(new Set(['DMSO', 'CPD']));
    expect(s.transformations.join(' ')).toContain('per feature within condition;');
  });
});
