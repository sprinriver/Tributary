import type { DatasetColumn, Rule, RuleGroup } from '@tributary/contracts';
import { DUCKDB_TYPE } from './types.ts';

/** Collects parameter values; SQL text only ever contains `$pN` placeholders for user values. */
export class Params {
  readonly values: Record<string, string | number | boolean> = {};
  #next = 0;
  add(value: unknown, column: DatasetColumn): string {
    const name = `p${this.#next++}`;
    this.values[name] = value as string | number | boolean;
    // Dates and timestamps arrive as ISO strings (validated); cast them to the column type.
    return column.type === 'date' || column.type === 'timestamp'
      ? `CAST($${name} AS ${DUCKDB_TYPE[column.type]})`
      : `$${name}`;
  }
}

/** Resolves a rule's field to its SQL expression and contract column (already validated). */
export type ColumnLookup = (field: string) => { sql: string; column: DatasetColumn };

// Negations keep rows whose value is NULL ("not X" includes "unknown"): SQL's three-valued logic would drop
// them silently, e.g. `NOT (adj_p_value < 0.05)` losing every NA p-value with its na_reason.
function rule(r: Rule, lookup: ColumnLookup, params: Params): string {
  const { sql: c, column } = lookup(r.field);
  const list = column.type === 'text[]' || column.type === 'double[]';
  // A list column's elements have the element type (same date/timestamp handling does not apply).
  const element: DatasetColumn = list
    ? { ...column, type: column.type === 'text[]' ? 'text' : 'double' }
    : column;
  const p = (v: unknown) => params.add(v, element);
  const pair = () => {
    const [a, b] = r.value as unknown[];
    return `${p(a)} AND ${p(b)}`;
  };
  switch (r.operator) {
    case '=':
      return `${c} = ${p(r.value)}`;
    case '!=':
      return `${c} IS DISTINCT FROM ${p(r.value)}`;
    case '<':
    case '<=':
    case '>':
    case '>=':
      return `${c} ${r.operator} ${p(r.value)}`;
    case 'contains':
      return list ? `list_contains(${c}, ${p(r.value)})` : `contains(${c}, ${p(r.value)})`;
    case 'doesNotContain':
      return `coalesce(NOT ${list ? 'list_contains' : 'contains'}(${c}, ${p(r.value)}), true)`;
    case 'beginsWith':
      return `starts_with(${c}, ${p(r.value)})`;
    case 'endsWith':
      return `ends_with(${c}, ${p(r.value)})`;
    case 'in':
      return `${c} IN (${(r.value as unknown[]).map(p).join(', ')})`;
    case 'notIn':
      return `coalesce(${c} NOT IN (${(r.value as unknown[]).map(p).join(', ')}), true)`;
    case 'between':
      return `${c} BETWEEN ${pair()}`;
    case 'notBetween':
      return `coalesce(${c} NOT BETWEEN ${pair()}, true)`;
    case 'null':
      return `${c} IS NULL`;
    case 'notNull':
      return `${c} IS NOT NULL`;
  }
}

/** react-querybuilder group → SQL boolean expression; an empty group is TRUE. */
export function group(g: RuleGroup, lookup: ColumnLookup, params: Params): string {
  const parts = g.rules.map((r) => ('combinator' in r ? group(r, lookup, params) : rule(r, lookup, params)));
  const body = parts.length
    ? parts.map((x) => `(${x})`).join(g.combinator === 'or' ? ' OR ' : ' AND ')
    : 'TRUE';
  return g.not ? `coalesce(NOT (${body}), true)` : body;
}
