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
});
