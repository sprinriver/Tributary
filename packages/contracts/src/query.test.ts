import { describe, expect, it } from 'vitest';
import { QuerySpecSchema, resolveContractByKind, validateQuerySpec, type QuerySpec } from './index.ts';

const scope = { programIds: ['019a2b3c-4d5e-7f00-8a00-000000000001'] };
const codes = (spec: QuerySpec) =>
  validateQuerySpec(spec, resolveContractByKind).map((e) => `${e.field}:${e.code}`);

describe('QuerySpec validation against dataset contracts', () => {
  it('CON-03: a valid spec with a filtered left join passes', () => {
    const spec = QuerySpecSchema.parse({
      source: { kind: 'dose_response', scope },
      joins: [
        {
          type: 'left',
          target: { kind: 'compound', scope },
          alias: 'cpd',
          on: [{ left: 'compound_id', op: '=', right: 'cpd.compound_id' }],
          where: { combinator: 'and', rules: [{ field: 'name', operator: 'beginsWith', value: 'CPD' }] },
        },
      ],
      where: {
        combinator: 'and',
        rules: [
          { field: 'pec50', operator: '>=', value: 6 },
          {
            combinator: 'or',
            not: true,
            rules: [{ field: 'regulation', operator: 'in', value: ['up', 'down'] }],
          },
        ],
      },
      select: ['feature_id', 'pec50', 'cpd.name'],
      orderBy: [{ column: 'pec50', dir: 'desc' }],
      page: { size: 25 },
    });
    expect(validateQuerySpec(spec, resolveContractByKind)).toEqual([]);
  });

  it('CON-03: an unknown column is rejected with its field path', () => {
    expect(
      codes({
        source: { kind: 'differential_abundance', scope },
        where: { combinator: 'and', rules: [{ field: 'drop_table', operator: '=', value: 1 }] },
      }),
    ).toEqual(['where.rules.0.field:unknown_column']);
  });

  it('CON-03: an operator invalid for the column type is rejected', () => {
    expect(
      codes({
        source: { kind: 'differential_abundance', scope },
        where: {
          combinator: 'and',
          rules: [
            { field: 'log2_fc', operator: 'beginsWith', value: '1' },
            { combinator: 'or', rules: [{ field: 'contrast_label', operator: '>', value: 'a' }] },
          ],
        },
      }),
    ).toEqual(['where.rules.0.operator:invalid_operator', 'where.rules.1.rules.0.operator:invalid_operator']);
  });

  it('CON-03: a value of the wrong type is rejected', () => {
    expect(
      codes({
        source: { kind: 'differential_abundance', scope },
        where: {
          combinator: 'and',
          rules: [
            { field: 'p_value', operator: '<', value: 'small' },
            { field: 'log2_fc', operator: 'between', value: [1] },
            { field: 'adj_p_value', operator: 'notNull' },
          ],
        },
      }),
    ).toEqual(['where.rules.0.value:invalid_value', 'where.rules.1.value:invalid_value']);
  });

  it('CON-03: join, select and orderBy columns are checked against the right contract', () => {
    expect(
      codes({
        source: { kind: 'dose_response', scope },
        joins: [
          {
            type: 'inner',
            target: { kind: 'compound', scope },
            alias: 'cpd',
            on: [{ left: 'compound_id', op: '=', right: 'cpd.not_a_column' }],
            where: { combinator: 'and', rules: [{ field: 'pec50', operator: '>', value: 5 }] },
          },
        ],
        select: ['cpd.smiles', 'nope.x', 'unknown'],
        orderBy: [{ column: 'cpd.ghost', dir: 'asc' }],
      }),
    ).toEqual([
      'joins.0.on.0.right:unknown_column',
      'joins.0.where.rules.0.field:unknown_column',
      'select.1:unknown_alias',
      'select.2:unknown_column',
      'orderBy.0.column:unknown_column',
    ]);
  });

  it('CON-03: explode is only allowed on a list column the source has', () => {
    expect(
      codes({
        source: { kind: 'qc_metrics', scope },
        joins: [
          {
            type: 'inner',
            target: { kind: 'id_mapping', scope },
            alias: 'map',
            on: [{ left: 'scope_key', op: '=', right: 'map.uniprot_accession' }],
            explode: 'protein_ids',
          },
        ],
      }),
    ).toEqual(['joins.0.explode:unknown_column']);
  });

  it('CON-03: duplicate join aliases are rejected', () => {
    const join = {
      type: 'left' as const,
      target: { kind: 'compound' as const, scope },
      alias: 'cpd',
      on: [{ left: 'compound_id', op: '=' as const, right: 'cpd.compound_id' }],
    };
    expect(codes({ source: { kind: 'dose_response', scope }, joins: [join, join] })).toEqual([
      'joins.1.alias:duplicate_alias',
    ]);
  });

  it('CON-03: the schema rejects raw SQL fields, bad page sizes and unknown kinds', () => {
    expect(
      QuerySpecSchema.safeParse({ source: { kind: 'protein_quant', scope }, sql: 'select 1' }).success,
    ).toBe(false);
    expect(
      QuerySpecSchema.safeParse({ source: { kind: 'protein_quant', scope }, page: { size: 30 } }).success,
    ).toBe(false);
    expect(QuerySpecSchema.safeParse({ source: { kind: 'users', scope } }).success).toBe(false);
  });

  it('CON-03: a release-id source needs a resolver that knows the release', () => {
    expect(codes({ source: { releaseIds: ['019a2b3c-4d5e-7f00-8a00-000000000002'] } })).toEqual([
      'source:unknown_source',
    ]);
  });
});
