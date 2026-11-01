import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadQueryConfig } from './config.ts';
import { Objects } from './objects.ts';

describe('release object cache', () => {
  it('QRY-05: concurrent reads of one release share a single download (no .partial rename race)', async () => {
    const objects = new Objects(
      loadQueryConfig({ NODE_ENV: 'test' }),
      mkdtempSync(join(tmpdir(), 'objects-')),
    );
    let calls = 0;
    // A slow body, so both requests are in flight together (as charts and tables on one page are).
    (objects.client as unknown as { send: () => Promise<unknown> }).send = async () => {
      calls++;
      return {
        Body: Readable.from(
          (async function* () {
            yield Buffer.from('PAR1');
            await new Promise((r) => setTimeout(r, 30));
            yield Buffer.from('rest');
          })(),
        ),
      };
    };
    const paths = await Promise.all([1, 2, 3].map(() => objects.cached('b', 'k', 'abc')));
    expect(new Set(paths).size).toBe(1);
    expect(readFileSync(paths[0]!, 'utf8')).toBe('PAR1rest');
    expect(calls).toBe(1);
  });
});
