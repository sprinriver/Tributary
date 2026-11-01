import { DATASET_CONTRACTS, QuerySpecSchema } from '@tributary/contracts';
import { describe, expect, it } from 'vitest';
import { pythonCode, rCode } from './codegen.ts';
import {
  columnType,
  decodeSpec,
  emptyRules,
  encodeSpec,
  fieldsOf,
  fromRuleGroup,
  toRuleGroup,
} from './spec.ts';

const da = DATASET_CONTRACTS.differential_abundance;
const typeOf = (f: string) => columnType(da, f);

describe('explorer spec helpers', () => {
  it('EXP-02: builder rules become typed QuerySpec rules (numbers, lists, no builder-only keys)', () => {
    const group = toRuleGroup(
      {
        combinator: 'and',
        not: true,
        rules: [
          { id: 'r1', field: 'adj_p_value', operator: '<', value: '0.05', valueSource: 'value' },
          { field: 'log2_fc', operator: 'between', value: ['-1', '1'] },
          { field: 'feature_id', operator: 'in', value: 'P1, P2' },
          { field: 'p_value', operator: 'null', value: '' },
          { combinator: 'or', rules: [{ field: 'gene_names', operator: 'contains', value: 'CDK1' }] },
        ],
      },
      typeOf,
    );
    expect(group).toEqual({
      combinator: 'and',
      not: true,
      rules: [
        { field: 'adj_p_value', operator: '<', value: 0.05 },
        { field: 'log2_fc', operator: 'between', value: [-1, 1] },
        { field: 'feature_id', operator: 'in', value: ['P1', 'P2'] },
        { field: 'p_value', operator: 'null' },
        { combinator: 'or', rules: [{ field: 'gene_names', operator: 'contains', value: 'CDK1' }] },
      ],
    });
    expect(toRuleGroup(fromRuleGroup(group), typeOf)).toEqual(group);
  });

  it('EXP-02: operators offered per column type follow the contract matrix', () => {
    const fields = Object.fromEntries(
      fieldsOf(da).map((f) => [f.name, (f.operators as { name: string }[]).map((o) => o.name)]),
    );
    expect(fields.log2_fc).toContain('between');
    expect(fields.log2_fc).not.toContain('contains');
    expect(fields.gene_names).toEqual(['contains', 'doesNotContain', 'null', 'notNull']);
  });

  it('EXP-02: empty values are counted so the page can ask for them', () => {
    expect(
      emptyRules({
        combinator: 'and',
        rules: [
          { field: 'adj_p_value', operator: '<', value: '' },
          { field: 'p_value', operator: 'null', value: '' },
          { combinator: 'or', rules: [{ field: 'log2_fc', operator: 'between', value: ['1', ''] }] },
        ],
      }),
    ).toBe(2);
  });

  it('EXP-04: URL state round-trips (unicode included)', () => {
    const spec = QuerySpecSchema.parse({
      source: { kind: 'sample', scope: {} },
      where: { combinator: 'and', rules: [{ field: 'condition', operator: '=', value: 'CPD-000005@1 µM' }] },
    });
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
    expect(decodeSpec('not base64 ¿')).toBeUndefined();
  });

  it('EXP-05: Python and R snippets post the spec to /v1/query with a bearer token', () => {
    const spec = QuerySpecSchema.parse({ source: { kind: 'sample', scope: {} }, select: ['sample_key'] });
    const py = pythonCode(spec, 'https://tributary.example/api');
    expect(py).toContain('requests.post(f"{API}/v1/query"');
    expect(py).toContain('"sample_key"');
    expect(py).toContain("os.environ['TRIBUTARY_TOKEN']");
    const r = rCode(spec, 'https://tributary.example/api');
    expect(r).toContain('httr2::request(paste0(api, "/v1/query"))');
    expect(r).toContain('req_auth_bearer_token');
  });
});
