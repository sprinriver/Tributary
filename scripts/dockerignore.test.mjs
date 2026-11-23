// OPS-10: every file outside apps/web that the web build reads must reach the Docker build context. The images in
// deploy/ build the web app with `.dockerignore` applied; Phase 40's CSP file (infra/terraform/…/csp.json) was
// excluded with the rest of infra/terraform, which broke those builds. Run with `pnpm run test:scripts`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, matchesGlob, posix, relative, resolve } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const patterns = readFileSync(resolve(ROOT, '.dockerignore'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

/** Docker's rule: the last pattern matching the path or one of its parent directories decides; "!" re-includes. */
export function ignored(path) {
  const candidates = path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'));
  let result = false;
  for (const raw of patterns) {
    const negate = raw.startsWith('!');
    const pattern = negate ? raw.slice(1) : raw;
    const hit = negate ? matchesGlob(path, pattern) : candidates.some((c) => matchesGlob(c, pattern));
    if (hit) result = !negate;
  }
  return result;
}

test('OPS-10: files the web build reads from outside apps/web are in the Docker build context', () => {
  const config = resolve(ROOT, 'apps/web/vite.config.ts');
  const reads = [
    ...readFileSync(config, 'utf8').matchAll(/new URL\('(\.\.\/[^']+)', import\.meta\.url\)/g),
  ].map((m) =>
    relative(ROOT, resolve(dirname(config), m[1]))
      .split('\\')
      .join(posix.sep),
  );
  assert.ok(
    reads.includes('infra/terraform/modules/cloudfront/csp.json'),
    'the CSP file is read by the web build',
  );
  for (const path of reads) {
    assert.ok(existsSync(resolve(ROOT, path)), `${path} exists`);
    assert.equal(ignored(path), false, `${path} must not be excluded by .dockerignore`);
  }
});

test('OPS-10: the rest of the Terraform code stays out of the build context', () => {
  assert.equal(ignored('infra/terraform/modules/cloudfront/main.tf'), true);
  assert.equal(ignored('infra/terraform/envs/dev/main.tf'), true);
  assert.equal(ignored('apps/web/vite.config.ts'), false);
});
