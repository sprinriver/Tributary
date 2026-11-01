import { describe, expect, it } from 'vitest';
import { embeddingProvider } from './embeddings.ts';
import { reciprocalRankFusion } from './fusion.ts';
import { queryTerms } from './terms.ts';

describe('search building blocks', () => {
  it('SRCH-02: reciprocal-rank fusion sums 1/(k + rank) over the lists that contain a document', () => {
    // Cormack, Clarke & Büttcher 2009, doi:10.1145/1571941.1572114 (k = 60).
    const fused = reciprocalRankFusion({ fulltext: ['a', 'b', 'c'], vector: ['c', 'a', 'd'] }, 60);
    expect(fused.map((f) => f.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(fused[0]).toEqual({ id: 'a', score: 1 / 61 + 1 / 62, ranks: { fulltext: 1, vector: 2 } });
    expect(fused[3]).toEqual({ id: 'd', score: 1 / 63, ranks: { fulltext: null, vector: 3 } });
    // Ties keep the full-text order.
    const ties = reciprocalRankFusion({ fulltext: ['x', 'y'], vector: ['y', 'x'] }, 60);
    expect(ties.map((f) => f.id)).toEqual(['x', 'y']);
  });

  it('SRCH-01: query terms are lower-cased words plus their de-hyphenated forms, never raw SQL', () => {
    expect(queryTerms('HEK293 inhibitor 24 hours')).toEqual(['hek293', 'inhibitor', '24', 'hours']);
    expect(queryTerms('K-562  RNA-seq')).toEqual(['k-562', 'k562', 'rna-seq', 'rnaseq']);
    expect(queryTerms("'); drop table x; --")).toEqual(['drop', 'table', 'x']);
    expect(queryTerms('a'.repeat(300)).every((t) => t.length <= 64)).toBe(true);
  });

  it('SRCH-02: provider "none" embeds nothing', async () => {
    expect(embeddingProvider({ provider: 'none', dims: 1024, minSimilarity: 0.3 }, { fetch })).toBeNull();
  });

  it('SRCH-02: Voyage 4 sends query/document input types and the configured output dimension', async () => {
    const sent: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        auth: new Headers(init.headers).get('authorization'),
      });
      return Response.json({ data: [{ index: 0, embedding: [0.6, 0.8] }], model: 'voyage-4' });
    }) as unknown as typeof fetch;
    const provider = embeddingProvider(
      { provider: 'voyage_4', dims: 2, minSimilarity: 0.3, voyageApiKey: 'k' },
      { fetch: fakeFetch },
    )!;
    expect(await provider.embed(['HEK293'], 'query')).toEqual([[0.6, 0.8]]);
    expect(sent[0]).toEqual({
      url: 'https://api.voyageai.com/v1/embeddings',
      body: { input: ['HEK293'], model: 'voyage-4', input_type: 'query', output_dimension: 2 },
      auth: 'Bearer k',
    });
    expect(provider.model).toBe('voyage-4');
  });

  it('SRCH-02: Titan Text Embeddings V2 on Bedrock is invoked once per text with dimensions and normalisation', async () => {
    const bodies: Record<string, unknown>[] = [];
    const invoke = async (modelId: string, body: Record<string, unknown>) => {
      expect(modelId).toBe('amazon.titan-embed-text-v2:0');
      bodies.push(body);
      return { embedding: [1, 0] };
    };
    const provider = embeddingProvider(
      { provider: 'bedrock_titan_v2', dims: 256, minSimilarity: 0.3 },
      { fetch, invokeBedrock: invoke },
    )!;
    expect(await provider.embed(['a', 'b'], 'document')).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(bodies).toEqual([
      { inputText: 'a', dimensions: 256, normalize: true },
      { inputText: 'b', dimensions: 256, normalize: true },
    ]);
  });

  it('SRCH-02: the local provider calls apps/compute and checks the returned dimension', async () => {
    const fakeFetch = (async () =>
      Response.json({ model: 'hashing-x', dims: 3, embeddings: [[1, 0, 0]] })) as unknown as typeof fetch;
    const provider = embeddingProvider(
      { provider: 'local', dims: 4, minSimilarity: 0.3 },
      { fetch: fakeFetch, computeUrl: 'http://compute' },
    )!;
    await expect(provider.embed(['a'], 'document')).rejects.toThrow(/dimension/);
  });
});
