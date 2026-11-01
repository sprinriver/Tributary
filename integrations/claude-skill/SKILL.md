---
name: tributary
description: Explore and query a Tributary experiment data platform through its MCP server. Use when the user asks about their drug-discovery experiments, datasets, differential abundance results, compounds or proteins stored in Tributary, wants rows from a dataset release, wants to compare contrasts or compounds, or wants a result they can cite or reopen in the Explorer.
---

# Using Tributary through MCP

Tributary holds a company's experiment registry, versioned dataset releases and analysis results. Its MCP server
(`https://<your-tributary>/api/mcp`, Streamable HTTP) exposes the same tools as the in-app assistant. **Every tool
runs with the signed-in user's own permissions.** If a tool answers "not found", the item is either missing or in a
program the user cannot read. Say so plainly, and never guess what it contains.

Connect with the company's identity provider (OAuth; the server publishes its metadata at
`/.well-known/oauth-protected-resource/mcp`), or with a personal access token (`trb_…`, from the web app).

## Ground rules

- Look things up with the tools. Never answer from memory about the user's data.
- Ask for data only through **QuerySpecs** (`build_query`, then `run_query`). Never write SQL or code against the
  data, and do not ask the user for database access.
- **Cite what you used:** the release ids (`releaseIds` in the QuerySpec), experiment names and versions.
  Give the user the `explorer_url` from `build_query` / `run_query`, so they can reopen the exact query.
- **Report statistics exactly as returned:**
  - log2 fold change is `log2(numerator / denominator)`; contrast labels read "numerator vs denominator".
  - `adj_p_value` is adjusted as recorded in `adj_method` (Benjamini–Hochberg unless the tool says otherwise).
  - Do not recompute, impute or filter silently. If you filter, say how.
- **Tool annotations:**
  - Tools marked read-only are safe to call.
  - `create_saved_view` and `apply_metadata_suggestions` change data as the user. Ask the user before calling them.
    They may be switched off by an administrator.
- Ontology terms must come from `suggest_ontology_terms`. When it answers "no match", report that; never invent a
  term or an ID.

## Workflows

### Explore an experiment
1. `search_experiments` with the user's words (cell line, compound id, assay type, free text).
2. `get_experiment` for the one they mean: versions, assay type, program.
3. `get_results_summary` with a version id: releases, contrasts, the run and the methods paragraph.
4. `get_lineage` (kind `experiment` or `release`) when they ask where a result came from.

### Pull rows from a release
1. `list_datasets` (optionally `kind: "differential_abundance"`) to find a published release id.
2. `describe_release` to see its columns before filtering.
3. Build the QuerySpec and validate it with `build_query`, then call `run_query` (it returns the first 25 rows and
   the total). For more rows, give the user the Explorer link or the Python SDK snippet.

A differential-abundance QuerySpec (significant down-regulated proteins):

```json
{
  "source": { "releaseIds": ["<release id>"] },
  "where": {
    "combinator": "and",
    "rules": [
      { "field": "adj_p_value", "operator": "<", "value": 0.05 },
      { "field": "log2_fc", "operator": "<", "value": -1 }
    ]
  },
  "orderBy": [{ "column": "adj_p_value", "dir": "asc" }],
  "page": { "size": 25 }
}
```

- **Operators by column type:**
  - text: `=`, `!=`, `contains`, `beginsWith`, `in`, `null`, …
  - numeric: `<`, `<=`, `>`, `>=`, `between`, `in`, …
  - list columns (`protein_ids`, `gene_names`): `contains`
- **Source:** use `{ "kind": "<dataset kind>", "scope": {} }` instead of `releaseIds` to query every readable
  release of a kind, e.g. `sample` metadata.

### Compare compounds or contrasts
1. Search each compound (`search_experiments` with the compound id, e.g. `CPD-000005`).
2. For each experiment, find its differential-abundance release (`get_results_summary`).
3. Run the same QuerySpec on each release, or one QuerySpec with all their ids in `releaseIds`. Present a table with
   one row per feature and one column per contrast label, and say which releases each column came from.
4. Keep effect direction straight: a negative `log2_fc` means lower in the numerator condition.

### Charts
`suggest_chart` validates a ChartSpec from the chart registry, and `render_chart` renders it with provenance. Charts
and statistics are computed by the platform; describe what the chart shows, not new statistics.

## When something fails
- **"not found"**: tell the user it is missing or outside their programs; suggest they check the name or ask for
  access.
- **"Invalid QuerySpec: …"**: fix the named field (column names come from `describe_release`) and validate again.
- **"read-only" / "switched off"**: the token or the deployment does not allow writes; explain, don't retry.
