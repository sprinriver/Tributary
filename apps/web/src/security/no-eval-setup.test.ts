import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createH264MP4Encoder } from './no-mp4-encoder.ts';
import './no-eval-setup.ts';

describe('no string evaluation in the browser', () => {
  it('SEC-01: zod never probes for eval (jitless), so the CSP reports nothing', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('SEC-01: Mol* movie export (an Emscripten encoder that needs eval) is replaced by a clear refusal', async () => {
    await expect(createH264MP4Encoder()).rejects.toThrow(/Movie export is not available/);
  });
});
