export const PLATE_FORMATS = ['96', '384'] as const;
export type PlateFormat = (typeof PLATE_FORMATS)[number];

// 96-well: rows A–H × columns 1–12; 384-well: rows A–P × columns 1–24 (ANSI/SLAS 4-2004 footprint).
const LAYOUT: Record<PlateFormat, { rows: number; columns: number }> = {
  '96': { rows: 8, columns: 12 },
  '384': { rows: 16, columns: 24 },
};

/** Returns the canonical well name (`A1` → `A01`) or undefined when the well is not on the plate. */
export function normaliseWell(well: string, format: PlateFormat): string | undefined {
  const match = /^([A-Za-z])(\d{1,2})$/.exec(well.trim());
  if (!match?.[1] || !match[2]) return undefined;
  const row = match[1].toUpperCase();
  const column = Number(match[2]);
  const { rows, columns } = LAYOUT[format];
  if (row.charCodeAt(0) - 65 >= rows || column < 1 || column > columns) return undefined;
  return `${row}${String(column).padStart(2, '0')}`;
}
