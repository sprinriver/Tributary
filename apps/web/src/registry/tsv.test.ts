import { expect, it } from 'vitest';
import { parseTsv } from './tsv.ts';

it('REG-07: pasted TSV becomes raw rows keyed by header', () => {
  expect(parseTsv('sample_key\twell\r\nS1\tA01\n\nS2\t\n')).toEqual([
    { sample_key: 'S1', well: 'A01' },
    { sample_key: 'S2', well: '' },
  ]);
});
