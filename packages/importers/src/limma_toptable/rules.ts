import type { ImporterRule } from '../types.ts';

export const CI_RULE: ImporterRule = {
  id: 'ci_contains_log2_fc',
  severity: 'warn',
  source: 'limma topTable: CI.L and CI.R are the confidence limits of logFC (man/toptable.Rd)',
  sql: `SELECT feature_id AS example FROM {canon} WHERE log2_fc IS NOT NULL AND ci_low IS NOT NULL AND ci_high IS NOT NULL AND (log2_fc < ci_low OR log2_fc > ci_high)`,
  message: (n, ex) => `${n} row(s) have logFC outside [CI.L, CI.R]: ${ex.join(', ')}.`,
};

// UniProt accession format (uniprot.org/help/accession_numbers), optionally with an isoform suffix "-n".
const ACCESSION = '^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$';

export const ACCESSION_RULE: ImporterRule = {
  id: 'protein_ids_accessions',
  severity: 'warn',
  source: 'UniProt accession format (https://www.uniprot.org/help/accession_numbers)',
  sql: `SELECT feature_id AS example FROM {canon} WHERE len(list_filter(protein_ids, lambda x: NOT regexp_full_match(x, '${ACCESSION}'))) > 0`,
  message: (n, ex) =>
    `${n} feature(s) are not UniProt accessions although feature_type is protein_group: ${ex.join(', ')}. Set feature_type = gene if these are genes.`,
};
