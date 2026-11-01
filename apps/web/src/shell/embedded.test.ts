import { describe, expect, it } from 'vitest';
import { isEmbedded } from './embedded.ts';

describe('embedded frame detection', () => {
  it('OSS-01: the app knows when it runs inside a frame (e.g. a Hugging Face Space page)', () => {
    const top = {};
    expect(isEmbedded({ self: top, top })).toBe(false);
    expect(isEmbedded({ self: {}, top })).toBe(true);
    // A cross-origin parent can throw on access: treat it as embedded.
    const crossOrigin = {
      self: {},
      get top(): unknown {
        throw new Error('SecurityError');
      },
    };
    expect(isEmbedded(crossOrigin)).toBe(true);
  });
});
