import {
  DATASET_CONTRACTS,
  type ColumnType,
  type DatasetColumn,
  type DatasetContract,
} from './datasets/index.ts';
import type { ContractError } from './errors.ts';
import type { Operator, QuerySpec, Rule, RuleGroup, SourceRef } from './query.ts';

/** Finds the contract for a source; release-id sources need the API's release lookup. */
export type ContractResolver = (source: SourceRef) => DatasetContract | undefined;

export const resolveContractByKind: ContractResolver = (source) =>
  'kind' in source ? DATASET_CONTRACTS[source.kind] : undefined;

type TypeClass = 'text' | 'numeric' | 'temporal' | 'boolean' | 'list' | 'json';
const TYPE_CLASS: Record<ColumnType, TypeClass> = {
  text: 'text',
  uuid: 'text',
  double: 'numeric',
  integer: 'numeric',
  date: 'temporal',
  timestamp: 'temporal',
  boolean: 'boolean',
  'text[]': 'list',
  'double[]': 'list',
  json: 'json',
};

/** Operator × type matrix (CON-03). On list columns `contains` means "has this element". */
export const OPERATORS_BY_TYPE: Record<TypeClass, readonly Operator[]> = {
  text: ['=', '!=', 'contains', 'doesNotContain', 'beginsWith', 'endsWith', 'in', 'notIn', 'null', 'notNull'],
  numeric: ['=', '!=', '<', '<=', '>', '>=', 'between', 'notBetween', 'in', 'notIn', 'null', 'notNull'],
  temporal: ['=', '!=', '<', '<=', '>', '>=', 'between', 'notBetween', 'null', 'notNull'],
  boolean: ['=', '!=', 'null', 'notNull'],
  list: ['contains', 'doesNotContain', 'null', 'notNull'],
  json: ['null', 'notNull'],
};

function scalarFits(column: DatasetColumn, value: unknown): boolean {
  switch (column.type) {
    case 'double':
    case 'double[]':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case 'timestamp':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'json':
      return false;
    default:
      return typeof value === 'string';
  }
}

function valueFits(column: DatasetColumn, operator: Operator, value: unknown): boolean {
  switch (operator) {
    case 'null':
    case 'notNull':
      return value === undefined || value === null;
    case 'in':
    case 'notIn':
      return Array.isArray(value) && value.length > 0 && value.every((v) => scalarFits(column, v));
    case 'between':
    case 'notBetween':
      return Array.isArray(value) && value.length === 2 && value.every((v) => scalarFits(column, v));
    default:
      return scalarFits(column, value);
  }
}

/** Columns visible in one place of the spec: `bare` resolves bare names, `aliases` resolves `alias.column`. */
interface Scope {
  bare: DatasetContract;
  aliases: Map<string, DatasetContract>;
}

export function validateQuerySpec(spec: QuerySpec, resolve: ContractResolver): ContractError[] {
  const errors: ContractError[] = [];
  const fail = (field: string, code: string, message: string) => errors.push({ code, field, message });

  const base = resolve(spec.source);
  if (!base) {
    fail('source', 'unknown_source', 'The source dataset is unknown or not visible to you.');
    return errors;
  }
  const aliases = new Map<string, DatasetContract>();

  const column = (ref: string, scope: Scope, field: string): DatasetColumn | undefined => {
    const [aliasOrColumn, maybeColumn] = ref.split('.');
    const contract = maybeColumn === undefined ? scope.bare : scope.aliases.get(aliasOrColumn ?? '');
    const name = maybeColumn ?? aliasOrColumn;
    if (!contract) {
      fail(field, 'unknown_alias', `No joined table is called "${aliasOrColumn}".`);
      return undefined;
    }
    const found = contract.columns.find((c) => c.name === name);
    if (!found) fail(field, 'unknown_column', `"${ref}" is not a column of ${contract.kind}.`);
    return found;
  };

  const checkRule = (rule: Rule, scope: Scope, path: string) => {
    const found = column(rule.field, scope, `${path}.field`);
    if (!found) return;
    const allowed = OPERATORS_BY_TYPE[TYPE_CLASS[found.type]];
    if (!allowed.includes(rule.operator)) {
      fail(
        `${path}.operator`,
        'invalid_operator',
        `"${rule.operator}" cannot be used on ${found.type} column "${rule.field}".`,
      );
    } else if (!valueFits(found, rule.operator, rule.value)) {
      fail(
        `${path}.value`,
        'invalid_value',
        `The value does not fit "${rule.operator}" on ${found.type} column "${rule.field}".`,
      );
    }
  };

  const checkGroup = (group: RuleGroup, scope: Scope, path: string) => {
    group.rules.forEach((rule, i) => {
      if ('combinator' in rule) checkGroup(rule, scope, `${path}.rules.${i}`);
      else checkRule(rule, scope, `${path}.rules.${i}`);
    });
  };

  spec.joins?.forEach((join, i) => {
    const path = `joins.${i}`;
    if (aliases.has(join.alias))
      fail(`${path}.alias`, 'duplicate_alias', `Alias "${join.alias}" is used twice.`);
    const target = resolve(join.target);
    if (!target) {
      fail(`${path}.target`, 'unknown_source', 'The joined dataset is unknown or not visible to you.');
      return;
    }
    if (join.explode && !base.columns.some((c) => c.name === join.explode)) {
      fail(`${path}.explode`, 'unknown_column', `${base.kind} has no "${join.explode}" column to explode.`);
    }
    const onScope: Scope = { bare: base, aliases: new Map([...aliases, [join.alias, target]]) };
    join.on.forEach((condition, j) => {
      column(condition.left, onScope, `${path}.on.${j}.left`);
      column(condition.right, onScope, `${path}.on.${j}.right`);
    });
    if (join.where) checkGroup(join.where, { bare: target, aliases: new Map() }, `${path}.where`);
    aliases.set(join.alias, target);
  });

  const mainScope: Scope = { bare: base, aliases };
  if (spec.where) checkGroup(spec.where, mainScope, 'where');
  spec.select?.forEach((ref, i) => column(ref, mainScope, `select.${i}`));
  spec.orderBy?.forEach((order, i) => column(order.column, mainScope, `orderBy.${i}.column`));
  return errors;
}
