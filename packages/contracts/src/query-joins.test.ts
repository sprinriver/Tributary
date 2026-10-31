import { describe, expect, it } from 'vitest';
import { checkJoinKeys, QuerySpecSchema, resolveContractByKind, type QuerySpec } from './index.ts';

const scope = { programIds: ['019a2b3c-4d5e-7f00-8a00-000000000001'] };
const codes = (spec: QuerySpec, advancedAllowed = false) =>
  checkJoinKeys(QuerySpecSchema.parse(spec), resolveContractByKind, { advancedAllowed }).map(
    (e) => `${e.field}:${e.code}`,
  );

describe('declared join keys and advanced mode', () => {
  it('QRY-02: joins on declared keys with = pass', () => {
    expect(
      codes({
        source: { kind: 'differential_abundance', scope },
        joins: [
          {
            type: 'left',
            target: { kind: 'sample', scope },
            alias: 's',
            on: [{ left: 'experiment_version_id', op: '=', right: 's.experiment_version_id' }],
          },
          {
            type: 'inner',
            target: { kind: 'target_annotation', scope },
            alias: 'ta',
            on: [{ left: 'protein_ids', op: '=', right: 'ta.uniprot_accession' }],
            explode: 'protein_ids',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('QRY-02: a key the contract does not declare, or another operator, needs advanced mode', () => {
    const spec: QuerySpec = {
      source: { kind: 'differential_abundance', scope },
      joins: [
        {
          type: 'inner',
          target: { kind: 'sample', scope },
          alias: 's',
          on: [
            { left: 'contrast_label', op: '=', right: 's.condition' },
            { left: 'experiment_version_id', op: '!=', right: 's.experiment_version_id' },
          ],
        },
      ],
    };
    expect(codes(spec)).toEqual([
      'joins.0.on.0.left:not_join_key',
      'joins.0.on.0.right:not_join_key',
      'joins.0.on.1.op:advanced_required',
    ]);
    const advanced = { ...spec, joins: spec.joins!.map((j) => ({ ...j, advanced: true })) };
    expect(codes(advanced)).toEqual(['joins.0.advanced:advanced_forbidden']);
    expect(codes(advanced, true)).toEqual([]);
  });

  it('QRY-02: only one explode per query', () => {
    const join = (alias: string) => ({
      type: 'inner' as const,
      target: { kind: 'target_annotation' as const, scope },
      alias,
      on: [{ left: 'protein_ids', op: '=' as const, right: `${alias}.uniprot_accession` }],
      explode: 'protein_ids' as const,
    });
    expect(
      codes({ source: { kind: 'differential_abundance', scope }, joins: [join('a'), join('b')] }),
    ).toEqual(['joins.1.explode:one_explode']);
  });
});
