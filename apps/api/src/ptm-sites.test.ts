import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Synthetic MaxQuant site table (fixtures/tools/maxquant/Phospho_STY_Sites.txt), six ONC-DIA-05 samples:
// AKT1 (P31749) has T757 (localisation 0.860) and S473 (0.800), both quantified in all six samples.
// TP53 (P04637) has T138 (0.978; also PTEN P60484 at position 101), S365 (0.316) and Y475 (0.849, quantified in
// four samples). A reverse and a contaminant row are removed on import.
const SITES = '../../tools/maxquant/Phospho_STY_Sites.txt';

describe('modification sites API', () => {
  let t: TestApi;
  let token: string;
  let outsider: string;
  let release: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    const program = await t.program('PTM');
    const other = await t.program('PTX');
    token = (await t.user('ptm-user', { [program]: 'contributor' })).token;
    outsider = (await t.user('ptm-outsider', { [other]: 'viewer' })).token;
    release = (
      await publishedDaRelease(t, token, program, 'Phosphoproteome', {
        file: SITES,
        importer: 'maxquant_sites',
      })
    ).release;
  }, 300_000);
  afterAll(() => t.close());

  const get = (url: string, as = token) => t.call(as, { method: 'GET', url });

  it('PTM-03: the sites of a protein: residue, position, best localisation and samples quantified, by release', async () => {
    const res = await get('/v1/proteins/P31749/sites');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.loc_min).toBe(0.75);
    expect(body.releases).toHaveLength(1);
    expect(body.releases[0]).toMatchObject({
      release_id: release,
      experiment_name: 'Phosphoproteome',
      method: 'MaxQuant',
      samples: 6,
    });
    expect(body.sites.map((s: Json) => s.site_id)).toEqual(['P31749_S473', 'P31749_T757']); // by position
    expect(body.sites[0]).toMatchObject({
      release_id: release,
      amino_acid: 'S',
      position: 473,
      modification: 'Phospho (STY)',
      samples_quantified: 6,
      samples_total: 6,
      meets_threshold: true,
      shared_with: [],
    });
    expect(body.sites[0].localization_prob).toBeCloseTo(0.800479, 6);
    expect(body.figure.data[0].type).toBe('scatter');
    expect(body.notes.join(' ')).toMatch(/0\.75 is a display threshold/);
  });

  it('PTM-03: the threshold is a display choice: sites below it are listed and marked, not dropped', async () => {
    const tp53 = (await get('/v1/proteins/P04637/sites')).json() as Json;
    expect(tp53.sites.map((s: Json) => [s.site_id, s.meets_threshold])).toEqual([
      ['P04637_T138', true],
      ['P04637_S365', false],
      ['P04637_Y475', true],
    ]);
    expect(tp53.sites.find((s: Json) => s.site_id === 'P04637_Y475').samples_quantified).toBe(4);
    const strict = (await get('/v1/proteins/P04637/sites?loc_min=0.9')).json() as Json;
    expect(strict.sites.filter((s: Json) => s.meets_threshold).map((s: Json) => s.site_id)).toEqual([
      'P04637_T138',
    ]);
    const bad = await get('/v1/proteins/P04637/sites?loc_min=1.5');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ field: 'loc_min' });
  });

  it('PTM-03: a site on several proteins appears on each, at that protein’s position', async () => {
    const pten = (await get('/v1/proteins/P60484/sites')).json() as Json;
    const shared = pten.sites.find((s: Json) => s.site_id === 'P04637_T138');
    expect(shared).toMatchObject({ position: 101, shared_with: ['P04637'] });
  });

  it('PTM-03: the summary of a site release counts sites, sites meeting the threshold and sites per sample', async () => {
    const res = await get(`/v1/ptm-sites/summary?release_id=${release}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body).toMatchObject({
      release_id: release,
      modification: 'Phospho (STY)',
      sites: 41,
      loc_min: 0.75,
    });
    expect(body.meeting_threshold).toBeLessThan(41);
    expect(body.per_sample).toHaveLength(6);
    expect(body.per_sample[0]).toMatchObject({ sample_key: 'ONC-DIA-05-S01' });
    expect(body.per_sample[0].sites_quantified).toBeGreaterThan(30);
    expect(body.top).toHaveLength(Math.min(25, body.sites));
  });

  it('PTM-03: only readable releases count', async () => {
    expect(((await get('/v1/proteins/P31749/sites', outsider)).json() as Json).sites).toEqual([]);
    expect((await get(`/v1/ptm-sites/summary?release_id=${release}`, outsider)).statusCode).toBe(404);
  });
});
