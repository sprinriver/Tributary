import { z } from 'zod';
import { DatasetKindSchema } from '../datasets/index.ts';

// SPEC M8 — experiment results, compound and protein pages, contrast comparison.

export const VersionResultsSchema = z
  .object({
    experiment_id: z.uuid(),
    experiment_name: z.string(),
    version_id: z.uuid(),
    version_number: z.int(),
    releases: z.array(
      z.object({
        id: z.uuid(),
        kind: DatasetKindSchema,
        dataset_name: z.string(),
        importer: z.string().nullable(),
        tool: z.string().nullable(),
        tool_version: z.string().nullable(),
        row_count: z.int(),
      }),
    ),
    contrasts: z.array(
      z.object({ id: z.uuid(), label: z.string(), numerator: z.string(), denominator: z.string() }),
    ),
    run: z
      .object({
        id: z.uuid(),
        pipeline_name: z.string(),
        pipeline_repo: z.string(),
        revision: z.string(),
        runner: z.string(),
        params: z.record(z.string(), z.unknown()),
        finished_at: z.string().nullable(),
      })
      .nullable(),
    files: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.string(), ingest_status: z.string() })),
    thresholds: z.object({ fc: z.number(), p: z.number() }),
    /** Deterministic text built from run and release provenance (same inputs → same text). */
    methods: z.string(),
  })
  .meta({ id: 'VersionResults' });
export type VersionResults = z.infer<typeof VersionResultsSchema>;

export const CompoundPageSchema = z
  .object({
    compound: z.object({
      compound_id: z.string(),
      batch_id: z.string().nullable(),
      name: z.string().nullable(),
      smiles: z.string().nullable(),
      inchikey: z.string().nullable(),
      program_code: z.string(),
    }),
    properties: z.array(
      z.object({
        property: z.string(),
        value: z.number().nullable(),
        unit: z.string().nullable(),
        qualifier: z.string(),
        assay_category: z.string(),
        assay_name: z.string().nullable(),
        batch_id: z.string().nullable(),
      }),
    ),
    /** Contrasts whose numerator condition used this compound, with the version's latest published DA release. */
    contrasts: z.array(
      z.object({
        contrast_id: z.uuid(),
        label: z.string(),
        experiment_id: z.uuid(),
        experiment_name: z.string(),
        experiment_version_id: z.uuid(),
        version_number: z.int(),
        release_id: z.uuid().nullable(),
      }),
    ),
  })
  .meta({ id: 'CompoundPage' });

export const ProteinPageSchema = z
  .object({
    accession: z.string(),
    gene_symbol: z.string().nullable(),
    annotations: z.array(
      z.object({ key: z.string(), value: z.string().nullable(), family: z.string().nullable() }),
    ),
  })
  .meta({ id: 'ProteinPage' });

export const CompareBodySchema = z
  .strictObject({
    contrasts: z
      // A release can hold several contrasts: the contrast is always named.
      .array(z.strictObject({ release_id: z.uuid(), contrast_id: z.uuid() }))
      .min(2)
      .max(6),
    fc_threshold: z.number().min(0).default(1),
    p_threshold: z.number().gt(0).max(1).default(0.05),
  })
  .meta({ id: 'CompareBody' });

const Figure = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  layout: z.record(z.string(), z.unknown()),
});

export const CompareResultSchema = z
  .object({
    labels: z.array(z.string()),
    /** Accessions measured (log2 FC and adjusted p) in every contrast; intersections count only these. */
    measured_in_all: z.int(),
    /** Accessions missing or without p in at least one contrast (left out of intersections and the scatter). */
    left_out: z.int(),
    /** Accessions found in more than one protein group of a contrast (ambiguous; left out). */
    ambiguous: z.int(),
    total_overlap: z.int(),
    /** Features significant in at least one contrast (|log2 FC| ≥ fc and adjusted p ≤ p), with values per contrast. */
    overlap: z.array(
      z.object({
        feature_id: z.string(),
        gene: z.string(),
        log2_fc: z.array(z.number().nullable()),
        significant: z.array(z.boolean()),
      }),
    ),
    /** Exclusive intersections (UpSet-style): which contrasts a set of features is significant in, and how many. */
    intersections: z.array(z.object({ members: z.array(z.boolean()), count: z.int() })),
    scatter: Figure,
    upset: Figure,
  })
  .meta({ id: 'CompareResult' });

export const CompareOptionSchema = z.object({
  release_id: z.uuid(),
  contrast_id: z.uuid(),
  label: z.string(),
  experiment_name: z.string(),
  program_code: z.string(),
});
export const CompareOptionsSchema = z
  .object({ items: z.array(CompareOptionSchema) })
  .meta({ id: 'CompareOptions' });

/** Experiment reports (Phase 33): the browser builds the PDF or slides; the API records and audits the export. */
export const ReportExportBodySchema = z
  .strictObject({ format: z.enum(['pdf', 'pptx']) })
  .meta({ id: 'ReportExportBody' });
export const ReportExportSchema = z
  .object({ format: z.enum(['pdf', 'pptx']), recorded_at: z.iso.datetime({ offset: true }) })
  .meta({ id: 'ReportExport' });
