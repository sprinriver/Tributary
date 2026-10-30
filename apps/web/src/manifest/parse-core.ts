import Papa from 'papaparse';

export interface ParsedTable {
  fields: string[];
  rows: Record<string, string>[];
  delimiter: string;
  errors: string[];
}

/** CSV/TSV/semicolon text → header row + rows of strings (Papa Parse, delimiter auto-detected). */
export function parseTable(text: string): ParsedTable {
  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: ['\t', ',', ';', '|'],
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });
  return {
    fields: (result.meta.fields ?? []).filter((f) => f !== ''),
    rows: result.data,
    delimiter: result.meta.delimiter,
    errors: result.errors.slice(0, 5).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`),
  };
}

export const delimiterName = (d: string) =>
  ({ '\t': 'tab', ',': 'comma', ';': 'semicolon', '|': 'pipe' })[d] ?? d;
