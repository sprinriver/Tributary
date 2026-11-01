# 0015 — Generate OpenAPI components and JSON Schema with zod 4's built-in converter
Date: 2026-10-26 · Status: accepted
## Context
Phase 1 must emit OpenAPI 3.1 and JSON Schema from the zod contracts (CON-03), and Python models for
apps/compute. ARCHITECTURE §3 listed `@asteasolutions/zod-to-openapi` 9.1.0 for this.
## Decision
Use zod 4's built-in `z.toJSONSchema` (draft 2020-12, the dialect OpenAPI 3.1 uses). Every exported schema
carries `.meta({ id })`; `packages/contracts/src/gen/artifacts.ts` builds `components.schemas` from zod's global
registry and one standalone JSON Schema per id. Python pydantic v2 models are generated from those JSON Schemas
with datamodel-code-generator 0.83.0 (MIT, dev dependency of apps/compute). Generated files are committed, and a
unit test plus a CI step fail when they drift.
## Alternatives considered
- `@asteasolutions/zod-to-openapi`: one more runtime dependency for what zod 4 now does natively; it also needs
  its own registry and `extendZodWithOpenApi` patching.
- Hand-written pydantic models: drift from the contracts is the defect class the contracts exist to remove.
## Consequences
No `paths` yet: Phase 3 adds routes. Route schemas should come from the same zod schemas (e.g. via
fastify-type-provider-zod) and be merged into this document. The OpenAPI output is the zod *output* shape;
request bodies that use transforms need `io: 'input'` when paths are added.
## Revisit when
Route generation in Phase 3 needs features the built-in converter lacks.
