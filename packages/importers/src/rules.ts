import type { DatasetContract, QualityRule } from '@tributary/contracts';
import type { DuckDBConnection } from '@duckdb/node-api';
import { ident, literal } from './sql.ts';
import type { ImporterRule, RuleFailure } from './types.ts';

// Quality rules from the dataset contract compiled to SQL assertions (SPEC §6.2): each assertion selects the failing
// rows; zero rows means the rule holds.

interface Assertion {
  id: string;
  severity: 'error' | 'warn';
  source: string;
  /** Selects one text column `example` per failing row (or per failing group for unique rules). */
  sql: string;
  /** For unique rules the failing row count is the sum of group sizes. */
  countSql?: string;
  message: (count: number, examples: string[]) => string;
}

const fmt = (examples: string[]) => (examples.length ? ` (e.g. ${examples.join(', ')})` : '');

function rangeCondition(rule: Extract<QualityRule, { kind: 'range' }>, column: string): string {
  const parts: string[] = [];
  if (rule.min !== undefined) parts.push(`${column} ${rule.minInclusive ? '<' : '<='} ${rule.min}`);
  if (rule.max !== undefined) parts.push(`${column} ${rule.maxInclusive ? '>' : '>='} ${rule.max}`);
  // NaN is never inside a range.
  parts.push(`isnan(${column})`);
  return parts.join(' OR ');
}

function rangeText(rule: Extract<QualityRule, { kind: 'range' }>): string {
  const low = rule.min === undefined ? '' : `${rule.minInclusive ? '≥' : '>'} ${rule.min}`;
  const high = rule.max === undefined ? '' : `${rule.maxInclusive ? '≤' : '<'} ${rule.max}`;
  return [low, high].filter(Boolean).join(' and ');
}

export function contractAssertions(contract: DatasetContract, canon: string): Assertion[] {
  const out: Assertion[] = [];
  for (const column of contract.columns.filter((c) => !c.nullable)) {
    out.push({
      id: `${column.name}_not_null`,
      severity: 'error',
      source: `Dataset contract ${contract.kind} ${contract.version}: column is required`,
      sql: `SELECT '(row ' || rowid || ')' AS example FROM ${canon} WHERE ${ident(column.name)} IS NULL`,
      message: (n) => `${column.name} is required but empty in ${n} row(s).`,
    });
  }
  for (const rule of contract.qualityRules) {
    const columns = rule.columns.map(ident);
    if (rule.kind === 'range') {
      const c = columns[0]!;
      out.push({
        id: rule.id,
        severity: rule.severity,
        source: rule.source,
        sql: `SELECT CAST(${c} AS VARCHAR) AS example FROM ${canon} WHERE ${c} IS NOT NULL AND (${rangeCondition(rule, c)})`,
        message: (n, ex) => `${rule.columns[0]} must be ${rangeText(rule)}: ${n} row(s) fail${fmt(ex)}.`,
      });
    } else if (rule.kind === 'enum') {
      const c = columns[0]!;
      out.push({
        id: rule.id,
        severity: rule.severity,
        source: rule.source,
        sql: `SELECT CAST(${c} AS VARCHAR) AS example FROM ${canon} WHERE ${c} IS NOT NULL AND ${c} NOT IN (${rule.values.map(literal).join(', ')})`,
        message: (n, ex) =>
          `${rule.columns[0]} must be one of ${rule.values.join(', ')}: ${n} row(s) fail${fmt(ex)}.`,
      });
    } else {
      const key = columns.join(', ');
      const groups = `SELECT ${key}, count(*) AS n FROM ${canon} GROUP BY ${key} HAVING count(*) > 1`;
      out.push({
        id: rule.id,
        severity: rule.severity,
        source: rule.source,
        sql: `SELECT concat_ws(' / ', ${columns.map((c) => `CAST(${c} AS VARCHAR)`).join(', ')}) AS example FROM (${groups})`,
        countSql: `SELECT coalesce(sum(n), 0) AS n FROM (${groups})`,
        message: (n, ex) =>
          `Rows must be unique on ${rule.columns.join(', ')}: ${n} row(s) are duplicates${fmt(ex)}.`,
      });
    }
  }
  return out;
}

/** Typed columns whose source text did not parse (`__raw_<column>` set, typed value NULL). */
export function parseAssertions(
  contract: DatasetContract,
  work: string,
  rawColumns: Set<string>,
): Assertion[] {
  return contract.columns
    .filter((c) => rawColumns.has(`__raw_${c.name}`))
    .map((c) => {
      const numeric = c.type === 'double' || c.type === 'integer';
      const raw = ident(`__raw_${c.name}`);
      return {
        id: `${c.name}_${numeric ? 'numeric' : 'type'}`,
        severity: 'error' as const,
        source: `Dataset contract ${contract.kind} ${contract.version}: ${c.name} is ${c.type}`,
        sql: `SELECT ${raw} AS example FROM ${work} WHERE ${raw} IS NOT NULL AND ${ident(c.name)} IS NULL`,
        message: (n: number, ex: string[]) =>
          `${c.name} must be ${c.type}: ${n} value(s) do not parse${fmt(ex)}.`,
      };
    });
}

export function importerAssertions(rules: ImporterRule[], work: string, canon: string): Assertion[] {
  return rules.map((r) => ({ ...r, sql: r.sql.replaceAll('{work}', work).replaceAll('{canon}', canon) }));
}

export async function evaluate(conn: DuckDBConnection, assertions: Assertion[]): Promise<RuleFailure[]> {
  const failures: RuleFailure[] = [];
  for (const a of assertions) {
    const count = Number(
      (await conn.runAndReadAll(a.countSql ?? `SELECT count(*) AS n FROM (${a.sql})`)).getRows()[0]![0],
    );
    if (!count) continue;
    const examples = (await conn.runAndReadAll(`SELECT DISTINCT example FROM (${a.sql}) LIMIT 5`))
      .getRows()
      .map((r) => String(r[0]));
    failures.push({
      rule_id: a.id,
      severity: a.severity,
      failing_rows: count,
      message: a.message(count, examples),
      source: a.source,
      examples,
    });
  }
  return failures;
}
