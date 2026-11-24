// Phase 38 (VAL-01): the traceability matrix generator. Run with `pnpm run test:scripts` (node:test, no dependency).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matrix, renderCsv, renderMarkdown, testsByFeature } from './validation-pack.mjs';

const features = [
  {
    id: 'REG-01',
    phase: 5,
    description: 'Create an experiment',
    verify: 'pnpm run test:api REG-01',
    passes: true,
  },
  { id: 'OPS-03', phase: 21, description: 'Runbook written', verify: 'test -f docs/DEPLOY.md', passes: true },
  { id: 'NEW-01', phase: 40, description: 'Not built yet', verify: 'pnpm e2e NEW-01', passes: false },
];
const files = {
  'apps/api/src/registry.test.ts':
    "it('REG-01: creates an experiment, audited', async () => {})\nit('REG-01: refuses a duplicate name', () => {})",
  'e2e/registry.spec.ts': "test('REG-01: from the UI', async () => {})",
  'apps/compute/tests/test_x.py': 'def test_REG_01_python_side() -> None:\n    pass\n',
};

test('VAL-01: tests are found by the feature ID that starts their title, in TypeScript and Python', () => {
  const found = testsByFeature(files);
  assert.deepEqual(
    found.get('REG-01').map((t) => `${t.file} › ${t.title}`),
    [
      'apps/api/src/registry.test.ts › REG-01: creates an experiment, audited',
      'apps/api/src/registry.test.ts › REG-01: refuses a duplicate name',
      'apps/compute/tests/test_x.py › test_REG_01_python_side',
      'e2e/registry.spec.ts › REG-01: from the UI',
    ],
  );
});

test('VAL-01: test-shaped text inside strings (fixtures) is not evidence', () => {
  const found = testsByFeature({
    'scripts/x.test.mjs':
      "const f = { 'a.test.ts': \"it('REG-01: fake', () => {})\", 'b.py': 'def test_REG_01_fake():' };\n",
  });
  assert.equal(found.get('REG-01'), undefined);
});

test('VAL-01: every requirement gets a method and evidence; claimed-passing ones without evidence are gaps', () => {
  const rows = matrix(features, testsByFeature(files));
  assert.deepEqual(
    rows.map((r) => [r.id, r.method, r.status, r.gap]),
    [
      ['REG-01', 'automated test', 'passing', false],
      ['OPS-03', 'command or document check', 'passing', false],
      ['NEW-01', 'automated test', 'not yet implemented', false],
    ],
  );
  assert.equal(rows[0].evidence.length, 4);
  const gap = matrix([{ ...features[0], id: 'GAP-01' }], new Map());
  assert.equal(gap[0].gap, true); // marked passing, but no test and no command
});

test('VAL-01: Markdown and CSV are deterministic and CSV fields are quoted safely', () => {
  const rows = matrix(features, testsByFeature(files));
  assert.equal(renderMarkdown(rows, '2026-11-09'), renderMarkdown(rows, '2026-11-09'));
  const csv = renderCsv([{ ...rows[0], description: 'says "hi", then =SUM(A1)' }]);
  assert.match(csv, /"says ""hi"", then =SUM\(A1\)"/);
  assert.match(renderMarkdown(rows, '2026-11-09'), /\| REG-01 \| 5 \|/);
});
