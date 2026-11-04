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

/**
 * Packages whose package.json has no licence field, checked by hand against their licence file. Exact versions only:
 * a new version is unknown again until re-checked.
 */
const VERIFIED = new Map([
  // LICENSE file: MIT text, "Copyright (c) 2011 Felix Geisendörfer" (via plotly.js → regl-scatter2d → glslify).
  ['stack-trace@0.0.9', 'MIT'],
]);

const failures = [];
let checked = 0;

// -r: every workspace package's dependencies, not only the root's.
const nodeJson = execFileSync('pnpm', ['licenses', 'list', '--json', '-r'], { cwd: root, encoding: 'utf8' });
for (const [licence, pkgs] of Object.entries(JSON.parse(nodeJson))) {
  for (const pkg of pkgs) {
    for (const version of pkg.versions) {
      checked += 1;
      const effective = VERIFIED.get(`${pkg.name}@${version}`) ?? licence;
      if (!isAllowed(effective)) failures.push(`node  ${pkg.name}@${version}  ${licence}`);
    }
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
