export const REQUIRED = ['logFC', 'P.Value', 'adj.P.Val'];
export const GENE_COLUMNS = ['Genes', 'Gene', 'gene_names', 'genes'];

/** topTable for one coefficient: logFC, P.Value and adj.P.Val present (limma toptable.R). */
export const isTopTable = (columns: string[]) => REQUIRED.every((c) => columns.includes(c));

/** topTable statistic columns (limma toptable.R); never an identifier. */
export const STAT_COLUMNS = ['logFC', 'CI.L', 'CI.R', 'AveExpr', 't', 'F', 'P.Value', 'adj.P.Val', 'B'];

/**
 * The identifier column: `ID` when present (limma writes duplicated row names there), else the first column when it
 * is not a statistic (e.g. row names written with `col.names = NA`, or a genelist column). Undefined when the
 * identifiers were not written.
 */
export function idColumn(columns: string[]): string | undefined {
  if (columns.includes('ID')) return 'ID';
  const first = columns[0];
  return first !== undefined && !STAT_COLUMNS.includes(first) ? first : undefined;
}
