// Excel sample sheets (Phase 32, XLS-01/02). Parsed and written in the browser: the server never unzips uploads.
// Nothing is changed silently: numbers keep the text Excel stored, dates are converted and flagged, and duplicate
// or unnamed columns are reported.
import type { ParsedTable } from './parse-core.ts';

type Cell = string | number | boolean | Date | null | undefined;

export interface ParsedSheet extends ParsedTable {
  sheet: string;
  warnings: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
/** A date cell as ISO text: a date alone at midnight UTC, else date and time. */
function isoDate(d: Date): string {
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  return time === 0
    ? day
    : `${day}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

function text(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return isoDate(cell);
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  return String(cell).trim();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One sheet's cells → header + rows of strings, with warnings for what a scientist should check. */
export function sheetToTable(sheet: string, data: Cell[][]): ParsedSheet {
  const warnings: string[] = [];
  const rows = data.filter((r) => r.some((c) => text(c) !== ''));
  const [header = [], ...body] = rows;
  // Column index → field name; unnamed columns are left out (and reported if they hold data).
  const seen = new Map<string, number>();
  const fields: (string | null)[] = header.map((h) => {
    const name = text(h);
    if (!name) return null;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n === 2) warnings.push(`"${name}" appears twice: the second is "${name} (2)"`);
    return n === 1 ? name : `${name} (${n})`;
  });
  const width = Math.max(header.length, ...body.map((r) => r.length));
  for (let c = 0; c < width; c++) {
    if (fields[c]) continue;
    const values = body.filter((r) => text(r[c]) !== '').length;
    if (values) warnings.push(`column ${c + 1} has no header and holds ${plural(values, 'value')}: left out`);
  }
  const dateColumns = new Set<string>();
  const out = body.map((r) => {
    const row: Record<string, string> = {};
    fields.forEach((f, c) => {
      if (!f) return;
      if (r[c] instanceof Date) dateColumns.add(f);
      row[f] = text(r[c]);
    });
    return row;
  });
  if (dateColumns.size)
    warnings.push(
      `Excel stored cells in ${[...dateColumns].map((c) => `"${c}"`).join(', ')} as dates; they were converted to ISO ` +
        'dates. Check they were meant to be dates (Excel turns names like SEPT1 or 1-2 into dates).',
    );
  return {
    sheet,
    fields: fields.filter((f): f is string => f !== null),
    rows: out,
    delimiter: 'xlsx',
    errors: [],
    warnings,
  };
}

/** Reads the sheet named "samples" (any case), else the first sheet. */
export async function readXlsx(file: File): Promise<ParsedSheet> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  // Numbers keep the text Excel stored (no float re-formatting).
  const sheets = await readXlsxFile(file, { parseNumber: (s: string) => s });
  const chosen = sheets.find((s) => s.sheet.trim().toLowerCase() === 'samples') ?? sheets[0];
  if (!chosen) throw new Error('The workbook has no sheets.');
  const table = sheetToTable(chosen.sheet, chosen.data as unknown as Cell[][]);
  if (sheets.length > 1)
    table.warnings.unshift(
      `Read sheet "${chosen.sheet}" of ${sheets.length} (${sheets.map((s) => s.sheet).join(', ')}).`,
    );
  return table;
}

/** Header (bold) + rows, every cell as text so Excel cannot reinterpret IDs or gene names. */
export function tableToSheet(columns: string[], rows: Record<string, string>[]) {
  return [
    columns.map((c) => ({ value: c, type: String, fontWeight: 'bold' as const })),
    ...rows.map((r) => columns.map((c) => ({ value: r[c] ?? '', type: String }))),
  ];
}

export async function downloadXlsx(fileName: string, columns: string[], rows: Record<string, string>[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(tableToSheet(columns, rows), { sheet: 'samples' }).toFile(fileName);
}
