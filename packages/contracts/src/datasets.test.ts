import { describe, expect, it } from 'vitest';
import { DATASET_CONTRACTS, DATASET_KINDS, DECLARED_JOIN_KEYS } from './index.ts';

describe('dataset contract registry', () => {
  it('CON-03: every SPEC §6.2 kind has a contract', () => {
    expect([...DATASET_KINDS].sort()).toEqual(
      [
        'protein_quant',
        'precursor_quant',
        'differential_abundance',
        'dose_response',
        'thermal_shift',
        'ptm_site_quant',
        'qc_metrics',
        'rnaseq_counts',
        'crispr_gene_summary',
        'compound',
        'compound_property',
        'target_annotation',
        'id_mapping',
        'experiment_version',
        'sample',
        'file_object',
        'pipeline_run',
      ].sort(),
    );
    for (const kind of DATASET_KINDS) expect(DATASET_CONTRACTS[kind].kind).toBe(kind);
  });

  it('CON-03: column names are unique and join keys refer to real columns', () => {
    for (const kind of DATASET_KINDS) {
      const contract = DATASET_CONTRACTS[kind];
      const names = contract.columns.map((c) => c.name);
      expect(new Set(names).size, kind).toBe(names.length);
      for (const key of contract.joinKeys) {
        expect(names, `${kind}.${key}`).toContain(key);
        expect(DECLARED_JOIN_KEYS).toContain(key);
      }
      for (const rule of contract.qualityRules) {
        for (const column of rule.columns) expect(names, `${kind} rule ${rule.id}`).toContain(column);
      }
    }
  });

  it('CON-03: experiment-scoped kinds carry experiment_version_id; reference kinds do not', () => {
    for (const kind of DATASET_KINDS) {
      const contract = DATASET_CONTRACTS[kind];
      const has = contract.columns.some((c) => c.name === 'experiment_version_id');
      if (contract.category === 'experiment') expect(has, kind).toBe(true);
      if (contract.category === 'reference') expect(has, kind).toBe(false);
    }
  });

  it('CON-03: differential_abundance p-values must lie in (0, 1]', () => {
    const rule = DATASET_CONTRACTS.differential_abundance.qualityRules.find((r) => r.id === 'p_value_range');
    expect(rule).toMatchObject({
      kind: 'range',
      columns: ['p_value'],
      min: 0,
      minInclusive: false,
      max: 1,
      maxInclusive: true,
    });
  });

  it('TPP-02: thermal_shift holds one protein × comparison with melting points in °C and ΔTm = treatment − vehicle', () => {
    const contract = DATASET_CONTRACTS.thermal_shift;
    expect(contract.category).toBe('experiment');
    const column = (name: string) => contract.columns.find((c) => c.name === name);
    for (const name of ['melt_point_treatment', 'melt_point_vehicle', 'delta_tm'])
      expect(column(name), name).toMatchObject({ type: 'double', nullable: true, unit: '°C' });
    expect(column('delta_tm')!.description).toMatch(/treatment − vehicle/);
    expect(column('temperatures_c')).toMatchObject({ type: 'double[]', unit: '°C' });
    expect(column('adj_p_value')).toMatchObject({ nullable: true });
    expect(column('p_value')).toBeUndefined(); // the tool reports no unadjusted p-value
    expect(contract.qualityRules.map((r) => r.id)).toContain('adj_p_value_range');
    expect(contract.joinKeys).toEqual(expect.arrayContaining(['experiment_version_id', 'compound_id']));
  });

  it('PTM-02: ptm_site_quant holds one site × sample × multiplicity with the tool’s localisation probability', () => {
    const contract = DATASET_CONTRACTS.ptm_site_quant;
    expect(contract.category).toBe('experiment');
    const column = (name: string) => contract.columns.find((c) => c.name === name);
    expect(column('site_id')).toMatchObject({ type: 'text', nullable: false });
    expect(column('site_id')!.description).toMatch(/<protein>_<residue><position>/);
    expect(column('position')).toMatchObject({ type: 'integer', nullable: false });
    expect(column('amino_acid')).toMatchObject({ type: 'text' });
    expect(column('modification')).toMatchObject({ type: 'text', nullable: false });
    expect(column('multiplicity')).toMatchObject({ type: 'integer', nullable: true });
    expect(column('localization_prob')).toMatchObject({ type: 'double', nullable: true });
    expect(column('intensity')).toMatchObject({ type: 'double', nullable: true });
    expect(column('positions_in_proteins')).toMatchObject({ type: 'text[]' });
    const rules = contract.qualityRules.map((r) => r.id);
    expect(rules).toEqual(
      expect.arrayContaining([
        'localization_prob_range',
        'intensity_non_negative',
        'one_row_per_sample_site',
      ]),
    );
    expect(contract.joinKeys).toEqual(
      expect.arrayContaining(['experiment_version_id', 'sample_key', 'protein_ids', 'gene_names']),
    );
  });

  it('PTM-02: ptm_site_quant keeps the identification type per sample; probability rules cite what they check', () => {
    const contract = DATASET_CONTRACTS.ptm_site_quant;
    expect(contract.columns.find((c) => c.name === 'identification_type')).toMatchObject({
      type: 'text',
      nullable: true,
    });
    for (const id of ['localization_prob_range', 'localization_prob_sample_range', 'pep_range']) {
      const rule = contract.qualityRules.find((r) => r.id === id)!;
      expect(rule.source, id).not.toMatch(/q-value/);
    }
    expect(contract.columns.find((c) => c.name === 'localization_prob')!.description).toMatch(
      /over all samples/,
    );
  });
});
