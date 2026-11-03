// Pathway enrichment of a differential-abundance contrast (Phase 24, ENR-03). The API chooses the identifiers
// (hits and background) and records how; apps/compute does the statistics (hypergeometric + BH).
import {
  EnrichmentResultSchema,
  QueryResultSchema,
  type EnrichmentBody,
  type EnrichmentResponse,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import { computeCall } from '../charts/compute.ts';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError, notFound } from '../errors.ts';
import { resolveSource } from '../query/resolve.ts';
import { enrichmentFigure, FIGURE_TERMS } from './figure.ts';

/** A contrast with more rows than this is not a hit list but an error in the request. */
const MAX_ROWS = 500_000;

type Row = {
  contrast_label: string | null;
  gene_names: string[] | null;
  protein_ids: string[] | null;
  log2_fc: number | null;
  adj_p_value: number | null;
};

const asList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : [];

export async function runEnrichment(
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
  request: FastifyRequest,
  body: EnrichmentBody,
): Promise<EnrichmentResponse> {
  const { db, config } = deps;
  const principal = requirePrincipal(request);
  if (body.min_size > body.max_size)
    throw new HttpError(400, 'invalid_size_range', 'min_size must not exceed max_size.', 'min_size');

  const source = await resolveSource(db, { releaseIds: [body.release_id] }, readablePrograms(principal));
  if (!source) throw notFound('Release');
  if (source.kind !== 'differential_abundance')
    throw new HttpError(
      422,
      'wrong_kind',
      'Enrichment needs a differential-abundance release.',
      'release_id',
    );

  const collection = await db
    .selectFrom('gene_set_collection')
    .selectAll()
    .where('id', '=', body.collection_id)
    .where('tenant_id', '=', principal.tenantId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!collection) throw notFound('Gene-set collection');
  const idColumn = collection.id_type === 'gene_symbol' ? 'gene_names' : 'protein_ids';

  const internal = {
    spec: {
      source: { releaseIds: [body.release_id] },
      select: ['contrast_label', 'gene_names', 'protein_ids', 'log2_fc', 'adj_p_value'],
    },
    source,
    joins: [],
    all_rows: MAX_ROWS,
  };
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, config, '/internal/query', internal),
  );
  const all = result.rows as Row[];
  const labels = [...new Set(all.map((r) => r.contrast_label ?? ''))];
  let label = body.contrast_label;
  if (label === undefined) {
    if (labels.length > 1)
      throw new HttpError(
        422,
        'contrast_required',
        `This release has ${labels.length} contrasts: choose one.`,
        'contrast_label',
      );
    label = labels[0] ?? '';
  }
  const rows = all.filter((r) => (r.contrast_label ?? '') === label);
  if (rows.length === 0)
    throw new HttpError(422, 'unknown_contrast', `No rows for contrast "${label}".`, 'contrast_label');

  // Hits: adjusted p ≤ threshold and a fold change in the chosen direction (log2 fold change = numerator vs denominator).
  const isHit = (r: Row) => {
    if (r.adj_p_value === null || r.log2_fc === null || r.adj_p_value > body.adj_p_max) return false;
    if (body.direction === 'up') return r.log2_fc >= body.abs_log2fc_min;
    if (body.direction === 'down') return r.log2_fc <= -body.abs_log2fc_min;
    return Math.abs(r.log2_fc) >= body.abs_log2fc_min;
  };
  const background = new Set<string>();
  const hits = new Set<string>();
  let withoutIds = 0;
  let hitFeatures = 0;
  for (const r of rows) {
    const ids = asList(r[idColumn]);
    if (ids.length === 0) {
      withoutIds += 1;
      continue;
    }
    ids.forEach((id) => background.add(id));
    if (isHit(r)) {
      hitFeatures += 1;
      ids.forEach((id) => hits.add(id));
    }
  }
  if (hits.size === 0)
    throw new HttpError(
      422,
      'no_hits',
      'No feature passes these thresholds: relax them to get a hit list.',
      'abs_log2fc_min',
    );

  const sets = await db
    .selectFrom('gene_set')
    .select(['set_key', 'name', 'members'])
    .where('collection_id', '=', collection.id)
    .where('deleted_at', 'is', null)
    .orderBy('set_key')
    .execute();
  const call = computeCall(config, deps.fetch);
  const out = await call('/stats/enrichment', EnrichmentResultSchema, {
    hits: 'release_id',
    min_size: 'min_size',
    max_size: 'max_size',
  })({
    hits: [...hits],
    background: [...background],
    gene_sets: sets.map((s) => ({ id: s.set_key, name: s.name, members: s.members })),
    min_size: body.min_size,
    max_size: body.max_size,
  });

  const unit = collection.id_type === 'gene_symbol' ? 'gene symbol' : 'UniProt accession';
  return {
    terms: out.terms,
    figure: enrichmentFigure(out.terms, body.adj_p_max),
    provenance: {
      release_id: body.release_id,
      contrast_label: label,
      collection: {
        id: collection.id,
        name: collection.name,
        source: collection.source,
        source_release: collection.source_release,
        id_type: collection.id_type as 'gene_symbol' | 'uniprot_accession',
      },
      thresholds: {
        direction: body.direction,
        adj_p_max: body.adj_p_max,
        abs_log2fc_min: body.abs_log2fc_min,
        min_size: body.min_size,
        max_size: body.max_size,
      },
      features: rows.length,
      hit_features: hitFeatures,
      features_without_ids: withoutIds,
      background: background.size,
      hits: hits.size,
      tested: out.tested,
      excluded_small: out.excluded_small,
      excluded_large: out.excluded_large,
      method: out.method,
      adj_method: out.adj_method,
      transformations: [
        `Protein groups expanded to each ${unit} they contain; an identifier in several groups counts once.`,
        `Background: every ${unit} measured in this contrast (${background.size}); ${withoutIds} features without one were left out.`,
        `Hits: adjusted p ≤ ${body.adj_p_max} and ${
          body.direction === 'both'
            ? '|log2 fold change|'
            : body.direction === 'up'
              ? 'log2 fold change'
              : '−log2 fold change'
        } ≥ ${body.abs_log2fc_min}.`,
        `Dot plot: the top ${FIGURE_TERMS} terms by p-value; x = −log10(adjusted p) (dashed line at ${body.adj_p_max}), size = hits in the set, colour = fold enrichment.`,
        `Gene-set members not measured here are ignored; sets with fewer than ${body.min_size} or more than ${body.max_size} measured members are not tested.`,
      ],
      compute_version: out.compute_version,
    },
  };
}
