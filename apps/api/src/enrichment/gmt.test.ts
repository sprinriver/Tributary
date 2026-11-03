import { describe, expect, it } from 'vitest';
import { parseGmt } from './gmt.ts';

describe('GMT gene-set files', () => {
  it('ENR-02: each line is id, description, then members; duplicates and blank lines are dropped', () => {
    const text = [
      'R-HSA-1\tCell cycle\tCDK1\tCCNB1\tCDK1',
      '',
      'GO:0006915\thttp://example.org/go/0006915\tCASP3\tBAX\t',
    ].join('\r\n');
    expect(parseGmt(text)).toEqual({
      sets: [
        { id: 'R-HSA-1', name: 'Cell cycle', members: ['CDK1', 'CCNB1'] },
        // A URL in the description column is not a name: the id stands in.
        { id: 'GO:0006915', name: 'GO:0006915', members: ['CASP3', 'BAX'] },
      ],
      errors: [],
    });
  });

  it('ENR-02: malformed lines are reported with their line numbers, never guessed', () => {
    const { sets, errors } = parseGmt('A\tSet A\tX\nB\tonly two fields\nA\tSet A again\tY\n');
    expect(sets.map((s) => s.id)).toEqual(['A']);
    expect(errors).toEqual([
      { line: 2, message: 'Needs an id, a description and at least one member.' },
      { line: 3, message: 'Duplicate set id "A".' },
    ]);
  });
});
