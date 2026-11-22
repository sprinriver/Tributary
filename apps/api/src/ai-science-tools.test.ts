import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The science tools reach both the assistant and MCP clients through the one registry; called here over MCP with
// personal access tokens, as an IDE or Claude Desktop would.
const LABELS = ['126', '127L', '127H', '128L', '128H', '129L', '129H', '130L', '130H', '131L'];
const TEMPS = [37, 41, 44, 47, 50, 53, 56, 59, 63, 67];

describe('science tools for the assistant and MCP', () => {
  let t: TestApi;
  let token: string;
  let outsider: string;

  const rpc = async (token: string, method: string, params: Json = {}) => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      payload: { jsonrpc: '2.0', id: 1, method, params },
    });
    return JSON.parse(res.body) as Json;
  };
  const call = async (as: string, name: string, args: Json) => {
    const body = await rpc(as, 'tools/call', { name, arguments: args });
    return { result: body.result as Json, json: JSON.parse(body.result.content[0].text as string) as Json };
  };

  beforeAll(async () => {
    t = await startTestApi({
      s3: true,
      query: true,
      config: { ai: { provider: 'stub', model: 'stub-1', monthlyTokenBudget: 1_000_000 } },
    });
    const program = await t.program('AIS');
    const other = await t.program('AIX');
    token = (await t.user('ais-user', { [program]: 'contributor' })).token;
    outsider = (await t.user('ais-outsider', { [other]: 'viewer' })).token;
    await publishedDaRelease(t, token, program, 'CPD-000001 profiling', {
      file: '../ONC-DIA-01/curves.txt',
      importer: 'curvecurator',
      importOptions: {
        compound_id: 'CPD-000001',
        doses: [0, 1, 10, 100, 1000, 10000],
        dose_scale: 1e-9,
        dose_unit: 'M',
      },
      extra: [
        {
          file: '../../tools/tpp/tr_results.tsv',
          importer: 'tpp_tr',
          datasetName: 'CPD-000001 TPP-TR',
          importOptions: {
            compound_id: 'CPD-000001',
            feature_type: 'gene',
            temperatures: Object.fromEntries(LABELS.map((l, i) => [l, TEMPS[i]])),
          },
        },
        {
          file: '../../tools/maxquant/Phospho_STY_Sites.txt',
          importer: 'maxquant_sites',
          datasetName: 'Phosphosites',
        },
      ],
    });
    for (const [name, file] of [
      ['Compound targets', 'compound_targets.tsv'],
      ['Protein annotations', 'target_annotations.tsv'],
    ])
      await publishedDaRelease(t, token, program, name!, {
        file: `../../reference/${file}`,
        importer: 'reference_target_annotation',
      });
  }, 300_000);
  afterAll(() => t.close());

  it('AI-06: the three science tools are listed as read tools', async () => {
    const tools = (await rpc(token, 'tools/list')).result.tools as Json[];
    for (const name of ['get_target_evidence', 'get_compound_selectivity', 'get_protein_sites']) {
      const tool = tools.find((x) => x.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it('AI-06: get_target_evidence returns a compact per-protein summary with the notes and a link', async () => {
    const { result, json } = await call(token, 'get_target_evidence', { compound_id: 'CPD-000001' });
    expect(result.isError).toBeFalsy();
    expect(json.page).toBe('/compounds/CPD-000001');
    expect(json.notes.join(' ')).toMatch(/no combined score/i);
    expect(json.proteins.length).toBeLessThanOrEqual(25);
    expect(json.total_proteins).toBeGreaterThanOrEqual(json.proteins.length);
    expect(json.proteins.find((p: Json) => p.gene === 'TP53')).toMatchObject({
      accession: 'P04637',
      annotation: 'primary_target',
      dose: 'tested, not regulated (1 dataset)',
      thermal: expect.stringContaining('stabilised'),
      lines: { thermal: true, annotation: true, dose: false },
    });
    const outside = await call(outsider, 'get_target_evidence', { compound_id: 'CPD-000001' });
    expect(outside.json.proteins).toEqual([]);
  });

  it('AI-06: get_compound_selectivity and get_protein_sites summarise the pages with their caveats', async () => {
    const sel = (await call(token, 'get_compound_selectivity', { compound_id: 'CPD-000001' })).json;
    expect(sel).toMatchObject({ tested: 138, regulated: 16, page: '/compounds/CPD-000001' });
    expect(sel.s_score).toBeCloseTo(sel.s_regulated / 138, 10);
    expect(sel.notes.join(' ')).toMatch(/not a binding constant/);
    expect(sel.top.length).toBeLessThanOrEqual(10);
    const sites = (await call(token, 'get_protein_sites', { accession: 'P31749' })).json;
    expect(sites.page).toBe('/proteins/P31749');
    expect(sites.sites.map((s: Json) => s.site_id)).toEqual(['P31749_T403', 'P31749_S473']);
    expect(sites.notes.join(' ')).toMatch(/display threshold/);
    expect((await call(outsider, 'get_protein_sites', { accession: 'P31749' })).json.sites).toEqual([]);
  });

  it('AI-06: the assistant (stub model) answers a target question with the evidence tool and its caveat', async () => {
    const conv = (
      await t.call(token, { method: 'POST', url: '/v1/ai/conversations', payload: {} })
    ).json() as Json;
    const res = await t.call(token, {
      method: 'POST',
      url: `/v1/ai/conversations/${conv.id}/messages`,
      payload: { text: 'Which targets does CPD-000001 engage?' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const text = JSON.stringify(res.json());
    expect(text).toContain('get_target_evidence');
    expect(text).toMatch(/no combined score/i);
  });
});
