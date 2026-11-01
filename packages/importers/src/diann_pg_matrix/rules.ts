import type { ImporterRule } from '../types.ts';

export const runsRule = (runsTable: string): ImporterRule => ({
  id: 'run_in_manifest',
  severity: 'error',
  source: 'SPEC §6.3 diann_pg_matrix: run names → instrument_run → manifest',
  sql: `SELECT instrument_run AS example FROM ${runsTable} WHERE sample_key IS NULL AND candidates = 0`,
  message: (n, ex) =>
    `${n} run(s) are not in the sample manifest (instrument_run or raw_file): ${ex.join(', ')}.`,
});

export const ambiguousRule = (runsTable: string): ImporterRule => ({
  id: 'run_ambiguous',
  severity: 'error',
  source: 'SPEC §6.3 diann_pg_matrix: each run maps to exactly one manifest sample',
  sql: `SELECT instrument_run AS example FROM ${runsTable} WHERE candidates > 1`,
  message: (n, ex) => `${n} run(s) match more than one manifest sample: ${ex.join(', ')}.`,
});
