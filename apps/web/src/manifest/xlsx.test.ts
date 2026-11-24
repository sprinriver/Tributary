import { describe, expect, it } from 'vitest';
import { sheetToTable, tableToSheet } from './xlsx.ts';

describe('Excel sample sheets', () => {
  it('XLS-01: the first row is the header; numbers keep their stored text; booleans and blanks become text', () => {
    const t = sheetToTable('samples', [
      ['sample_key', ' condition ', 'dose', 'replicate', 'flag'],
      ['S1', 'DMSO', '0.1', '1', true],
      ['S2', 'CPD-1', '1e-6', null, false],
      [null, null, null, null, null], // empty rows are skipped
    ]);
    expect(t.fields).toEqual(['sample_key', 'condition', 'dose', 'replicate', 'flag']);
    expect(t.rows).toEqual([
      { sample_key: 'S1', condition: 'DMSO', dose: '0.1', replicate: '1', flag: 'TRUE' },
      { sample_key: 'S2', condition: 'CPD-1', dose: '1e-6', replicate: '', flag: 'FALSE' },
    ]);
    expect(t.delimiter).toBe('xlsx');
    expect(t.warnings).toEqual([]);
  });

  it('XLS-01: date cells become ISO dates and are flagged (Excel turns names like SEPT1 into dates)', () => {
    const t = sheetToTable('Sheet1', [
      ['sample_key', 'gene', 'collected'],
      ['S1', new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 9, 3, 14, 30))],
    ]);
    expect(t.rows[0]).toEqual({ sample_key: 'S1', gene: '2026-09-01', collected: '2026-10-03T14:30:00Z' });
    expect(t.warnings.join(' ')).toMatch(/gene.*collected.*dates/);
  });

  it('XLS-01: duplicate and unnamed columns are reported, never silently merged or dropped', () => {
    const t = sheetToTable('samples', [
      ['sample_key', 'well', 'well', null],
      ['S1', 'A01', 'B01', 'stray'],
    ]);
    expect(t.fields).toEqual(['sample_key', 'well', 'well (2)']);
    expect(t.rows[0]).toEqual({ sample_key: 'S1', well: 'A01', 'well (2)': 'B01' });
    expect(t.warnings.join(' ')).toMatch(/"well" appears twice/);
    expect(t.warnings.join(' ')).toMatch(/column 4 has no header.*1 value/);
  });

  it('XLS-02: an export writes every cell as text, in the given column order', () => {
    const sheet = tableToSheet(
      ['sample_key', 'gene'],
      [{ sample_key: 'S1', gene: 'SEPT1' }, { sample_key: 'S2' }],
    );
    expect(sheet[0]).toEqual([
      { value: 'sample_key', type: String, fontWeight: 'bold' },
      { value: 'gene', type: String, fontWeight: 'bold' },
    ]);
    expect(sheet[1]).toEqual([
      { value: 'S1', type: String },
      { value: 'SEPT1', type: String },
    ]);
    expect(sheet[2]![1]).toEqual({ value: '', type: String });
  });
});
