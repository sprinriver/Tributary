import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildArtifacts, GENERATED_DIR } from './artifacts.ts';

describe('generated OpenAPI and JSON Schema', () => {
  const artifacts = buildArtifacts();

  it('CON-03: OpenAPI 3.1 document lists the shared schemas as components', () => {
    expect(artifacts.openapi.openapi).toBe('3.1.0');
    const names = Object.keys(artifacts.openapi.components.schemas);
    for (const name of ['QuerySpec', 'ChartSpec', 'ContractError', 'ExperimentVersion', 'DatasetContract']) {
      expect(names).toContain(name);
    }
  });

  it('CON-03: one JSON Schema (draft 2020-12) per shared schema', () => {
    expect(Object.keys(artifacts.jsonSchemas)).toContain('QuerySpec');
    for (const schema of Object.values(artifacts.jsonSchemas)) {
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    }
  });

  it('CON-03: committed generated files are up to date (run `pnpm gen` if this fails)', () => {
    for (const [path, content] of Object.entries(artifacts.files)) {
      const onDisk = readFileSync(resolve(GENERATED_DIR, path), 'utf8');
      expect(onDisk, path).toBe(content);
    }
  });
});
