import type { BuiltImport, ImportContext, ImporterRule } from '../types.ts';

// Run name → manifest sample (SPEC §6.3 "run names → instrument_run → manifest"), shared by every importer that
// carries per-run columns or rows. A name matches, in order: a sample_key, an instrument_run, or the file name of a
// raw_file (paths/URIs and the extensions .raw .d .wiff .mzML .dia are ignored). More than one sample → ambiguous.

const STEM_SQL = (expr: string) =>
  `regexp_replace(regexp_replace(${expr}, '^.*[/\\\\]', ''), '\\.(raw|d|wiff2?|mzml|dia)$', '', 'i')`;
const stem = (name: string) =>
  (name.split(/[\\/]/).at(-1) ?? name).replace(/\.(raw|d|wiff2?|mzml|dia)$/i, '');

export interface RunMatching {
  setup: BuiltImport['setup'];
  rules: ImporterRule[];
  /** Temp table (run_col, instrument_run, sample_key, candidates, condition). */
  table: string;
}

/** `namesSql` selects the distinct run names as column `name` (it may read the source table). */
export function runMatching(prefix: string, namesSql: string, ctx: ImportContext): RunMatching {
  const manifest = `${prefix}_manifest`;
  const table = `${prefix}_runmap`;
  const runs = ctx.runs ?? [];
  const params: Record<string, string | null> = {};
  const values = runs
    .map((r, i) => {
      params[`ms${i}`] = r.sample_key;
      params[`mi${i}`] = r.instrument_run ? stem(r.instrument_run) : null;
      params[`mr${i}`] = r.raw_file ? stem(r.raw_file) : null;
      params[`mc${i}`] = r.condition ?? null;
      return `($ms${i}, $mi${i}, $mr${i}, $mc${i})`;
    })
    .join(', ');
  const pick = (where: string) =>
    `nullif((SELECT list_distinct(list(m.sample_key)) FROM ${manifest} m WHERE ${where}), [])`;
  return {
    setup: [
      {
        sql: `CREATE OR REPLACE TEMP TABLE ${manifest} (sample_key VARCHAR, instrument_run VARCHAR, raw_base VARCHAR, condition VARCHAR)${values ? `; INSERT INTO ${manifest} VALUES ${values}` : ''}`,
        params,
      },
      {
        sql: `CREATE OR REPLACE TEMP TABLE ${table} AS
          WITH names AS (${namesSql}),
          s AS (SELECT name, ${STEM_SQL('name')} AS stem FROM names WHERE name IS NOT NULL),
          k AS (
            SELECT name, stem, coalesce(
              ${pick('m.sample_key = s.name OR m.sample_key = s.stem')},
              ${pick('m.instrument_run = s.stem')},
              ${pick('m.raw_base = s.stem')},
              []::VARCHAR[]) AS keys
            FROM s
          )
          SELECT name AS run_col,
            -- The manifest's instrument_run when the name matched a sample (e.g. MaxQuant sample columns), else the stem.
            coalesce((SELECT any_value(m.instrument_run) FROM ${manifest} m WHERE len(keys) = 1 AND m.sample_key = keys[1]), stem) AS instrument_run,
            CASE WHEN len(keys) = 1 THEN keys[1] END AS sample_key, len(keys) AS candidates,
            (SELECT any_value(m.condition) FROM ${manifest} m WHERE len(keys) = 1 AND m.sample_key = keys[1]) AS condition
          FROM k`,
      },
    ],
    rules: [
      {
        id: 'run_in_manifest',
        severity: 'error',
        source: 'SPEC §6.3: run names → instrument_run → manifest',
        sql: `SELECT run_col AS example FROM ${table} WHERE candidates = 0`,
        message: (n, ex) => `${n} run(s) are not in the sample manifest: ${ex.join(', ')}.`,
      },
      {
        id: 'run_ambiguous',
        severity: 'error',
        source: 'SPEC §6.3: each run maps to exactly one manifest sample',
        sql: `SELECT run_col AS example FROM ${table} WHERE candidates > 1`,
        message: (n, ex) => `${n} run(s) match more than one manifest sample: ${ex.join(', ')}.`,
      },
    ],
    table,
  };
}

/** A count of rows removed by a documented, flagged filter, reported as a warning so it is never silent. */
export function removedRowsRule(id: string, source: string, sql: string, what: string): ImporterRule {
  return {
    id,
    severity: 'warn',
    source,
    sql,
    message: (n, ex) => `${n} ${what} removed (flagged)${ex.length ? `: ${ex.join(', ')}` : ''}.`,
  };
}
