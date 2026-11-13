// Phase 45 (PPI-01): STRING download files → Tributary's interaction TSV. Run with `pnpm run test:scripts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringToTsv } from './string-prepare.mjs';

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
  assert.deepEqual(out.counts, { pairs: 1, belowScore: 2, unmapped: 1 });
});

test('PPI-01: a lower threshold keeps more pairs; pairs are sorted', () => {
  assert.equal(stringToTsv(links, info, 400).tsv, 'AKT1\tTP53\t650\nMDM2\tTP53\t999\n');
});
