// Validation pack (Phase 38, VAL-01): the traceability matrix, requirement → verification method → evidence →
// status, generated from docs/features.json and the test titles (every test title starts with its feature ID).
//   pnpm run validation:pack           write docs/validation/TRACEABILITY.md and .csv
//   pnpm run validation:pack --check   fail if they are stale or a requirement marked passing has no evidence
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = join(ROOT, 'docs/validation');
const TEST_DIRS = ['apps', 'packages', 'e2e', 'scripts'];
const IGNORE = new Set([
  'node_modules',
  'dist',
  'generated',
  '.turbo',
  'test-results',
  '.venv',
  '__pycache__',
]);

/** Test files by repo-relative path → contents. */
export function readTestFiles(root = ROOT) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (IGNORE.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(test|spec)\.(ts|mjs)$/.test(name) || /^test_.*\.py$/.test(name))
        out[relative(root, path)] = readFileSync(path, 'utf8');
    }
  };
  for (const d of TEST_DIRS) walk(join(root, d));
  return out;
}

/** Feature ID → tests ({file, title}), sorted by file then title. */
export function testsByFeature(files) {
  const found = new Map();
  const add = (id, file, title) => found.set(id, [...(found.get(id) ?? []), { file, title }]);
  for (const [file, text] of Object.entries(files)) {
    // Calls at the start of a line in the file's own language, so test fixtures inside strings never count.
    if (file.endsWith('.py')) {
      for (const m of text.matchAll(/^[ \t]*(?:async )?def (test_([A-Z]+)_(\d+)_\w*)\(/gm))
        add(`${m[2]}-${m[3]}`, file, m[1]);
    } else {
      for (const m of text.matchAll(/^[ \t]*(?:it|test)\(\s*(['"`])([A-Z]+-\d+):((?:(?!\1).)*)\1/gm))
        add(m[2], file, `${m[2]}:${m[3]}`);
    }
  }
  for (const list of found.values())
    list.sort((a, b) => a.file.localeCompare(b.file) || a.title.localeCompare(b.title));
  return found;
}

/** One row per requirement. A requirement marked passing with neither tests nor a verify command is a gap. */
export function matrix(features, tests) {
  return features.map((f) => {
    const evidence = tests.get(f.id) ?? [];
    const verify = typeof f.verify === 'string' ? f.verify.trim() : '';
    // A verify command that runs tests needs those tests; only other checks (validate, scan, file exists) count alone.
    const runsTests = /\bpnpm (run )?(test:[a-z]+|e2e)\b/.test(verify);
    const byCommand = evidence.length === 0 && verify !== '' && !runsTests;
    return {
      id: f.id,
      phase: f.phase,
      description: f.description,
      verify: f.verify ?? '',
      method: byCommand ? 'command or document check' : 'automated test',
      evidence,
      status: f.passes ? 'passing' : 'not yet implemented',
      gap: Boolean(f.passes) && evidence.length === 0 && !byCommand,
    };
  });
}

const cell = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');

export function renderMarkdown(rows, date) {
  const passing = rows.filter((r) => r.status === 'passing').length;
  const tests = rows.reduce((n, r) => n + r.evidence.length, 0);
  return [
    '# Traceability matrix',
    '',
    `Generated ${date} by \`pnpm run validation:pack\` from \`docs/features.json\` and the test titles. Do not edit by hand.`,
    '',
    `${rows.length} requirements · ${passing} passing · ${tests} automated tests linked.`,
    'A requirement is verified by the automated tests whose titles start with its ID (run by `pnpm check` and',
    '`pnpm e2e` in CI on every change), or by the command or document check named in "Verify". Evidence of a run is',
    "the CI result for the release's commit.",
    '',
    '| ID | Phase | Requirement | Method | Verify | Evidence | Status |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.phase} | ${cell(r.description)} | ${r.method} | \`${cell(r.verify)}\` | ${
          r.evidence.length ? r.evidence.map((e) => `${cell(e.file)} › ${cell(e.title)}`).join('<br>') : '—'
        } | ${r.status} |`,
    ),
    '',
  ].join('\n');
}

/** CSV with formula-injection-safe, quoted fields. */
const csvField = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== String(v ?? '') ? `"${s.replaceAll('"', '""')}"` : s;
};
export function renderCsv(rows) {
  const head = ['id', 'phase', 'requirement', 'method', 'verify', 'evidence', 'status'];
  return (
    [
      head.join(','),
      ...rows.map((r) =>
        [
          r.id,
          r.phase,
          r.description,
          r.method,
          r.verify,
          r.evidence.map((e) => `${e.file} › ${e.title}`).join('; '),
          r.status,
        ]
          .map(csvField)
          .join(','),
      ),
    ].join('\n') + '\n'
  );
}

function main() {
  const check = process.argv.includes('--check');
  const features = JSON.parse(readFileSync(join(ROOT, 'docs/features.json'), 'utf8'));
  const rows = matrix(features, testsByFeature(readTestFiles()));
  const gaps = rows.filter((r) => r.gap).map((r) => r.id);
  // The date only changes when the content does, so --check compares content, not the day.
  const mdPath = join(OUT, 'TRACEABILITY.md');
  const csvPath = join(OUT, 'TRACEABILITY.csv');
  let previous = '';
  try {
    previous = readFileSync(mdPath, 'utf8');
  } catch {
    /* first run */
  }
  const stamp = (md) => md.replace(/^Generated \d{4}-\d{2}-\d{2} /m, 'Generated ');
  const date = previous.match(/^Generated (\d{4}-\d{2}-\d{2}) /m)?.[1];
  const today = new Date().toISOString().slice(0, 10);
  const sameContent = date && stamp(renderMarkdown(rows, date)) === stamp(previous);
  const md = renderMarkdown(rows, sameContent ? date : today);
  const csv = renderCsv(rows);
  if (check) {
    const read = (p) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    };
    const stale = read(mdPath) !== md || read(csvPath) !== csv;
    if (gaps.length)
      console.error(`validation:pack: requirements marked passing without evidence: ${gaps.join(', ')}`);
    if (stale)
      console.error(
        'validation:pack: docs/validation/TRACEABILITY.* is stale: run `pnpm run validation:pack`',
      );
    if (gaps.length || stale) process.exit(1);
    console.log(`validation:pack: ${rows.length} requirements traced, matrix current.`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(mdPath, md);
  writeFileSync(csvPath, csv);
  console.log(
    `validation:pack: wrote ${relative(ROOT, mdPath)} and .csv (${rows.length} requirements${gaps.length ? `; gaps: ${gaps.join(', ')}` : ''}).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
