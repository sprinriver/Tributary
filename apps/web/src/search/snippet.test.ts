import { describe, expect, it } from 'vitest';
import { joinList, snippetParts, splitList } from './snippet.ts';

describe('search snippets', () => {
  it('SRCH-03: matches are highlighted from markers, and markup in the text stays text', () => {
    expect(snippetParts('in \u0001HEK293\u0002 cells <b>x</b>')).toEqual([
      { text: 'in ', mark: false },
      { text: 'HEK293', mark: true },
      { text: ' cells <b>x</b>', mark: false },
    ]);
    expect(snippetParts('plain')).toEqual([{ text: 'plain', mark: false }]);
    expect(snippetParts('\u0001a\u0002\u0001b\u0002')).toEqual([
      { text: 'a', mark: true },
      { text: 'b', mark: true },
    ]);
  });

  it('SRCH-03: facet filters round-trip through the URL', () => {
    expect(splitList(joinList(['rnaseq', 'crispr_screen']))).toEqual(['rnaseq', 'crispr_screen']);
    expect(joinList([])).toBeUndefined();
    expect(splitList(undefined)).toEqual([]);
  });
});
