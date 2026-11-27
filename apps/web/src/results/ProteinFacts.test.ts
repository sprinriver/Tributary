import { describe, expect, it } from 'vitest';
import { shortText } from './ProteinFacts.tsx';

describe('protein facts', () => {
  it('UNI-02: short text is shown whole; long text is cut at a sentence end, never mid-word', () => {
    expect(shortText('Kinase in growth signalling.')).toBeNull();
    const sentence = 'Phosphorylates many substrates in growth signalling. ';
    const long = sentence.repeat(20);
    const cut = shortText(long)!;
    expect(cut.length).toBeLessThanOrEqual(360);
    expect(cut.endsWith('signalling.')).toBe(true);
    expect(long.startsWith(cut)).toBe(true);
  });

  it('UNI-02: long text without a sentence end is cut with an ellipsis', () => {
    const cut = shortText('x'.repeat(1000))!;
    expect(cut).toBe(`${'x'.repeat(360)}…`);
  });
});
