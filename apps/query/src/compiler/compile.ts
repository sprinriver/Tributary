import { LIST, VARCHAR, listValue, type DuckDBType, type DuckDBValue } from '@duckdb/node-api';
import {
  checkJoinKeys,
  issuesToErrors,
  QuerySpecSchema,
  validateQuerySpec,
  type DatasetContract,
  type QuerySpec,
  type SourceRef,
} from '@tributary/contracts';
import { createHash } from 'node:crypto';
import { group, Params, type ColumnLookup } from './rules.ts';
import {
  CompileError,
  DUCKDB_TYPE,
  q,
  type CompiledQuery,
  type OutputColumn,
  type SourceInput,
  type Sources,
} from './types.ts';

const EXPLODE_COLUMNS: OutputColumn[] = [
  { name: 'explode_value', type: 'text' },
  { name: 'explode_ambiguous', type: 'boolean' },
];

/** Validates the spec (schema, contracts, operator × type, join keys) and returns it typed. */
function validate(input: unknown, sources: Sources): QuerySpec {
  const parsed = QuerySpecSchema.safeParse(input);
  if (!parsed.success) {
    const [first] = issuesToErrors(parsed.error.issues);
    throw new CompileError('invalid_spec', first?.field ?? '', first?.message ?? 'Invalid QuerySpec');
  }
  const spec = parsed.data;
  if ((spec.joins ?? []).length !== sources.joins.length)
    throw new CompileError('invalid_sources', 'joins', 'Every join needs a resolved source.');
  const contracts = new Map<SourceRef, DatasetContract>([[spec.source, sources.source.contract]]);
  spec.joins?.forEach((j, i) => contracts.set(j.target, sources.joins[i]!.contract));
  const resolve = (ref: SourceRef) => contracts.get(ref);
  const [first] = [
    ...validateQuerySpec(spec, resolve),
    // Role gating of advanced mode is the API's job; here it only must not bypass the key rules.
    ...checkJoinKeys(spec, resolve, { advancedAllowed: true }),
  ];
  if (first) throw new CompileError(first.code, first.field ?? '', first.message);
  return spec;
}

/** CTE body for a source: contract columns plus the tiebreak columns `__file`, `__row`. */
function sourceSelect(
  input: SourceInput,
  param: string,
  params: Record<string, DuckDBValue>,
  types: Record<string, DuckDBType>,
): string {
  if (input.table) {
    // Metadata temp tables: cast to the contract types; rowid orders rows deterministically.
    const cols = input.contract.columns.map(
      (c) => `CAST(${q(c.name)} AS ${DUCKDB_TYPE[c.type]}) AS ${q(c.name)}`,
    );
    return `SELECT ${[...cols, `'' AS __file`, 'rowid AS __row'].join(', ')} FROM ${q(input.table)}`;
  }
  if (!input.files?.length) {
    // No release in scope: an empty source with the contract's columns.
    const cols = input.contract.columns.map((c) => `CAST(NULL AS ${DUCKDB_TYPE[c.type]}) AS ${q(c.name)}`);
    return `SELECT ${[...cols, `'' AS __file`, '0::BIGINT AS __row'].join(', ')} WHERE false`;
  }
  params[param] = listValue(input.files);
  types[param] = LIST(VARCHAR);
  const cols = input.contract.columns.map((c) => q(c.name));
  return `SELECT ${[...cols, 'filename AS __file', 'file_row_number AS __row'].join(', ')}
    FROM read_parquet($${param}, union_by_name = true, filename = true, file_row_number = true)`;
}

/** QuerySpec + resolved sources → parameterized DuckDB SQL (SPEC §7.1, ARCHITECTURE §6). */
export function compileQuery(input: unknown, sources: Sources): CompiledQuery {
  const spec = validate(input, sources);
  const params = new Params();
  const fileParams: Record<string, DuckDBValue> = {};
  const types: Record<string, DuckDBType> = {};
  const joins = spec.joins ?? [];
  const exploding = joins.find((j) => j.explode);
  const base = sources.source.contract;
  const aliases = new Map(joins.map((j, i) => [j.alias, sources.joins[i]!.contract]));

  // Primary source; an explode adds one row per element (empty or null lists keep one row with a null value).
  let primary = sourceSelect(sources.source, 'src', fileParams, types);
  if (exploding?.explode) {
    const list = q(exploding.explode);
    primary = `SELECT *, unnest(__l) AS explode_value, unnest(range(len(__l))) AS __sub,
      coalesce(len(${list}), 0) > 1 AS explode_ambiguous
      FROM (SELECT *, CASE WHEN ${list} IS NULL OR len(${list}) = 0 THEN [NULL]::VARCHAR[] ELSE ${list} END AS __l
            FROM (${primary}))`;
  }
  const ctes = [`__src AS (${primary})`];

  joins.forEach((join, i) => {
    const target = sources.joins[i]!.contract;
    let body = sourceSelect(sources.joins[i]!, `j${i}`, fileParams, types);
    if (join.where) {
      // Filtered inside the joined subquery, so a LEFT join keeps unmatched primary rows (v1 parity).
      const lookup: ColumnLookup = (field) => ({
        sql: q(field),
        column: target.columns.find((c) => c.name === field)!,
      });
      body = `SELECT * FROM (${body}) WHERE ${group(join.where, lookup, params)}`;
    }
    ctes.push(`__j${i} AS (${body})`);
  });

  const ref = (field: string, explodeFor?: string): string => {
    const [first, second] = field.split('.');
    if (second === undefined) return explodeFor === first ? '__src."explode_value"' : `__src.${q(first!)}`;
    return `${q(first!)}.${q(second)}`;
  };
  const columnOf = (field: string) => {
    const [first, second] = field.split('.');
    const contract = second === undefined ? base : aliases.get(first!)!;
    return contract.columns.find((c) => c.name === (second ?? first))!;
  };

  const from = joins
    .map((join, i) => {
      const on = join.on
        .map((c) => {
          const explodeFor = join.explode;
          const left = ref(c.left, explodeFor);
          const right = ref(c.right, explodeFor);
          return c.op === 'startsWith'
            ? `starts_with(${left}, ${right})`
            : `${left} ${c.op === '!=' ? '<>' : c.op} ${right}`;
        })
        .join(' AND ');
      return `${join.type.toUpperCase()} JOIN __j${i} AS ${q(join.alias)} ON ${on}`;
    })
    .join('\n');

  const selected = spec.select ?? [
    ...base.columns.map((c) => c.name),
    ...joins.flatMap((j, i) => sources.joins[i]!.contract.columns.map((c) => `${j.alias}.${c.name}`)),
  ];
  const columns: OutputColumn[] = selected.map((name) => ({ name, type: columnOf(name).type }));
  const outputs = selected.map((name) => `${ref(name)} AS ${q(name)}`);
  if (exploding) {
    columns.push(...EXPLODE_COLUMNS);
    outputs.push('__src.explode_value AS explode_value', '__src.explode_ambiguous AS explode_ambiguous');
  }

  const where = spec.where
    ? `WHERE ${group(spec.where, (field) => ({ sql: ref(field), column: columnOf(field) }), params)}`
    : '';
  const tiebreak = [
    '__src.__file',
    '__src.__row',
    ...(exploding ? ['__src.__sub'] : []),
    ...joins.flatMap((j) => [`${q(j.alias)}.__file`, `${q(j.alias)}.__row`]),
  ];
  const order = [
    ...(spec.orderBy ?? []).map((o) => `${ref(o.column)} ${o.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`),
    ...tiebreak.map((t) => `${t} ASC NULLS LAST`),
  ];
  const with_ = `WITH ${ctes.join(',\n')}`;
  const tail = `FROM __src\n${from}\n${where}`;
  const sql = `${with_}\nSELECT ${outputs.join(', ')}\n${tail}\nORDER BY ${order.join(', ')}`;
  const countSql = `${with_}\nSELECT 1\n${tail}`;
  const allParams: Record<string, DuckDBValue> = { ...fileParams, ...params.values };
  const sqlHash = createHash('sha256')
    .update(sql)
    .update(JSON.stringify(params.values))
    .update(
      JSON.stringify([
        sources.source.files ?? sources.source.table,
        ...sources.joins.map((j) => j.files ?? j.table),
      ]),
    )
    .digest('hex');
  return { sql, countSql, params: allParams, types, columns, sqlHash };
}
