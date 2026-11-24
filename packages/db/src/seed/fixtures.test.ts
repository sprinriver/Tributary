import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTsv } from './fixtures.ts';

describe('fixture files', () => {
  it('SYN-01: a TSV saved with Windows line endings (CRLF) reads the same as one with LF', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tsv-'));
    writeFileSync(join(dir, 'lf.tsv'), 'sample_key\tinstrument_run\nS1\trun01\nS2\trun02\n');
    writeFileSync(join(dir, 'crlf.tsv'), 'sample_key\tinstrument_run\r\nS1\trun01\r\nS2\trun02\r\n');
    const expected = [
      { sample_key: 'S1', instrument_run: 'run01' },
      { sample_key: 'S2', instrument_run: 'run02' },
    ];
    expect(readTsv(dir, 'lf.tsv')).toEqual(expected);
    expect(readTsv(dir, 'crlf.tsv')).toEqual(expected);
  });
});
