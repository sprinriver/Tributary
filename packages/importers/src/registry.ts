import { customTabular } from './custom_tabular/index.ts';
import { diannPgMatrix } from './diann_pg_matrix/index.ts';
import { limmaTopTable } from './limma_toptable/index.ts';
import {
  referenceCompound,
  referenceCompoundProperty,
  referenceIdMapping,
  referenceTargetAnnotation,
} from './reference/index.ts';
import type { Importer } from './types.ts';

/** Every importer by key (SPEC §6.3). Phase 9 adds the remaining tools. */
export const IMPORTERS: Readonly<Record<string, Importer>> = Object.fromEntries(
  [
    diannPgMatrix,
    limmaTopTable,
    customTabular,
    referenceCompound,
    referenceCompoundProperty,
    referenceTargetAnnotation,
    referenceIdMapping,
  ].map((i) => [i.key, i]),
);
