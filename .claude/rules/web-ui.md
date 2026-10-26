---
paths:
  - "apps/web/src/**/*.{ts,tsx}"
  - "packages/ui/src/**/*.{ts,tsx}"
---
# Web UI rules
- Data access only through the generated API client; server state in TanStack Query; shareable state
  (filters, joins, chart spec) in the URL.
- AG Grid Community only — no Enterprise imports. Server-side pagination and sorting for datasets.
- Plotly through the lazy-loaded partial bundle; never import the full `plotly.js` bundle.
- Chart and manifest forms are generated from packages/contracts zod schemas; submit stays disabled until
  valid; `{field, message}` errors appear next to the control.
- No statistics in the browser beyond the TypeScript transforms allowed by the science rules.
- Accessibility: labelled controls, keyboard navigation, visible focus, a table alternative for every chart.
- Check every new screen with the Playwright MCP as a scientist would; save screenshots to artifacts/phase-<N>/.
