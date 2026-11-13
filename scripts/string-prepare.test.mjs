// Phase 45 (PPI-01): STRING download files → Tributary's interaction TSV. Run with `pnpm run test:scripts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMinScore, stringToTsv } from './string-prepare.mjs';

// Formats as downloaded from stringdb-downloads.org (v12.0): protein.links is space-separated with a header and
// lists each pair in both directions; protein.info is tab-separated and maps STRING IDs to preferred names.
const links = [
  'protein1 protein2 combined_score',
  '9606.ENSP1 9606.ENSP2 999',
  '9606.ENSP2 9606.ENSP1 999',
  '9606.ENSP1 9606.ENSP3 650',
  '9606.ENSP3 9606.ENSP1 650',
  '9606.ENSP2 9606.ENSP9 900',
  '',
].join('\n');
const info = [
  '#string_protein_id\tpreferred_name\tprotein_size\tannotation',
  '9606.ENSP1\tTP53\t393\tCellular tumor antigen p53',
  '9606.ENSP2\tMDM2\t491\tE3 ubiquitin-protein ligase Mdm2',
  '9606.ENSP3\tAKT1\t480\tRAC-alpha serine/threonine-protein kinase',
  '',
].join('\n');

test('PPI-01: STRING links at or above the score become one "gene gene score" line per pair, by preferred name', () => {
  const out = stringToTsv(links, info, 700);
  assert.equal(out.tsv, 'MDM2\tTP53\t999\n');
  assert.deepEqual(out.counts, {
    pairs: 1,
    rowsBelowScore: 2, // rows, as in the file (each pair is usually listed twice)
    rowsUnmapped: 1,
    sharedNames: 0,
    sameNamePairs: 0,
    mergedPairs: 0,
  });
});

test('PPI-01: a lower threshold keeps more pairs; pairs are sorted', () => {
  assert.equal(stringToTsv(links, info, 400).tsv, 'AKT1\tTP53\t650\nMDM2\tTP53\t999\n');
});

test('PPI-01: a pair listed in one direction only is kept', () => {
  const one = 'protein1 protein2 combined_score\n9606.ENSP2 9606.ENSP1 900\n';
  assert.equal(stringToTsv(one, info, 700).tsv, 'MDM2\tTP53\t900\n');
});

test('PPI-01: proteins sharing a preferred name are reported: same-name pairs dropped, merged pairs counted', () => {
  const shared = [
    '#string_protein_id\tpreferred_name\tprotein_size\tannotation',
    '9606.A\tGENE1\t1\tx',
    '9606.B\tGENE1\t1\tx',
    '9606.C\tGENE2\t1\tx',
  ].join('\n');
  const rows = [
    'protein1 protein2 combined_score',
    '9606.A 9606.B 950', // two proteins, one name: dropped
    '9606.A 9606.C 800',
    '9606.B 9606.C 900', // merges with the pair above; the higher score is kept
  ].join('\n');
  const out = stringToTsv(rows, shared, 700);
  assert.equal(out.tsv, 'GENE1\tGENE2\t900\n');
  assert.deepEqual([out.counts.sharedNames, out.counts.sameNamePairs, out.counts.mergedPairs], [1, 1, 1]);
});

test('PPI-01: the minimum score must be a whole number from 0 to 1000', () => {
  assert.equal(parseMinScore('700'), 700);
  assert.equal(parseMinScore(undefined), 700);
  for (const bad of ['0.7', 'high', '1200', '-1']) assert.throws(() => parseMinScore(bad), /0 to 1000/);
});
