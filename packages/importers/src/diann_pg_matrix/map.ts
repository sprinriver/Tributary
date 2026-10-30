import type { ImportContext } from '../types.ts';

/** Run column header (raw file path) → file name and instrument run (file name without extension). */
export function runName(column: string): { fileName: string; instrumentRun: string } {
  const fileName = column.split(/[\\/]/).at(-1) ?? column;
  return { fileName, instrumentRun: fileName.replace(/\.(raw|d|wiff2?|mzml|dia)$/i, '') };
}

const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/**
 * Matches each run to a manifest sample: by instrument_run, else by the file name of raw_file (a path or URI)
 * (SOURCE.md "Runs → samples"). More than one candidate is ambiguous: no sample is chosen.
 */
export function mapRuns(columns: string[], runs: NonNullable<ImportContext['runs']>) {
  return columns.map((column) => {
    const { fileName, instrumentRun } = runName(column);
    let matches = runs.filter((r) => r.instrument_run === instrumentRun);
    if (!matches.length)
      matches = runs.filter((r) => r.raw_file !== null && baseName(r.raw_file) === fileName);
    const keys = [...new Set(matches.map((m) => m.sample_key))];
    return { column, instrumentRun, sampleKey: keys.length === 1 ? keys[0]! : null, candidates: keys };
  });
}
