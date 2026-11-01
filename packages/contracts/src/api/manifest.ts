import { z } from 'zod';
import { TimestampSchema } from '../common.ts';

export const OntologySearchQuerySchema = z
  .strictObject({
    ontology: z.string().trim().min(1).max(50),
    q: z.string().trim().min(1).max(100),
  })
  .meta({ id: 'OntologySearchQuery' });

export const OntologySearchResultSchema = z
  .object({
    /** ols = fetched from OLS4 now; cache = served from Postgres; local = built-in terms (OLS4 unreachable). */
    source: z.enum(['ols', 'cache', 'local']),
    items: z.array(z.object({ id: z.string(), label: z.string(), synonyms: z.array(z.string()) })),
  })
  .meta({ id: 'OntologySearchResult' });
export type OntologySearchResult = z.infer<typeof OntologySearchResultSchema>;

export const MappingPresetBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    mapping: z.record(
      z.string().min(1).max(200),
      z.string().regex(/^[a-z][a-z0-9_]*$/, 'Map to a manifest column key'),
    ),
  })
  .meta({ id: 'MappingPresetBody' });

export const MappingPresetSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    mapping: z.record(z.string(), z.string()),
    created_at: TimestampSchema,
  })
  .meta({ id: 'MappingPreset' });
export type MappingPreset = z.infer<typeof MappingPresetSchema>;

export const SdrfImportBodySchema = z
  .strictObject({ sdrf: z.string().min(1).max(20_000_000) })
  .meta({ id: 'SdrfImportBody' });
