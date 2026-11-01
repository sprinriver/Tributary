import type { ColumnType } from '@tributary/contracts';

// SQL text helpers. Identifiers come from file headers and are always quoted; values go in as parameters.
// Literals are used only for constants from code (contracts, importer definitions), never for user input.

export const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

export const DUCKDB_TYPES: Record<ColumnType, string> = {
  text: 'VARCHAR',
  uuid: 'UUID',
  double: 'DOUBLE',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMPTZ',
  'text[]': 'VARCHAR[]',
  'double[]': 'DOUBLE[]',
  json: 'JSON',
};

/** The cell with NA tokens (and blanks) as NULL. */
export function na(expr: string, tokens: readonly string[]): string {
  const list = ['', ...tokens.filter((t) => t !== '')].map(literal).join(', ');
  return `(CASE WHEN trim(${expr}) IN (${list}) THEN NULL ELSE ${expr} END)`;
}

/** Text → DOUBLE, honouring a decimal comma. Unparseable → NULL (reported by the `<column>_numeric` rule). */
export function num(expr: string, decimal: '.' | ','): string {
  const text = decimal === ',' ? `replace(trim(${expr}), ',', '.')` : `trim(${expr})`;
  return `TRY_CAST(${text} AS DOUBLE)`;
}

/** Text → list split on a separator, trimmed, blanks dropped; NULL or blank → []. */
export function split(expr: string, separator = ';'): string {
  return `(CASE WHEN ${expr} IS NULL OR trim(${expr}) = '' THEN []::VARCHAR[] ELSE list_filter(list_transform(string_split(${expr}, ${literal(separator)}), lambda x: trim(x)), lambda x: x <> '') END)`;
}

/** Text → a contract type. */
export function typed(expr: string, type: ColumnType, decimal: '.' | ',', separator = ';'): string {
  switch (type) {
    case 'text':
      return expr;
    case 'double':
      return num(expr, decimal);
    case 'integer':
      // Never round: a non-integral value stays NULL and fails the `<column>_numeric` rule.
      return `(CASE WHEN ${num(expr, decimal)} = trunc(${num(expr, decimal)}) THEN TRY_CAST(${num(expr, decimal)} AS INTEGER) END)`;
    case 'text[]':
      return split(expr, separator);
    case 'double[]':
      return `list_transform(${split(expr, separator)}, lambda x: ${num('x', decimal)})`;
    case 'json':
      return `(CASE WHEN json_valid(${expr}) THEN ${expr}::JSON END)`;
    default:
      return `TRY_CAST(trim(${expr}) AS ${DUCKDB_TYPES[type]})`;
  }
}
