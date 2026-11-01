# 0021 — Lineage from one view (recorded edges ∪ foreign keys), walked by recursive CTE; audit viewer scope
Date: 2026-11-01 · Status: accepted
## Context
SPEC M10 asks for a lineage graph of any file, run, release, chart or AI artifact, with upstream/downstream and
depth control. It also asks for an audit viewer with filters and CSV export, and a per-entity history tab.
`lineage_edge` rows were written only when a pipeline run collected its outputs. Manual imports, releases and
saved charts had no edges.
## Decision
- Migration 0016 adds the view `lineage.link (from_kind, from_id, relation, to_kind, to_id)` in its own schema.
  It is the union of the recorded `lineage_edge` rows and the relations that foreign keys already state:
  - file → release (`input_to`)
  - experiment version → release (`describes`)
  - experiment version → run (`input_to`)
  - run → file (`produced`)
  - release → saved chart (`input_to`), taken from the view's QuerySpec source and joins.
- A launch also records the run's inputs explicitly: the experiment version, and its raw files that passed QC or
  were overridden. The run is launched for that version's data; the demo pipeline reads fixture paths, which
  are not registered files.
- `GET /v1/lineage` walks the view with one recursive CTE per direction. Depth runs 1–6, and a path array
  guards against cycles. The response holds at most 200 nodes.
- Permissions: the root must be readable (otherwise 404). Other nodes are kept when they belong to the caller's
  programs, or are their own saved charts, or are program charts of their programs. Unreadable nodes and their
  edges are dropped silently, without a count, so private charts are not revealed.
- Audit viewer (`GET /v1/audit`, CSV `GET /v1/audit/export`) is for system admins: audit rows carry no program,
  and many are tenant-wide. Everyone else sees the history of entities they can read
  (`GET /v1/history/{type}/{id}`; an experiment includes its versions).
  - CSV follows RFC 4180 and neutralises spreadsheet formulas: a leading = + - @ tab or CR gets a `'` prefix
    (OWASP CSV injection).
  - The export itself writes an `audit.export` row.
- The graph is drawn as layered SVG in the app (columns by step from the entity), with a table alternative.
  No graph library was added, so there is no licence to check.
## Alternatives considered
- Backfilling `lineage_edge` and writing edges at every event: easy to miss an event, and it drifts from the
  records.
- A graph library (Cytoscape.js MIT, React Flow MIT): not needed for layered DAGs of this size.
- Program-scoped audit viewer for program admins: needs a program on every audit row. Revisit with Phase 18b
  admin roles if asked.
## Consequences
Lineage is complete for historical data with no migration of rows. The view is a union of scans; fine at the
current scale, revisit with ADR-001's thresholds. AI artifacts join the view in Phase 19.
## Revisit when
Lineage queries exceed ~200 ms at production scale, or program admins need the audit viewer.
