// Runs the Playwright suite, optionally filtered by test title: `pnpm e2e smoke`, `pnpm e2e "VIZ-0[5-8]"`.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pattern = process.argv.slice(2).join(' ');
const args = ['test', ...(pattern ? ['--grep', pattern] : [])];
const result = spawnSync(join(root, 'node_modules', '.bin', 'playwright'), args, {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
