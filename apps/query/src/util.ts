/** Column names accepted in ORDER BY (contract column names only; checked again against the release). */
export const DUCKDB_SAFE_COLUMN = /^[a-z][a-z0-9_]*$/;

let tail: Promise<unknown> = Promise.resolve();
/** Runs tasks one at a time (the shared DuckDB connection holds per-import temp tables). */
export function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}
