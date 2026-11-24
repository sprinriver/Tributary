// Compounds of readable programs grouped by registered structure (Phase 28): batches of one compound may register
// different structures, and every distinct one is searched and shown.
import type { Database } from '@tributary/db';

export interface CompoundStructureEntry {
  program_id: string;
  program_code: string;
  compound_id: string;
  name: string | null;
  smiles: string | null;
  batch_ids: (string | null)[];
  /** True when the compound's batches register more than one structure. */
  batches_differ: boolean;
}

/** Batch order a person expects: B2 before B10, null last. */
export const batchOrder = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'en', { numeric: true });

export async function compoundRows(
  db: Database,
  readable: string[] | null,
  filter: { programId?: string | undefined; compoundId?: string | undefined; limit: number },
) {
  let q = db
    .selectFrom('compound as c')
    .innerJoin('program as p', 'p.id', 'c.program_id')
    .select(['c.program_id', 'p.code as program_code', 'c.compound_id', 'c.batch_id', 'c.name', 'c.smiles'])
    .where('c.deleted_at', 'is', null);
  if (readable) q = q.where('c.program_id', 'in', readable);
  if (filter.programId) q = q.where('c.program_id', '=', filter.programId);
  if (filter.compoundId) q = q.where('c.compound_id', '=', filter.compoundId);
  return q.orderBy('c.program_id').orderBy('c.compound_id').limit(filter.limit).execute();
}

export function groupByStructure(rows: Awaited<ReturnType<typeof compoundRows>>): CompoundStructureEntry[] {
  const byCompound = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.program_id}|${r.compound_id}`;
    byCompound.set(key, [...(byCompound.get(key) ?? []), r]);
  }
  const out: CompoundStructureEntry[] = [];
  for (const batches of byCompound.values()) {
    batches.sort((x, y) => batchOrder(x.batch_id, y.batch_id));
    const structures = new Map<string, typeof batches>();
    for (const r of batches) {
      const smiles = r.smiles?.trim() ?? '';
      structures.set(smiles, [...(structures.get(smiles) ?? []), r]);
    }
    const differ = [...structures.keys()].filter(Boolean).length > 1;
    for (const [smiles, same] of structures)
      out.push({
        program_id: same[0]!.program_id,
        program_code: same[0]!.program_code,
        compound_id: same[0]!.compound_id,
        name: same.find((r) => r.name)?.name ?? null,
        smiles: smiles || null,
        batch_ids: same.map((r) => r.batch_id),
        batches_differ: differ,
      });
  }
  return out;
}
