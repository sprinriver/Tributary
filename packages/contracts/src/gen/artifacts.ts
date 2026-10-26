import { resolve } from 'node:path';
import { z } from 'zod';
// Importing the package registers every schema that carries `.meta({ id })` in zod's global registry.
import '../index.ts';

export const GENERATED_DIR = resolve(import.meta.dirname, '../../generated');

type JsonSchema = Record<string, unknown>;

export interface Artifacts {
  openapi: { openapi: string; components: { schemas: Record<string, JsonSchema> } } & JsonSchema;
  /** One standalone JSON Schema per shared schema, keyed by schema id. */
  jsonSchemas: Record<string, JsonSchema & { $schema: string }>;
  /** Files to write under GENERATED_DIR, path → content. */
  files: Record<string, string>;
}

const snake = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Builds OpenAPI 3.1 components and JSON Schemas (draft 2020-12) from the zod contracts. No paths until Phase 3. */
export function buildArtifacts(): Artifacts {
  const ids = [...z.globalRegistry._idmap.keys()].sort();

  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    target: 'draft-2020-12',
    uri: (id) => `#/components/schemas/${id}`,
  });
  const components: Record<string, JsonSchema> = {};
  for (const id of ids) {
    // Components inherit the document's dialect; drop the per-schema $schema / $id.
    const schema = { ...(schemas[id] as JsonSchema) };
    delete schema.$schema;
    delete schema.$id;
    components[id] = schema;
  }

  const openapi = {
    openapi: '3.1.0',
    info: { title: 'Tributary API', version: '0.1.0' },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    paths: {},
    components: { schemas: components },
  };

  const jsonSchemas: Artifacts['jsonSchemas'] = {};
  const files: Record<string, string> = { 'openapi.json': json(openapi) };
  for (const id of ids) {
    const schema = z.globalRegistry._idmap.get(id);
    if (!schema) continue;
    const standalone = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
    }) as Artifacts['jsonSchemas'][string];
    jsonSchemas[id] = standalone;
    files[`json-schema/${snake(id)}.json`] = json(standalone);
  }
  return { openapi, jsonSchemas, files };
}
