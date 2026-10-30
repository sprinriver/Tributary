import { describe, expect, it } from 'vitest';
import { experimentPrefill, formFields, validateParams } from './nfschema.ts';

// nf-core pipeline schema (nf-schema plugin, JSON Schema draft 2020-12 with $defs groups) — abbreviated.
const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'demo pipeline parameters',
  type: 'object',
  $defs: {
    input_output_options: {
      title: 'Input/output options',
      type: 'object',
      required: ['input', 'outdir'],
      properties: {
        input: {
          type: 'string',
          format: 'file-path',
          description: 'Path to the SDRF file',
          help_text: 'Tab-separated',
        },
        outdir: { type: 'string', format: 'directory-path', description: 'Output directory' },
      },
    },
    search: {
      title: 'Search options',
      type: 'object',
      properties: {
        fdr: { type: 'number', default: 0.01, minimum: 0, maximum: 1, description: 'FDR threshold' },
        missed_cleavages: { type: 'integer', default: 2, minimum: 0, maximum: 5 },
        enzyme: { type: 'string', enum: ['Trypsin', 'Lys-C'], default: 'Trypsin' },
        mbr: { type: 'boolean', default: true, description: 'Match between runs' },
        secret_flag: { type: 'boolean', hidden: true },
      },
    },
  },
  allOf: [{ $ref: '#/$defs/input_output_options' }, { $ref: '#/$defs/search' }],
};

// Older nf-validation schemas use draft-07 "definitions".
const LEGACY = {
  $schema: 'http://json-schema.org/draft-07/schema',
  definitions: {
    main: {
      title: 'Main',
      properties: { genome: { type: 'string', pattern: '^GRCh3[78]$' } },
      required: ['genome'],
    },
  },
  allOf: [{ $ref: '#/definitions/main' }],
};

describe('PIPE-06: launch form from nf-schema', () => {
  it('PIPE-06: groups, types, enums, defaults, help and hidden fields', () => {
    const groups = formFields(SCHEMA);
    expect(groups.map((g) => g.title)).toEqual(['Input/output options', 'Search options']);
    const search = groups[1]!.fields;
    expect(search.map((f) => f.name)).toEqual(['fdr', 'missed_cleavages', 'enzyme', 'mbr']);
    expect(search.find((f) => f.name === 'enzyme')).toMatchObject({
      type: 'string',
      enum: ['Trypsin', 'Lys-C'],
      default: 'Trypsin',
    });
    expect(search.find((f) => f.name === 'mbr')).toMatchObject({ type: 'boolean', default: true });
    expect(groups[0]!.fields[0]).toMatchObject({
      name: 'input',
      required: true,
      format: 'file-path',
      help: 'Tab-separated',
    });
  });

  it('PIPE-06: reads draft-07 definitions too', () => {
    expect(formFields(LEGACY)[0]!.fields[0]).toMatchObject({
      name: 'genome',
      required: true,
      pattern: '^GRCh3[78]$',
    });
  });

  it('PIPE-06: validation names the field and reason; numbers are parsed', () => {
    const fields = formFields(SCHEMA).flatMap((g) => g.fields);
    const result = validateParams(fields, {
      input: '',
      outdir: 's3://out',
      fdr: '2',
      missed_cleavages: '1.5',
      enzyme: 'Pepsin',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'input', code: 'required' }),
        expect.objectContaining({ field: 'fdr', code: 'too_big' }),
        expect.objectContaining({ field: 'missed_cleavages', code: 'invalid_type' }),
        expect.objectContaining({ field: 'enzyme', code: 'invalid_value' }),
      ]),
    );
    const ok = validateParams(fields, {
      input: 's3://in/x.sdrf.tsv',
      outdir: 's3://out',
      fdr: '0.05',
      missed_cleavages: '1',
      mbr: false,
    });
    expect(ok).toEqual({
      ok: true,
      values: {
        input: 's3://in/x.sdrf.tsv',
        outdir: 's3://out',
        fdr: 0.05,
        missed_cleavages: 1,
        enzyme: 'Trypsin',
        mbr: false,
      },
    });
  });

  it('PIPE-06: pattern and empty schema', () => {
    const genome = formFields(LEGACY).flatMap((g) => g.fields);
    expect(validateParams(genome, { genome: 'hg19' }).errors?.[0]).toMatchObject({
      field: 'genome',
      code: 'invalid_format',
    });
    expect(formFields({})).toEqual([]);
    expect(validateParams([], {})).toEqual({ ok: true, values: {} });
  });
});

describe('experiment prefill', () => {
  const fields = [
    { name: 'organism', type: 'string' as const },
    { name: 'contrasts', type: 'string' as const },
    { name: 'fdr', type: 'number' as const },
  ].map((f) => ({ ...f, required: false }));
  const version = {
    species: { id: 'NCBITaxon:9606', label: 'Homo sapiens' },
    contrasts: [
      { label: 'A vs B', numerator: 'A', denominator: 'B' },
      { label: 'C vs B', numerator: 'C', denominator: 'B' },
    ],
  };

  it('PIPE-05: species and contrasts fill matching schema fields; nothing else is invented', () => {
    expect(experimentPrefill(fields, version)).toEqual({ organism: 'Homo sapiens', contrasts: 'A vs B;C vs B' });
    expect(experimentPrefill(fields, { species: null, contrasts: [] })).toEqual({});
    expect(experimentPrefill([], version)).toEqual({});
  });
});
