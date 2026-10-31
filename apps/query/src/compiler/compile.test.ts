import { DATASET_CONTRACTS, type QuerySpec } from '@tributary/contracts';
import { describe, expect, it } from 'vitest';
import { CompileError, compileQuery, type Sources } from './index.ts';

const scope = { programIds: ['019a2b3c-4d5e-7f00-8a00-000000000001'] };
const da = { contract: DATASET_CONTRACTS.differential_abundance, files: ['/cache/a.parquet'] };
const sources = (joins: Sources['joins'] = []): Sources => ({ source: da, joins });
const base: QuerySpec = { source: { kind: 'differential_abundance', scope } };

const compileError = (spec: unknown, s = sources()) => {
  try {
    compileQuery(spec, s);
  } catch (error) {
    if (error instanceof CompileError) return `${error.field}:${error.code}`;
    throw error;
  }
  return 'compiled';
};

describe('QuerySpec compiler', () => {
  it('QRY-01: nested AND/OR groups and NOT compile to parameterized SQL', () => {
    const compiled = compileQuery(
      {
        ...base,
        where: {
          combinator: 'and',
          rules: [
            { field: 'gene_names', operator: 'contains', value: 'CDK1' },
            {
              combinator: 'or',
              rules: [
                { field: 'adj_p_value', operator: '<', value: 0.05 },
                {
                  combinator: 'and',
                  not: true,
                  rules: [{ field: 'log2_fc', operator: 'between', value: [-1, 1] }],
                },
              ],
            },
          ],
        },
      },
      sources(),
    );
    expect(compiled.sql).toMatch(/list_contains\(/);
    expect(compiled.sql).toMatch(/NOT \(/);
    expect(compiled.sql).toMatch(/ OR /);
    expect(compiled.sql).not.toMatch(/CDK1|0\.05/);
    expect(Object.values(compiled.params)).toEqual(expect.arrayContaining(['CDK1', 0.05, -1, 1]));
    expect(compiled.sqlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('QRY-01: every operator compiles for its column type, values always as parameters', () => {
    const rules = [
      { field: 'feature_id', operator: '=', value: 'P1' },
      { field: 'feature_id', operator: '!=', value: 'P1' },
      { field: 'feature_id', operator: 'contains', value: 'P' },
      { field: 'feature_id', operator: 'doesNotContain', value: 'P' },
      { field: 'feature_id', operator: 'beginsWith', value: 'P' },
      { field: 'feature_id', operator: 'endsWith', value: '1' },
      { field: 'feature_id', operator: 'in', value: ['P1', 'P2'] },
      { field: 'feature_id', operator: 'notIn', value: ['P3'] },
      { field: 'log2_fc', operator: '<', value: 1 },
      { field: 'log2_fc', operator: '<=', value: 1 },
      { field: 'log2_fc', operator: '>', value: 1 },
      { field: 'log2_fc', operator: '>=', value: 1 },
      { field: 'log2_fc', operator: 'notBetween', value: [-1, 1] },
      { field: 'p_value', operator: 'null' },
      { field: 'p_value', operator: 'notNull' },
      { field: 'protein_ids', operator: 'doesNotContain', value: 'P9' },
    ];
    const compiled = compileQuery({ ...base, where: { combinator: 'and', rules } }, sources());
    expect(Object.keys(compiled.params).length).toBeGreaterThanOrEqual(16);
    expect(compiled.sql).toMatch(/IS NULL/);
    expect(compiled.sql).toMatch(/IS NOT NULL/);
    expect(compiled.sql).toMatch(/NOT BETWEEN/);
    expect(compiled.sql).toMatch(/starts_with\(/);
    expect(compiled.sql).toMatch(/ends_with\(/);
  });

  it('QRY-01: an operator that does not fit the column type is rejected', () => {
    expect(
      compileError({
        ...base,
        where: { combinator: 'and', rules: [{ field: 'log2_fc', operator: 'contains', value: 'x' }] },
      }),
    ).toBe('where.rules.0.operator:invalid_operator');
  });

  it('QRY-03: injection attempts in values stay parameters', () => {
    const evil = "x'); DROP TABLE dataset_release; --";
    const compiled = compileQuery(
      { ...base, where: { combinator: 'and', rules: [{ field: 'feature_id', operator: '=', value: evil }] } },
      sources(),
    );
    expect(compiled.sql).not.toMatch(/DROP/);
    expect(Object.values(compiled.params)).toContain(evil);
  });

  it('QRY-03: injection attempts in column names, operators, aliases and order are rejected', () => {
    const rule = (field: string, operator = '=') => ({
      ...base,
      where: { combinator: 'and', rules: [{ field, operator, value: 'x' }] },
    });
    expect(compileError(rule('feature_id" OR 1=1 --'))).toMatch(/:invalid_spec$/);
    expect(compileError(rule('feature_id', '= 1 OR 1=1 --'))).toMatch(/:invalid_spec$/);
    expect(compileError(rule('not_a_column'))).toBe('where.rules.0.field:unknown_column');
    expect(compileError({ ...base, select: ['feature_id; DROP TABLE x'] })).toMatch(/:invalid_spec$/);
    expect(compileError({ ...base, orderBy: [{ column: 'log2_fc', dir: 'asc; DROP' }] })).toMatch(
      /:invalid_spec$/,
    );
    expect(compileError({ ...base, sql: 'select 1' })).toMatch(/:invalid_spec$/);
    const join = {
      type: 'left',
      target: { kind: 'compound', scope },
      alias: 'c"; DROP',
      on: [{ left: 'experiment_version_id', op: '=', right: 'c.compound_id' }],
    };
    expect(
      compileError(
        { ...base, joins: [join] },
        sources([{ contract: DATASET_CONTRACTS.compound, files: [] }]),
      ),
    ).toMatch(/:invalid_spec$/);
  });

  it('QRY-02: a per-join filter is compiled inside the joined subquery', () => {
    const compiled = compileQuery(
      {
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
      },
      {
        source: { contract: DATASET_CONTRACTS.dose_response, files: ['/cache/d.parquet'] },
        joins: [{ contract: DATASET_CONTRACTS.compound, files: ['/cache/c.parquet'] }],
      },
    );
    // The filter sits in the joined CTE, not in the outer WHERE (which would turn the LEFT join into an inner one).
    const outer = compiled.sql.slice(compiled.sql.lastIndexOf('LEFT JOIN'));
    expect(outer).not.toMatch(/starts_with/);
    expect(compiled.sql).toMatch(/starts_with\("name"/);
    expect(compiled.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['compound_id', 'cpd.name']));
  });
});
