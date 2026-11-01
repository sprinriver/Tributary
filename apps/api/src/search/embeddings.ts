import { EmbedResponseSchema } from '@tributary/contracts';
import type { SearchConfig } from '../config.ts';

export type InputType = 'query' | 'document';

/** Turns texts into unit-length vectors of `dims` numbers. */
export interface EmbeddingProvider {
  kind: Exclude<SearchConfig['provider'], 'none'>;
  model: string;
  dims: number;
  embed(texts: string[], inputType: InputType): Promise<number[][]>;
}

export type InvokeBedrock = (modelId: string, body: Record<string, unknown>) => Promise<unknown>;

export interface EmbeddingDeps {
  fetch: typeof fetch;
  computeUrl?: string;
  invokeBedrock?: InvokeBedrock;
}

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-4';
const TITAN_MODEL = 'amazon.titan-embed-text-v2:0';

function checked(vectors: number[][], dims: number | null, count: number, who: string): number[][] {
  if (vectors.length !== count)
    throw new Error(`${who} returned ${vectors.length} embeddings for ${count} texts`);
  for (const v of vectors) {
    if (dims !== null && v.length !== dims)
      throw new Error(`${who} returned dimension ${v.length}, expected ${dims}`);
    if (!v.every(Number.isFinite)) throw new Error(`${who} returned a non-finite value`);
  }
  return vectors;
}

/**
 * Bedrock InvokeModel needs `@aws-sdk/client-bedrock-runtime`, which is not yet an approved dependency (ADR 0020).
 * Until it is, a deployment passes its own invoker (`EmbeddingDeps.invokeBedrock`); without one, embedding fails
 * and search answers with full-text only.
 */
const bedrockUnavailable: InvokeBedrock = () =>
  Promise.reject(
    new Error('bedrock_titan_v2 needs @aws-sdk/client-bedrock-runtime (pending dependency approval)'),
  );

/** The configured provider, or null for `none` (full-text only). */
export function embeddingProvider(config: SearchConfig, deps: EmbeddingDeps): EmbeddingProvider | null {
  const dims = config.dims;
  switch (config.provider) {
    case 'none':
      return null;
    case 'voyage_4':
      // https://docs.voyageai.com/reference/embeddings-api — input_type query/document; output_dimension
      // 256, 512, 1024 (default) or 2048 for voyage-4.
      return {
        kind: 'voyage_4',
        model: VOYAGE_MODEL,
        dims,
        async embed(texts, inputType) {
          const res = await deps.fetch(VOYAGE_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${config.voyageApiKey ?? ''}`,
            },
            body: JSON.stringify({
              input: texts,
              model: VOYAGE_MODEL,
              input_type: inputType,
              output_dimension: dims,
            }),
          });
          if (!res.ok) throw new Error(`Voyage embeddings failed (HTTP ${res.status})`);
          const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
          const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
          return checked(vectors, dims, texts.length, 'Voyage');
        },
      };
    case 'bedrock_titan_v2': {
      // Amazon Titan Text Embeddings V2: one text per InvokeModel call; dimensions 256, 512 or 1024; normalize.
      // Request/response fields per the Bedrock user guide (model-parameters-titan-embed-text); not verifiable
      // from the build container (ADR 0020 lists this as a pre-enable check).
      const invoke = deps.invokeBedrock ?? bedrockUnavailable;
      return {
        kind: 'bedrock_titan_v2',
        model: TITAN_MODEL,
        dims,
        async embed(texts) {
          const vectors: number[][] = [];
          for (const text of texts) {
            const out = (await invoke(TITAN_MODEL, {
              inputText: text,
              dimensions: dims,
              normalize: true,
            })) as {
              embedding?: number[];
            };
            if (!out.embedding) throw new Error('Titan returned no embedding');
            vectors.push(out.embedding);
          }
          // Dimension is checked where vectors are stored or queried (`toStored`).
          return checked(vectors, null, texts.length, 'Titan');
        },
      };
    }
    case 'local':
      // apps/compute /embed: deterministic hashing embedder (lexical, not semantic; see ADR 0020).
      return {
        kind: 'local',
        model: 'hashing-ngram-v1',
        dims,
        async embed(texts) {
          const res = await deps.fetch(`${deps.computeUrl ?? ''}/embed`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ texts, dims }),
          });
          if (!res.ok) throw new Error(`Local embeddings failed (HTTP ${res.status})`);
          const body = EmbedResponseSchema.parse(await res.json());
          if (body.dims !== dims)
            throw new Error(`apps/compute returned dimension ${body.dims}, expected ${dims}`);
          return checked(body.embeddings, dims, texts.length, 'apps/compute');
        },
      };
  }
}

/** Stored vectors are 1024-wide; zero-padding a shorter unit vector keeps its cosine similarity to others. */
export const STORED_DIMS = 1024;
export function toStored(v: number[], dims: number): string {
  if (v.length !== dims) throw new Error(`embedding has dimension ${v.length}, expected ${dims}`);
  if (dims > STORED_DIMS) throw new Error(`embedding dimension ${dims} exceeds the stored ${STORED_DIMS}`);
  const padded = v.length < STORED_DIMS ? [...v, ...new Array<number>(STORED_DIMS - v.length).fill(0)] : v;
  return `[${padded.join(',')}]`;
}
