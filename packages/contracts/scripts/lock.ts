// `pnpm run contracts:lock`: records each dataset contract's current version in packages/contracts/contracts.lock.json
// (ADR 0032). Earlier versions stay in the file. A version already locked with other columns is refused: bump it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATASET_CONTRACTS } from '../src/datasets/index.ts';
import { evolutionProblems, lockEntry, type LockEntry } from '../src/datasets/evolution.ts';

const FILE = join(import.meta.dirname, '..', 'contracts.lock.json');
const lock = (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}) as Record<
  string,
  Record<string, LockEntry>
>;
const byVersion = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const errors: string[] = [];
let added = 0;
for (const [kind, contract] of Object.entries(DATASET_CONTRACTS)) {
  const versions = (lock[kind] ??= {});
  const entry = lockEntry(contract);
  const locked = versions[contract.version];
  if (locked) {
    if (JSON.stringify(locked) !== JSON.stringify(entry))
      errors.push(
        `${kind} ${contract.version} is locked with other columns: give the contract a new version.`,
      );
    continue;
  }
  const previous = Object.keys(versions).sort(byVersion).at(-1);
  if (previous && byVersion(previous, contract.version) > 0)
    errors.push(`${kind} ${contract.version} is older than the locked ${previous}.`);
  const problems = previous ? evolutionProblems(versions[previous]!, entry) : [];
  if (problems.length)
    errors.push(`${kind} ${contract.version} is not additive over ${previous}: ${problems.join('; ')}`);
  else {
    versions[contract.version] = entry;
    added += 1;
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const sorted = Object.fromEntries(
  Object.keys(lock)
    .sort()
    .map((k) => [
      k,
      Object.fromEntries(
        Object.keys(lock[k]!)
          .sort(byVersion)
          .map((v) => [v, lock[k]![v]]),
      ),
    ]),
);
writeFileSync(FILE, JSON.stringify(sorted, null, 2) + '\n');
console.log(
  `contracts:lock: ${added} contract version(s) recorded in packages/contracts/contracts.lock.json`,
);
