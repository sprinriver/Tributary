import { z } from 'zod';

// Modification sites (Phase 47, PTM-03): the sites of a protein across readable site releases, and a summary of one
// release. Counts only: nothing is re-localised, normalised or tested. The localisation threshold is a display choice.

const LocMin = z.coerce
  .number()
  .gt(0)
  .max(1)
  .default(0.75)
  .describe(
    'Localisation probability from which a site is marked as meeting the threshold (a display choice)',
  );

export const ProteinSitesQuerySchema = z.strictObject({ loc_min: LocMin }).meta({ id: 'ProteinSitesQuery' });

const Figure = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  layout: z.record(z.string(), z.unknown()),
});

export const SiteReleaseSchema = z.object({
  release_id: z.uuid(),
  dataset_name: z.string(),
  version_id: z.uuid(),
  experiment_id: z.uuid(),
  experiment_name: z.string(),
  experiment_date: z.string().nullable(),
  program_code: z.string(),
  method: z.string().nullable(),
  /** Samples in the release. */
  samples: z.int(),
});

export const ProteinSiteSchema = z.object({
  release_id: z.uuid(),
  site_id: z.string(),
  amino_acid: z.string(),
  /** Position in this protein (for a site reported on another protein too, this protein's position). */
  position: z.int().nullable(),
  modification: z.string(),
  /** Best localisation probability of the site over all samples in the table, as the tool reported it. */
  localization_prob: z.number().nullable(),
  meets_threshold: z.boolean(),
  /** Samples with an intensity above 0 at any multiplicity. */
  samples_quantified: z.int(),
  samples_total: z.int(),
  /** Multiplicities with an intensity above 0 in at least one sample. */
  multiplicities: z.array(z.int()),
  /** The other proteins the tool reports this site on. */
  shared_with: z.array(z.string()),
  sequence_window: z.string().nullable(),
});

export const ProteinSitesSchema = z
  .object({
    protein: z.string(),
    loc_min: z.number(),
    releases: z.array(SiteReleaseSchema),
    sites: z.array(ProteinSiteSchema),
    figure: Figure.nullable(),
    notes: z.array(z.string()),
  })
  .meta({ id: 'ProteinSites' });
export type ProteinSites = z.infer<typeof ProteinSitesSchema>;

export const SiteSummaryQuerySchema = z
  .strictObject({ release_id: z.uuid(), loc_min: LocMin })
  .meta({ id: 'SiteSummaryQuery' });

export const SiteSummarySchema = z
  .object({
    release_id: z.uuid(),
    modification: z.string(),
    loc_min: z.number(),
    /** Distinct sites in the release. */
    sites: z.int(),
    meeting_threshold: z.int(),
    per_sample: z.array(
      z.object({
        sample_key: z.string(),
        /** Sites with an intensity above 0 in this sample, whatever their localisation. */
        sites_quantified: z.int(),
        /** Of those, sites whose localisation probability in this sample is at least loc_min. */
        sites_quantified_meeting_threshold: z.int(),
      }),
    ),
    /** The most confidently localised sites (then by samples quantified), at most 25. */
    top: z.array(
      z.object({
        site_id: z.string(),
        protein: z.string(),
        gene_names: z.array(z.string()),
        localization_prob: z.number().nullable(),
        samples_quantified: z.int(),
      }),
    ),
    notes: z.array(z.string()),
  })
  .meta({ id: 'SiteSummary' });
export type SiteSummary = z.infer<typeof SiteSummarySchema>;
