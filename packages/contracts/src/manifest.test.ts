import { describe, expect, it } from 'vitest';
import {
  createStaticTermIndex,
  SEED_PROTEOMICS_TEMPLATE,
  SEED_TERMS,
  validateManifest,
  type MetadataFieldDef,
} from './index.ts';
import { validManifestRows } from './manifest-fixture.ts';

const options = { termIndex: createStaticTermIndex(SEED_TERMS), plateFormat: '96' as const };

describe('manifest schema built from the seed proteomics template', () => {
  it('CON-01: a valid 96-row manifest passes and is normalised', () => {
    const result = validateManifest(SEED_PROTEOMICS_TEMPLATE, [], validManifestRows(), options);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(96);
    const treated = result.rows[1];
    expect(treated?.organism).toEqual({ id: 'NCBITaxon:9606', label: 'Homo sapiens' });
    expect(treated?.dose).toMatchObject({ canonical: 1e-6, canonicalUnit: 'M', unit: 'µM' });
    expect(treated?.time).toMatchObject({ canonical: 24, canonicalUnit: 'h' });
    expect(treated?.well).toBe('A02');
    expect(result.rows[0]?.dose).toBe('not applicable');
  });

  it('CON-01: the 5 deliberate errors of the SPEC M2 check each give one field-level error', () => {
    const rows = validManifestRows();
    rows[4] = { ...rows[4], well: 'Z99' }; // bad well
    rows[10] = { ...rows[10], organism: 'Homo sapien' }; // unknown species
    rows[20] = { ...rows[20], dose: '10' }; // dose without unit
    rows[30] = { ...rows[30], sample_key: 'S001' }; // duplicate sample key
    rows[40] = { ...rows[40], source_name: '' }; // missing required field

    const result = validateManifest(SEED_PROTEOMICS_TEMPLATE, [], rows, options);
    expect(result.ok).toBe(false);
    const byField = Object.fromEntries(result.errors.map((e) => [e.field, e.code]));
    expect(byField).toEqual({
      'rows.4.well': 'invalid_well',
      'rows.10.organism': 'unknown_term',
      'rows.20.dose': 'missing_unit',
      'rows.30.sample_key': 'duplicate_key',
      'rows.40.source_name': 'required',
    });
    for (const error of result.errors) expect(error.message.length).toBeGreaterThan(0);
  });

  it('CON-01: reserved tokens differ from an empty cell', () => {
    const rows = validManifestRows().slice(0, 2);
    rows[0] = { ...rows[0], source_name: 'not available' };
    rows[1] = { ...rows[1], source_name: '   ' };
    const result = validateManifest(SEED_PROTEOMICS_TEMPLATE, [], rows, options);
    expect(result.errors.map((e) => `${e.field}:${e.code}`)).toEqual(['rows.1.source_name:required']);
  });

  it('CON-01: sample_key may not use a reserved token', () => {
    const rows = validManifestRows().slice(0, 1);
    rows[0] = { ...rows[0], sample_key: 'not available' };
    const result = validateManifest(SEED_PROTEOMICS_TEMPLATE, [], rows, options);
    expect(result.errors.map((e) => e.code)).toEqual(['required']);
  });

  it('CON-01: unknown columns are rejected unless declared as custom fields', () => {
    const rows = validManifestRows()
      .slice(0, 1)
      .map((r) => ({ ...r, passage: '7' }));
    const rejected = validateManifest(SEED_PROTEOMICS_TEMPLATE, [], rows, options);
    expect(rejected.errors.map((e) => `${e.field}:${e.code}`)).toEqual(['rows.0.passage:unknown_column']);

    const passage: MetadataFieldDef = {
      scope: 'sample',
      key: 'passage',
      label: 'Passage number',
      type: 'integer',
      required: false,
      searchable: true,
    };
    const accepted = validateManifest(SEED_PROTEOMICS_TEMPLATE, [passage], rows, options);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.rows[0]?.passage).toBe(7);
  });

  it('CON-01: a custom field may not reuse a template key', () => {
    const clash: MetadataFieldDef = {
      scope: 'sample',
      key: 'dose',
      label: 'Dose again',
      type: 'text',
      required: false,
      searchable: false,
    };
    expect(() => validateManifest(SEED_PROTEOMICS_TEMPLATE, [clash], [], options)).toThrow(/dose/);
  });

  it('CON-01: typed fields reject bad numbers, integers, enums and dates', () => {
    const fields: MetadataFieldDef[] = [
      { scope: 'sample', key: 'n', label: 'N', type: 'number', required: false, searchable: false },
      { scope: 'sample', key: 'i', label: 'I', type: 'integer', required: false, searchable: false },
      { scope: 'sample', key: 'b', label: 'B', type: 'boolean', required: false, searchable: false },
      { scope: 'sample', key: 'd', label: 'D', type: 'date', required: false, searchable: false },
      {
        scope: 'sample',
        key: 'e',
        label: 'E',
        type: 'enum',
        enumValues: ['x', 'y'],
        required: false,
        searchable: false,
      },
    ];
    const rows = validManifestRows()
      .slice(0, 1)
      .map((r) => ({ ...r, n: 'abc', i: '1.5', b: 'maybe', d: '2026-13-40', e: 'z' }));
    const result = validateManifest(SEED_PROTEOMICS_TEMPLATE, fields, rows, options);
    expect(result.errors.map((e) => `${e.field}:${e.code}`).sort()).toEqual([
      'rows.0.b:invalid_boolean',
      'rows.0.d:invalid_date',
      'rows.0.e:invalid_enum',
      'rows.0.i:invalid_integer',
      'rows.0.n:invalid_number',
    ]);
  });
});
