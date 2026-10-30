import {
  createStaticTermIndex,
  parseQuantity,
  SEED_TERMS,
  validateManifest,
  type MetadataFieldDef,
  type MetadataTemplateDefinition,
  type SeedTerm,
} from '@tributary/contracts';

/** rowIndex → column → message, from the same zod schema the API runs on save (SPEC M2). */
export type CellErrors = Map<number, Record<string, string>>;

export function validateRows(
  template: MetadataTemplateDefinition,
  sampleFields: MetadataFieldDef[],
  rows: Record<string, string>[],
  extraTerms: SeedTerm[] = [],
): { errors: CellErrors; count: number } {
  const result = validateManifest(template, sampleFields, rows, {
    termIndex: createStaticTermIndex([...SEED_TERMS, ...extraTerms]),
    plateFormat: '96',
  });
  const errors: CellErrors = new Map();
  if (result.ok) return { errors, count: 0 };
  for (const error of result.errors) {
    const match = /^rows\.(\d+)\.(.+)$/.exec(error.field ?? '');
    if (!match) continue;
    const row = Number(match[1]);
    errors.set(row, { ...errors.get(row), [match[2]!]: error.message });
  }
  return { errors, count: result.errors.length };
}

const compact = (n: number) =>
  n !== 0 && (Math.abs(n) < 1e-3 || Math.abs(n) >= 1e4) ? n.toExponential() : String(n);

/** "1000 nM (1e-6 M)": the typed quantity with its canonical value, for dose and time cells. */
export function quantityDisplay(raw: string, kind: 'concentration' | 'time'): string {
  if (!raw) return '';
  const parsed = parseQuantity(raw, kind);
  return parsed.ok ? `${raw} (${compact(parsed.value.canonical)} ${parsed.value.canonicalUnit})` : raw;
}
