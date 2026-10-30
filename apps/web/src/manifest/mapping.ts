/** header → manifest column key ('' = ignore). */
export type ColumnMapping = Record<string, string>;

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Exact (normalised) header matches map automatically; everything else waits for the user or a preset. */
export function guessMapping(headers: string[], columns: string[]): ColumnMapping {
  const byKey = new Map(columns.map((c) => [normalise(c), c]));
  return Object.fromEntries(headers.map((h) => [h, byKey.get(normalise(h)) ?? '']));
}

/** Rows keyed by uploaded headers → rows keyed by manifest columns (unmapped headers dropped). */
export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): Record<string, string>[] {
  const pairs = Object.entries(mapping).filter(([, column]) => column !== '');
  return rows.map((row) => Object.fromEntries(pairs.map(([header, column]) => [column, row[header] ?? ''])));
}

/**
 * Merges incoming rows into existing ones by sample key: a key that already existed before this import updates that
 * row (once); everything else is appended, so duplicate keys inside the incoming rows stay visible as problems.
 */
export function mergeBySampleKey<T extends { cells: Record<string, string> }>(
  existing: T[],
  incoming: Record<string, string>[],
  make: (cells: Record<string, string>) => T,
): T[] {
  const out = [...existing];
  const index = new Map<string, number>();
  existing.forEach((r, i) => {
    const key = r.cells.sample_key?.trim();
    if (key && !index.has(key)) index.set(key, i);
  });
  for (const cells of incoming) {
    const key = cells.sample_key?.trim();
    const i = key === undefined ? undefined : index.get(key);
    if (i !== undefined) {
      out[i] = { ...out[i]!, cells: { ...out[i]!.cells, ...cells } };
      index.delete(key!);
    } else out.push(make(cells));
  }
  return out;
}
