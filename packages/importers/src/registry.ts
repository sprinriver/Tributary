import { alphadiaPgMatrix, alphadiaPrecursors } from './alphadia/index.ts';
import { curvecurator } from './curvecurator/index.ts';
import { customTabular } from './custom_tabular/index.ts';
import { deqmsResult } from './deqms_result/index.ts';
import { deseq2Results } from './deseq2_results/index.ts';
import { diannReportParquet, diannReportQc } from './diann_report/index.ts';
import { fragpipeCombinedProtein } from './fragpipe_combined_protein/index.ts';
import { mageckGeneSummary } from './mageck_gene_summary/index.ts';
import { maxquantProteinGroups } from './maxquant_protein_groups/index.ts';
import { msstatsComparison } from './msstats_comparison/index.ts';
import { mzqc } from './mzqc/index.ts';
import { quantmsQpx } from './quantms_qpx/index.ts';
import { spectronautReport } from './spectronaut_report/index.ts';
import { diannPgMatrix } from './diann_pg_matrix/index.ts';
import { limmaTopTable } from './limma_toptable/index.ts';
import {
  referenceCompound,
  referenceCompoundProperty,
  referenceIdMapping,
  referenceTargetAnnotation,
} from './reference/index.ts';
import type { Importer } from './types.ts';

/** Every importer by key (SPEC §6.3). */
export const IMPORTERS: Readonly<Record<string, Importer>> = Object.fromEntries(
  [
    diannPgMatrix,
    diannReportParquet,
    diannReportQc,
    alphadiaPrecursors,
    alphadiaPgMatrix,
    mzqc,
    spectronautReport,
    maxquantProteinGroups,
    fragpipeCombinedProtein,
    quantmsQpx,
    limmaTopTable,
    msstatsComparison,
    deqmsResult,
    deseq2Results,
    curvecurator,
    mageckGeneSummary,
    customTabular,
    referenceCompound,
    referenceCompoundProperty,
    referenceTargetAnnotation,
    referenceIdMapping,
  ].map((i) => [i.key, i]),
);
