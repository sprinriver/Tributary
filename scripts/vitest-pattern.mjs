// Runs one package's vitest suite, optionally filtered by test title: `pnpm run test:api REG-03`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [pkgDir, ...patternParts] = process.argv.slice(2);
if (!pkgDir) {
  console.error('usage: vitest-pattern.mjs <package-dir> [title pattern]');
  process.exit(2);
}
const cwd = resolve(import.meta.dirname, '..', pkgDir);
// The package's own entry script, run with this Node: `.bin/vitest` is a `.cmd` shim on Windows, which
// spawnSync cannot start without a shell.
const entry = join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
if (!existsSync(entry)) {
  console.error(`vitest is not installed in ${pkgDir}; run \`pnpm run bootstrap\` first.`);
  process.exit(2);
}
const pattern = patternParts.join(' ');
const args = ['run', ...(pattern ? ['-t', pattern] : [])];
const result = spawnSync(process.execPath, [entry, ...args], { cwd, stdio: 'inherit' });
process.exit(result.status ?? 1);
