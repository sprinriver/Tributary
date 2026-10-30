import { resolve } from 'node:path';
import { z } from 'zod';
// Importing the package registers every schema that carries `.meta({ id })` in zod's global registry.
import { API_ROUTES, type ApiRoute } from '../index.ts';

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
    paths: buildPaths(),
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

/** Schema of a request/response part: a `$ref` when the schema has an id, else inlined. */
function schemaRef(schema: z.ZodType, io: 'input' | 'output', inlineOnly = false): JsonSchema {
  const id = z.globalRegistry.get(schema)?.id;
  if (id && !inlineOnly) return { $ref: `#/components/schemas/${id}` };
  // Nested schemas with ids stay as local `$defs` of the inlined schema.
  const inline = z.toJSONSchema(schema, { target: 'draft-2020-12', io }) as JsonSchema;
  delete inline.$schema;
  return inline;
}

const ERROR_RESPONSE = {
  description: 'Error',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ContractError' } } },
};

function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [operationId, route] of Object.entries(API_ROUTES) as [string, ApiRoute][]) {
    const params = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: m[1] === 'id' ? { type: 'string', format: 'uuid' } : { type: 'string' },
    }));
    const query = route.query
      ? Object.entries(
          (schemaRef(route.query, 'input', true).properties ?? {}) as Record<string, JsonSchema>,
        ).map(([name, schema]) => ({ name, in: 'query', required: false, schema }))
      : [];
    const reason = route.reason
      ? [
          {
            name: 'X-Change-Reason',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Recorded in the audit log',
          },
        ]
      : [];
    const status = String(route.status ?? 200);
    paths[route.path] ??= {};
    paths[route.path]![route.method] = {
      operationId,
      summary: route.summary,
      parameters: [...params, ...query, ...reason],
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: schemaRef(route.body, 'input') } },
            },
          }
        : {}),
      responses: {
        [status]: route.response
          ? {
              description: 'OK',
              content: { 'application/json': { schema: schemaRef(route.response, 'output') } },
            }
          : { description: 'No content' },
        '400': ERROR_RESPONSE,
        '401': ERROR_RESPONSE,
        '403': ERROR_RESPONSE,
        '404': ERROR_RESPONSE,
        '409': ERROR_RESPONSE,
        '422': ERROR_RESPONSE,
      },
    };
  }
  return paths;
}
