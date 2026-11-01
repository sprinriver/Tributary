---
name: add-chart-type
description: Procedure for adding a chart type to the chart registry and the web app. Use when implementing any chart in docs/SPEC.md M7 or Phase 15 of docs/PLAN.md.
---
Reference implementation: the `volcano` entry in the packages/contracts chart registry and
apps/web/src/charts/volcano (built in Phase 14). Copy their structure exactly.

1. **Registry entry** (packages/contracts): encodings with `required` and `accepts` types; options as a zod
   schema with types, ranges, defaults and cross-field `requires` rules; dataRules (minRows, minRowsPerGroup,
   maxFacets ≤ 24, maxPoints, nullPolicy); compute location (`none` | `ts` | `python`); Plotly trace types.
   Take option names and semantics from docs/REFERENCE_V1.md §7 for parity.
2. **Server shaping** (apps/api charts module): QuerySpec → rows → shaped data; statistics only through
   apps/compute endpoints; structured errors `{code, field, message}`.
3. **Web component** apps/web/src/charts/<type>/: `Chart.tsx` (lazy Plotly partial bundle), `adapter.ts`
   (shaped data → traces and layout), `<type>.test.ts`.
4. **Tests** (titles start with the feature ID and include the chart type, e.g. `VIZ-05: lollipop rejects a
   categorical size column`): every option and every `requires` rule; each relevant
   docs/REFERENCE_V1.md §8 defect scenario returns a field-level error; an e2e spec in e2e/charts/<type>.spec.ts
   that saves a screenshot to artifacts/phase-<N>/.
5. **Provenance**: the rendered chart carries dataset release IDs, the QuerySpec hash, the chart spec and
   compute versions.

Never ship an option without a test proving it changes the output (v1 shipped a dead "Query" option).
