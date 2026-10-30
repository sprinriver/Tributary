// Licence allowlist check over every Node (pnpm) and Python (uv) dependency — docs/ARCHITECTURE.md §9.
// Fails on any licence not on the allowlist, including GPL/AGPL/LGPL/BUSL/SSPL/non-commercial and unknown ones.
// Node: pnpm's built-in `pnpm licenses list`. Python: pip-licenses (MIT), pinned in apps/compute dev deps.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// SPDX ids plus the free-text spellings PyPI metadata uses for the same licences.
const ALLOWED = new Set([
  'MIT',
  'MIT License',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD License',
  '0BSD',
  'Apache-2.0',
  'Apache Software License',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0', // data-only packages such as caniuse-lite
  'Unlicense',
  'Zlib',
  'Python-2.0',
  'PSF-2.0',
  'Python Software Foundation License',
  // Weak, file-level copyleft: fine to depend on unmodified; never copy its source into ours.
  'MPL-2.0',
  'Mozilla Public License 2.0 (MPL 2.0)',
]);

/** "A OR B" passes when any alternative is allowed; "A AND B" only when every part is (SPDX expressions). */
function isAllowed(licence) {
  const trimmed = licence.trim();
  const cleaned = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  return cleaned
    .split(/\s+OR\s+|;\s*/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((part) => ALLOWED.has(part.trim())));
}

const failures = [];
let checked = 0;

const nodeJson = execFileSync('pnpm', ['licenses', 'list', '--json'], { cwd: root, encoding: 'utf8' });
for (const [licence, pkgs] of Object.entries(JSON.parse(nodeJson))) {
  for (const pkg of pkgs) {
    checked += 1;
    if (!isAllowed(licence)) failures.push(`node  ${pkg.name}@${pkg.versions.join(',')}  ${licence}`);
  }
}

const pyJson = execFileSync('uv', ['run', '--locked', 'pip-licenses', '--format=json'], {
  cwd: resolve(root, 'apps/compute'),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
for (const pkg of JSON.parse(pyJson)) {
  checked += 1;
  if (!isAllowed(pkg.License)) failures.push(`python  ${pkg.Name}@${pkg.Version}  ${pkg.License}`);
}

if (failures.length > 0) {
  console.error(`licence:scan: ${failures.length} dependencies have licences outside the allowlist:`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`licence:scan: ${checked} dependencies checked, all licences on the allowlist.`);
