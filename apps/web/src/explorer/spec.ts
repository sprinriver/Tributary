import {
  DATASET_CONTRACTS,
  OPERATORS_BY_TYPE,
  type ColumnType,
  type DatasetContract,
  type DatasetKind,
  type QuerySpec,
  type Rule,
  type RuleGroup,
} from '@tributary/contracts';
import type { Field, RuleGroupType, RuleType } from 'react-querybuilder';

/** Operator labels shown in the filter builder (QuerySpec keeps react-querybuilder's names). */
const OPERATOR_LABEL: Record<string, string> = {
  '=': '=',
  '!=': '≠',
  '<': '<',
  '<=': '≤',
  '>': '>',
  '>=': '≥',
  contains: 'contains',
  doesNotContain: 'does not contain',
  beginsWith: 'starts with',
  endsWith: 'ends with',
  in: 'in (comma-separated)',
  notIn: 'not in (comma-separated)',
  between: 'between',
  notBetween: 'not between',
  null: 'is empty',
  notNull: 'is not empty',
};

const TYPE_CLASS = (t: ColumnType) =>
  t === 'double' || t === 'integer'
    ? 'numeric'
    : t === 'date' || t === 'timestamp'
      ? 'temporal'
      : t === 'boolean'
        ? 'boolean'
        : t.endsWith('[]')
          ? 'list'
          : t === 'json'
            ? 'json'
            : 'text';

/** react-querybuilder fields for a contract, with the operators its type allows (CON-03 matrix). */
export function fieldsOf(contract: DatasetContract, prefix = ''): Field[] {
  return contract.columns.map((c) => ({
    name: `${prefix}${c.name}`,
    label: `${prefix}${c.name}`,
    operators: OPERATORS_BY_TYPE[TYPE_CLASS(c.type)].map((name) => ({
      name,
      label: OPERATOR_LABEL[name] ?? name,
    })),
    inputType: TYPE_CLASS(c.type) === 'numeric' ? 'number' : c.type === 'date' ? 'date' : 'text',
    ...(c.type === 'boolean' ? { valueEditorType: 'checkbox' as const } : {}),
  }));
}

export const emptyGroup = (): RuleGroupType => ({ combinator: 'and', rules: [] });

/** Builder value → QuerySpec value: numbers for numeric columns, arrays for in/between. */
function coerce(type: ColumnType, operator: string, value: unknown): unknown {
  if (operator === 'null' || operator === 'notNull') return undefined;
  const one = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : v;
    if (TYPE_CLASS(type) === 'numeric') return s === '' ? s : Number(s);
    if (type === 'boolean') return s === true || s === 'true';
    return s;
  };
  if (['in', 'notIn', 'between', 'notBetween'].includes(operator)) {
    const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
    return parts.map(one);
  }
  return one(value);
}

/** react-querybuilder group → QuerySpec RuleGroup (strips builder-only keys such as valueSource). */
export function toRuleGroup(
  group: RuleGroupType,
  typeOf: (field: string) => ColumnType | undefined,
): RuleGroup {
  return {
    combinator: group.combinator === 'or' ? 'or' : 'and',
    ...(group.not ? { not: true } : {}),
    rules: group.rules.flatMap((r): (Rule | RuleGroup)[] => {
      if (typeof r === 'string') return [];
      if ('rules' in r) return [toRuleGroup(r, typeOf)];
      const rule = r as RuleType;
      const value = coerce(typeOf(rule.field) ?? 'text', rule.operator, rule.value);
      return [
        {
          field: rule.field,
          operator: rule.operator as Rule['operator'],
          ...(value === undefined ? {} : { value }),
        },
      ];
    }),
  };
}

/** QuerySpec RuleGroup → builder group (values back to the strings the editors show). */
export function fromRuleGroup(group: RuleGroup | undefined): RuleGroupType {
  if (!group) return emptyGroup();
  return {
    combinator: group.combinator,
    ...(group.not ? { not: true } : {}),
    rules: group.rules.map((r) =>
      'combinator' in r
        ? fromRuleGroup(r)
        : {
            field: r.field,
            operator: r.operator,
            value: Array.isArray(r.value) ? r.value.join(',') : (r.value ?? ''),
          },
    ),
  };
}

export const contractOf = (kind: DatasetKind) => DATASET_CONTRACTS[kind];

/** Kind of a spec's source when known in the browser (release-id sources carry it in the UI state). */
export function columnType(contract: DatasetContract, field: string): ColumnType | undefined {
  return contract.columns.find((c) => c.name === field)?.type;
}

/** URL state: the QuerySpec as base64url JSON. */
export function encodeSpec(spec: QuerySpec): string {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeSpec(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

/** Rules whose value is still empty (null/notNull need none); the explorer asks for them before running. */
export function emptyRules(group: RuleGroupType): number {
  return group.rules.reduce((n, r) => {
    if (typeof r === 'string') return n;
    if ('rules' in r) return n + emptyRules(r);
    if (r.operator === 'null' || r.operator === 'notNull') return n;
    const parts = Array.isArray(r.value) ? r.value : [r.value];
    return n + (parts.length === 0 || parts.some((v) => v === undefined || String(v).trim() === '') ? 1 : 0);
  }, 0);
}
