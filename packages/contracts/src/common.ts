import { z } from 'zod';

export const UuidV7Schema = z.uuidv7();
/** Instant in UTC, ISO 8601 with offset (stored as timestamptz). */
export const TimestampSchema = z.iso.datetime({ offset: true });
/** Calendar date, YYYY-MM-DD. */
export const DateSchema = z.iso.date();
export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected a semantic version such as 1.0.0');
export const JsonObjectSchema = z.record(z.string(), z.unknown());

/** Columns every table carries (SPEC §4). Soft delete only: `deleted_at` is null until deleted. */
export const BaseEntityShape = {
  id: UuidV7Schema,
  tenant_id: UuidV7Schema,
  created_at: TimestampSchema,
  created_by: UuidV7Schema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
};

/** An ontology term as stored: CURIE plus its label, e.g. `{ id: 'NCBITaxon:9606', label: 'Homo sapiens' }`. */
export const OntologyTermSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_.-]*:[A-Za-z0-9_.-]+$/, 'Expected a CURIE such as NCBITaxon:9606'),
    label: z.string().min(1),
  })
  .meta({ id: 'OntologyTerm' });
export type OntologyTerm = z.infer<typeof OntologyTermSchema>;

export function experimentUrn(experimentId: string): string {
  return `urn:tributary:experiment:${experimentId}`;
}

export function experimentVersionUrn(experimentId: string, versionNumber: number): string {
  return `${experimentUrn(experimentId)}:v${versionNumber}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const ExperimentUrnSchema = z.string().regex(new RegExp(`^urn:tributary:experiment:${UUID}$`));
export const ExperimentVersionUrnSchema = z
  .string()
  .regex(new RegExp(`^urn:tributary:experiment:${UUID}:v[1-9]\\d*$`));
