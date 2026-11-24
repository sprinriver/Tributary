import type { DatasetContract } from './types.ts';

// Contract evolution (ADR 0032). Releases are immutable files written under the contract version of their day, so a
// contract may only change additively: existing columns keep their name, type and nullability; new columns are nullable.

export interface LockEntry {
  columns: { name: string; type: string; nullable: boolean }[];
}

/** What contracts.lock.json records for one contract version (columns by name; order does not matter). */
export const lockEntry = (contract: DatasetContract): LockEntry => ({
  columns: contract.columns
    .map((c) => ({ name: c.name, type: c.type, nullable: c.nullable }))
    .sort((a, b) => a.name.localeCompare(b.name)),
});

/** Why `next` is not an additive change of `prev` (empty when it is). */
export function evolutionProblems(prev: LockEntry, next: LockEntry): string[] {
  const after = new Map(next.columns.map((c) => [c.name, c]));
  const before = new Set(prev.columns.map((c) => c.name));
  const problems: string[] = [];
  for (const c of prev.columns) {
    const n = after.get(c.name);
    if (!n) problems.push(`${c.name}: removed`);
    else if (n.type !== c.type) problems.push(`${c.name}: type ${c.type} → ${n.type}`);
    else if (c.nullable && !n.nullable) problems.push(`${c.name}: now required`);
  }
  for (const n of next.columns)
    if (!before.has(n.name) && !n.nullable)
      problems.push(`${n.name}: added as required (new columns must be nullable)`);
  return problems;
}
