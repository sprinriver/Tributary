# 0020 — Search: derived documents in Postgres, OR-ranked full-text, optional embeddings fused by RRF
Date: 2026-11-01 · Status: accepted (the default embedding provider awaits the owner's confirmation)
## Context
SPEC M9 asks for search over every field flagged searchable, with ontology synonyms, facets, strict program
scoping, optional embeddings (`none` by default, `bedrock_titan_v2`, `voyage_4`, `local`) fused with full-text
by reciprocal rank, and reindexing on publish. SPEC §12 question 4 asks which embedding provider is the default
when AI is enabled. The 0002 `experiment_version.search_tsv`/`embedding` columns cover one entity and one
model, and cannot hold samples, facets or more than one provider.
## Decision
- Migration 0015 adds `search_document`: one row per experiment (its latest published or archived version)
  and per sample of that version. Each row holds program, assay type, status, species and compound facet
  columns, title (weight A), subtitle and body (B), and expansions (C). Expansions are the ontology synonyms
  of the terms the entity uses, plus de-hyphenated word forms (K-562 → k562). Drafts and archived experiments
  are not indexed. `search_embedding` holds one vector per document, provider and model, at 1024 dimensions.
  Smaller models are zero-padded, which preserves cosine. The HNSW cosine index uses iterative scans
  (`hnsw.iterative_scan = relaxed_order`, results re-sorted) so program-filtered queries still fill.
- The indexer (`packages/db/src/search-index.ts`) is shared by the seed and the API. Version publish and
  archive, and experiment update, archive and unarchive, reindex the experiment in the same transaction.
  Rows are upserted and stale rows soft-deleted (the app role never deletes). Embeddings are filled after
  commit, best effort. `POST /v1/admin/search/reindex` rebuilds everything and backfills embeddings.
- Queries: each query word (and its de-hyphenated form) is bound as its own `plainto_tsquery` and the parts
  are OR-ed. Results are ranked by the number of query parts matched, then by `ts_rank_cd`. A word with no
  match ("inhibitor") therefore cannot empty the result. The last word also matches as a prefix (for the
  palette). Query phrases of 1–4 words matching a synonym (seed terms and the OLS4 cache) add that term's
  label; the expansions are returned to the caller.
- Program scoping sits inside both sub-queries (`program_id = any(readable)`). Facets are counted over the
  scoped matching set before facet filters. Filters narrow the hits.
- Fusion: RRF with k = 60 (Cormack et al. 2009). Vector hits below cosine 0.3 (`SEARCH_MIN_SIMILARITY`)
  are dropped, because every query has some nearest neighbour.
- Providers: `none` is the default and means full-text only.
  - `voyage_4`: REST, `voyage-4`, `input_type` query/document, `output_dimension`.
  - `bedrock_titan_v2`: `amazon.titan-embed-text-v2:0`, one InvokeModel per text,
    `{inputText, dimensions, normalize: true}`. It needs `@aws-sdk/client-bedrock-runtime`, which awaits
    dependency approval; until then a deployment injects an invoker, and without one, search answers with
    full-text only.
  - `local`: apps/compute `/embed`, a signed feature-hashing embedder over words and character trigrams.
    It is lexical and deterministic, not a semantic model, and exists so the hybrid path runs offline and in
    tests. A real local model needs a dependency approval.
- Proposed default when AI is enabled: `bedrock_titan_v2`. Inference stays inside the customer's AWS account,
  there is no new vendor or data-processing agreement, and it uses the same IAM model as the rest of the
  install. `voyage_4` is opt-in, because text leaves the account.
## Alternatives considered
- `websearch_to_tsquery` (AND semantics): "HEK293 inhibitor 24 hours" returns nothing, because no record says
  "inhibitor".
- A database trigger building the documents: synonym lookup, field definitions and compound names make it
  much harder to test than TypeScript.
- OpenSearch: excluded by ADR-001 at this scale.
- Facets over the filtered set: hides the other values, so a user cannot widen a filter.
## Consequences
Full-text alone meets the golden-query bar (12 queries, top-3). Embeddings are an enhancement, not a
dependency. Documents are derived, so a reindex can always rebuild them. Sample documents grow with every
published version (soft-deleted rows stay). Pre-enable checks for Titan: the request and response fields were
written from model knowledge, because the Bedrock documentation host is unreachable from the build container.
Verify them against the user guide before enabling in a customer account. The 0002 `experiment_version.embedding`
column and its index are unused, kept because committed migrations are not edited and dropping them gains
little.
## Revisit when
More than ~10⁷ documents (ADR-001's OpenSearch threshold); a customer asks for semantic search without AI
enabled (pick and approve a local model); or the owner prefers Voyage as the default.
