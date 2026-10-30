// Annotation columns of DIA-NN matrices (SOURCE.md); every other column is one run.
export const ANNOTATION_COLUMNS = [
  'Protein.Group',
  'Protein.Ids',
  'Protein.Names',
  'Genes',
  'First.Protein.Description',
];

/** DIA-NN 2.x pg_matrix header: Protein.Group first, Protein.Names and Genes present, at least one run column. */
export function isPgMatrix(columns: string[]): boolean {
  return (
    columns[0] === 'Protein.Group' &&
    columns.includes('Protein.Names') &&
    columns.includes('Genes') &&
    runColumns(columns).length > 0
  );
}

export const runColumns = (columns: string[]) => columns.filter((c) => !ANNOTATION_COLUMNS.includes(c));
