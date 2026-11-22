import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATASET_CONTRACTS, evolutionProblems, lockEntry, type DatasetContract } from './index.ts';

// ADR 0032: a dataset contract changes only additively (new nullable columns) and with a new version; every version is
// kept in contracts.lock.json, so that releases written under any of them stay readable.
const LOCK = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../contracts.lock.json'), 'utf8'),
) as Record<string, Record<string, ReturnType<typeof lockEntry>>>;

const base: DatasetContract = {
  ...DATASET_CONTRACTS.protein_quant,
  version: '1.0.0',
};
const withColumns = (version: string, columns: DatasetContract['columns']): DatasetContract => ({
  ...base,
  version,
  columns,
});

describe('CON-05: dataset contracts evolve additively', () => {
  it('CON-05: every contract matches its entry in contracts.lock.json (run `pnpm run contracts:lock` after a version bump)', () => {
    for (const [kind, contract] of Object.entries(DATASET_CONTRACTS)) {
      const entry = LOCK[kind]?.[contract.version];
      expect(entry, `${kind} ${contract.version} is not in contracts.lock.json`).toBeDefined();
      expect(lockEntry(contract), `${kind} ${contract.version} changed without a new version`).toEqual(entry);
    }
  });

  it('CON-05: each locked version of a kind is additive over the one before', () => {
    for (const [kind, versions] of Object.entries(LOCK)) {
      const ordered = Object.keys(versions).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      for (let i = 1; i < ordered.length; i++)
        expect(
          evolutionProblems(versions[ordered[i - 1]!]!, versions[ordered[i]!]!),
          `${kind} ${ordered[i]}`,
        ).toEqual([]);
    }
  });

  it('CON-05: removing, retyping or making a column required, or adding a required column, is refused', () => {
    const prev = lockEntry(base);
    const cols = base.columns;
    const same = (c: (typeof cols)[number]) => c;
    expect(evolutionProblems(prev, lockEntry(withColumns('1.1.0', cols.map(same))))).toEqual([]);
    expect(
      evolutionProblems(
        prev,
        lockEntry(withColumns('1.1.0', [...cols, { name: 'extra', type: 'double', nullable: true }])),
      ),
    ).toEqual([]);
    expect(
      evolutionProblems(
        prev,
        lockEntry(
          withColumns(
            '1.1.0',
            cols.filter((c) => c.name !== 'q_value'),
          ),
        ),
      ),
    ).toEqual(['q_value: removed']);
    expect(
      evolutionProblems(
        prev,
        lockEntry(
          withColumns(
            '1.1.0',
            cols.map((c) => (c.name === 'q_value' ? { ...c, type: 'text' as const } : c)),
          ),
        ),
      ),
    ).toEqual(['q_value: type double → text']);
    expect(
      evolutionProblems(
        prev,
        lockEntry(
          withColumns(
            '1.1.0',
            cols.map((c) => (c.name === 'q_value' ? { ...c, nullable: false } : c)),
          ),
        ),
      ),
    ).toEqual(['q_value: now required']);
    expect(
      evolutionProblems(
        prev,
        lockEntry(withColumns('1.1.0', [...cols, { name: 'extra', type: 'double', nullable: false }])),
      ),
    ).toEqual(['extra: added as required (new columns must be nullable)']);
  });
});
