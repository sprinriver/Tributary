import type { InitiateUploadResponse } from '@tributary/contracts';
import { describe, expect, it } from 'vitest';
import { uploadFile, type UploadDeps } from './uploader.ts';

const FILE_ID = '0190a000-0000-7000-8000-000000000001';

function fakeDeps(options: { failOnce?: number[]; stored?: number[] } = {}) {
  const puts: number[] = [];
  const failures = new Set(options.failOnce ?? []);
  const memory = new Map<string, string>();
  let completed: { part_number: number; etag: string }[] = [];
  const url = (n: number) => `https://s3.test/part?n=${n}`;
  const deps: UploadDeps = {
    async initiate(body) {
      return {
        file: { id: FILE_ID } as InitiateUploadResponse['file'],
        upload_id: 'u1',
        part_size: 10,
        part_count: Math.ceil(body.size_bytes / 10),
        parts: Array.from({ length: Math.ceil(body.size_bytes / 10) }, (_, i) => ({
          part_number: i + 1,
          url: url(i + 1),
        })),
        expires_at: new Date().toISOString(),
      };
    },
    async listParts() {
      return {
        upload_id: 'u1',
        part_size: 10,
        part_count: 4,
        parts: (options.stored ?? []).map((n) => ({ part_number: n, etag: `"e${n}"`, size_bytes: 10 })),
      };
    },
    async signParts(_id, numbers) {
      return numbers.map((n) => ({ part_number: n, url: url(n) }));
    },
    async putPart(target, blob) {
      const n = Number(new URL(target).searchParams.get('n'));
      expect(blob.size).toBeLessThanOrEqual(10);
      if (failures.delete(n)) throw new Error('network reset');
      puts.push(n);
      return `"e${n}"`;
    },
    async complete(_id, parts) {
      completed = parts;
      return { id: FILE_ID } as never;
    },
    storage: {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    },
    sleep: async () => undefined,
  };
  return { deps, puts, memory, completed: () => completed };
}

const file = (size: number) =>
  Object.assign(new Blob([new Uint8Array(size)]), { name: 'a.raw', lastModified: 1 });

describe('ING-01: browser uploader', () => {
  it('ING-01: uploads every part, retries a failed part, and completes with all ETags', async () => {
    const { deps, puts, completed, memory } = fakeDeps({ failOnce: [2] });
    const progress: number[] = [];
    await uploadFile(
      file(35),
      { versionId: 'v', role: 'raw', onProgress: (loaded) => progress.push(loaded) },
      deps,
    );
    expect(puts.sort()).toEqual([1, 2, 3, 4]);
    expect(completed().map((p) => p.part_number)).toEqual([1, 2, 3, 4]);
    expect(progress.at(-1)).toBe(35);
    expect(memory.size).toBe(0);
  });

  it('ING-01: resumes an interrupted upload, sending only the missing parts', async () => {
    const { deps, puts, memory, completed } = fakeDeps({ stored: [1, 3] });
    memory.set('tributary-upload:v:a.raw:35:1', FILE_ID);
    await uploadFile(file(35), { versionId: 'v', role: 'raw' }, deps);
    expect(puts.sort()).toEqual([2, 4]);
    expect(completed().map((p) => p.etag)).toEqual(['"e1"', '"e2"', '"e3"', '"e4"']);
  });

  it('ING-01: gives up after the retry limit', async () => {
    const { deps } = fakeDeps();
    deps.putPart = async () => {
      throw new Error('offline');
    };
    await expect(uploadFile(file(15), { versionId: 'v', role: 'raw', retries: 2 }, deps)).rejects.toThrow(
      /part 1.*offline/i,
    );
  });
});
