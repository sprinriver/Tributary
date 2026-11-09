import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { httpCompute } from './compute.ts';

// apps/compute's group summary takes at most 200 groups per request (GroupSummaryRequest, max_length=200).
const MAX = 200;

describe('compute client', () => {
  it('QCD-04: group summaries are sent in batches of at most 200 groups and merged in order (QC panels of thousands of proteins)', async () => {
    const sizes: number[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { groups: { name: string; values: number[] }[] };
      sizes.push(body.groups.length);
      if (body.groups.length > MAX) return new Response('{"detail":"too many groups"}', { status: 422 });
      return Response.json({
        compute_version: 'test',
        groups: body.groups.map((g) => ({
          name: g.name,
          n: g.values.length,
          mean: g.values[0]!,
          sd: null,
          sem: null,
          ci95: null,
          median: g.values[0]!,
          cv: null,
        })),
      });
    }) as typeof fetch;
    const compute = httpCompute(loadConfig({ NODE_ENV: 'test' }), fakeFetch);
    const groups = Array.from({ length: 450 }, (_, i) => ({ name: `P${i}`, values: [i] }));
    const out = await compute.groupSummary({ groups });
    expect(sizes).toEqual([200, 200, 50]);
    expect(out.groups.map((g) => g.name)).toEqual(groups.map((g) => g.name));
    expect(out.compute_version).toBe('test');
  });
});
