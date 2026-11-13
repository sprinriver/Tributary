// Pathway enrichment of a differential-abundance contrast (Phase 24, ENR-03). The API chooses the identifiers
// (select.ts) and records how; apps/compute does the statistics (hypergeometric + BH).
import { EnrichmentResultSchema, type EnrichmentBody, type EnrichmentResponse } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import { computeCall } from '../charts/compute.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, notFound } from '../errors.ts';
import { resolveSource } from '../query/resolve.ts';
import { enrichmentFigure, FIGURE_TERMS, TERM_FDR } from './figure.ts';
import { normaliseId, type IdType } from './ids.ts';
import { readContrastRows } from './rows.ts';
import { selectIds } from './select.ts';

async function experimentSpecies(db: Database, releaseId: string): Promise<string | null> {
  const row = await db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .leftJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
    .select('v.species')
    .where('r.id', '=', releaseId)
    .executeTakeFirst();
  const species = row?.species as { id?: string } | null | undefined;
  return species?.id ?? null;
}

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
  const idType = collection.id_type as IdType;
  const species = await experimentSpecies(db, body.release_id);
  if (species && species !== collection.species)
    throw new HttpError(
      422,
      'species_mismatch',
      `The experiment is ${species} but these gene sets are ${collection.species}: choose a collection for the same species.`,
      'collection_id',
    );

  const { rows: all, label } = await readContrastRows(deps, source, body.release_id, body.contrast_label);

  const sel = selectIds(all, idType, body);
  const sets = (
    await db
      .selectFrom('gene_set')
      .select(['set_key', 'name', 'members'])
      .where('collection_id', '=', collection.id)
      .where('deleted_at', 'is', null)
      .orderBy('set_key')
      .execute()
  ).map((s) => ({
    id: s.set_key,
    name: s.name,
    members: [...new Set(s.members.map((m) => normaliseId(m, idType)))],
  }));
  const annotated = new Set(sets.flatMap((s) => s.members));
  const backgroundAnnotated = [...sel.background].filter((id) => annotated.has(id));
  const background = body.universe === 'annotated' ? backgroundAnnotated : [...sel.background];
  const hits =
    body.universe === 'annotated' ? [...sel.hits].filter((id) => annotated.has(id)) : [...sel.hits];
  if (hits.length === 0)
    throw new HttpError(
      422,
      'no_hits',
      'No feature passes these thresholds: relax them to get a hit list.',
      'abs_log2fc_min',
    );

  const call = computeCall(config, deps.fetch);
  const out = await call('/stats/enrichment', EnrichmentResultSchema, {
    hits: 'adj_p_max',
    min_size: 'min_size',
    max_size: 'max_size',
  })({ hits, background, gene_sets: sets, min_size: body.min_size, max_size: body.max_size });

  const unit = idType === 'gene_symbol' ? 'gene symbol' : 'UniProt accession';
  const methods = sel.adjMethods.length ? sel.adjMethods.join(', ') : 'not recorded';
  const rule =
    body.direction === 'both'
      ? '|log2 fold change|'
      : body.direction === 'up'
        ? 'log2 fold change'
        : '−log2 fold change';
  return {
    terms: out.terms,
    hit_genes: hits.sort().map((id) => ({ id, ...sel.hitGenes.get(id)! })),
    figure: enrichmentFigure(out.terms, body.adj_p_max),
    provenance: {
      release_id: body.release_id,
      contrast_label: label,
      collection: {
        id: collection.id,
        name: collection.name,
        source: collection.source,
        source_release: collection.source_release,
        id_type: idType,
      },
      thresholds: {
        direction: body.direction,
        adj_p_max: body.adj_p_max,
        abs_log2fc_min: body.abs_log2fc_min,
        min_size: body.min_size,
        max_size: body.max_size,
        term_fdr: TERM_FDR,
      },
      features: sel.features,
      hit_features: sel.hitFeatures,
      features_without_ids: sel.withoutIds,
      untested_features: sel.untested,
      multi_id_hit_features: sel.multiIdHitFeatures,
      conflicting_ids: sel.conflictingIds,
      universe: body.universe,
      background_annotated: backgroundAnnotated.length,
      source_adj_methods: sel.adjMethods,
      background: background.length,
      hits: hits.length,
      tested: out.tested,
      excluded_small: out.excluded_small,
      excluded_large: out.excluded_large,
      method: out.method,
      adj_method: out.adj_method,
      transformations: [
        `Protein groups expanded to each ${unit} they contain (an identifier in several groups counts once; ${sel.multiIdHitFeatures} hit features held more than one, and ${sel.conflictingIds} identifiers were a hit in one group but not in another and count as hits).`,
        ...(idType === 'uniprot_accession'
          ? ['UniProt isoform suffixes removed ("P12345-2" → "P12345") before matching.']
          : []),
        `Universe (${body.universe}): every ${unit} the source tool tested in this contrast${
          body.universe === 'annotated' ? ' that is in at least one gene set' : ''
        } (${background.length}; ${backgroundAnnotated.length} are in a set). Left out: ${sel.untested} untested features (no adjusted p or fold change) and ${sel.withoutIds} without a ${unit}.`,
        `Hits: source adjusted p (${methods}) ≤ ${body.adj_p_max}, then a post-hoc ${rule} ≥ ${body.abs_log2fc_min} (a strict sign test for up or down).`,
        `Gene-set members not tested here are ignored; sets with fewer than ${body.min_size} or more than ${body.max_size} members in the universe are not tested.`,
        `Species: ${species ?? 'not recorded for the experiment'}; collection ${collection.species}.`,
        `Dot plot: the top ${FIGURE_TERMS} terms by p-value; x = −log10(term adjusted p), dashed line at term FDR ${TERM_FDR}; size = hits in the set; colour = fold enrichment (k/n)/(K/N).`,
      ],
      compute_version: out.compute_version,
    },
  };
}
