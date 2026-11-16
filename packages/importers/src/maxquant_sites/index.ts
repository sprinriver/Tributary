import { ImportError } from '../errors.ts';
import { ident, literal, na, num, split } from '../sql.ts';
import { removedRowsRule, runMatching } from '../shared/runs.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// MaxQuant <modification>Sites.txt (SOURCE.md; Cox lab "Output Tables" → "Site Table"). One wide row per site →
// one row per site × sample × multiplicity. Nothing is re-localised, normalised, imputed or summed.
const NA_TOKENS = ['', 'NaN'];
const FLAGS = ['Reverse', 'Potential contaminant', 'Contaminant'];
const FLAG_SOURCE =
  'SOURCE.md: "+" in Reverse / Potential contaminant marks rows to remove (MaxQuant documentation)';
const LABELLED = /^Intensity [LMH]( |$)/;

export const maxquantSites: Importer = {
  key: 'maxquant_sites',
  label: 'MaxQuant site table (<modification>Sites.txt)',
  kind: 'ptm_site_quant',
  tool: 'MaxQuant',
  version: '1.0.0',
  formats: ['tsv', 'text'],
  detect: (c) =>
    c.includes('Proteins') &&
    c.includes('Localization prob') &&
    c.includes('Amino acid') &&
    c.includes('Position'),
  build(source, ctx, prefix) {
    const o = ctx.options ?? {};
    const has = (c: string) => source.columns.includes(c);
    for (const needed of ['Protein', 'Proteins', 'Amino acid', 'Position'])
      if (!has(needed))
        throw new ImportError(
          'wrong_format',
          `Not a MaxQuant site table: the column "${needed}" is missing.`,
        );

    // The modification: from the "<mod> Probabilities" column, else the option. Never guessed.
    const probs = source.columns.filter((c) => c.endsWith(' Probabilities')).map((c) => c.slice(0, -14));
    const modification =
      probs.length === 1
        ? probs[0]!
        : typeof o.modification === 'string' && o.modification
          ? o.modification
          : null;
    if (!modification)
      throw new ImportError(
        'needs_modification',
        probs.length > 1
          ? `The table has ${probs.length} "<modification> Probabilities" columns; give options.modification.`
          : 'The table names no modification ("<modification> Probabilities" column); give options.modification, e.g. "Phospho (STY)".',
      );

    // Labelled tables (SILAC, TMT) also carry summed "Intensity <exp>" columns, which are not one sample's abundance.
    const labelled = source.columns.filter(
      (c) => LABELLED.test(c) || /^Ratio [HML]\//.test(c) || c.startsWith('Reporter intensity'),
    );
    if (labelled.length)
      throw new ImportError(
        'labelled_only',
        `The table is from a labelled (SILAC or TMT) experiment (e.g. "${labelled[0]}"); only label-free site tables are imported: its summed intensities are not one sample's abundance.`,
      );
    // Quantities: Intensity <exp>___<j> (multiplicity j) when present, else Intensity <exp>.
    const split3 = source.columns
      .filter((c) => !LABELLED.test(c))
      .flatMap((c) => {
        const m = /^Intensity (.+)___(\d+)$/.exec(c);
        return m ? [{ column: c, exp: m[1]!, mult: Number(m[2]) }] : [];
      });
    const flat = source.columns
      .filter((c) => !LABELLED.test(c) && c.startsWith('Intensity ') && !/___\d+$/.test(c))
      .map((c) => ({ column: c, exp: c.slice('Intensity '.length), mult: null as number | null }));
    const quant = split3.length ? split3 : flat;
    if (!quant.length)
      throw new ImportError(
        source.columns.some((c) => LABELLED.test(c) || c.startsWith('Reporter intensity'))
          ? 'labelled_only'
          : 'wrong_format',
        source.columns.some((c) => LABELLED.test(c) || c.startsWith('Reporter intensity'))
          ? 'The table has only labelled (SILAC) or reporter intensities; label-free "Intensity <sample>" columns are needed.'
          : 'Not a MaxQuant site table: no "Intensity <sample>" columns.',
      );
    const exps = [...new Set(quant.map((q) => q.exp))];

    const qcols = `${prefix}_qcols`;
    const params: Record<string, string | number | null> = {};
    const values = quant
      .map((q, i) => {
        params[`qc${i}`] = q.column;
        params[`qe${i}`] = q.exp;
        params[`qm${i}`] = q.mult;
        return `($qc${i}, $qe${i}, $qm${i}::INTEGER)`;
      })
      .join(', ');
    const matching = runMatching(prefix, `SELECT DISTINCT exp AS name FROM ${qcols}`, ctx);

    const flags = FLAGS.filter(has);
    const keep = o.keep_flagged === true;
    const flagged = flags.map((f) => `coalesce(trim(${ident(f)}), '') = '+'`).join(' OR ') || 'false';
    const at = (c: string) => `src.${ident(c)}`;
    const value = (c: string) => (has(c) ? num(na(at(c), NA_TOKENS), source.decimal) : 'NULL::DOUBLE');
    const position = `TRY_CAST(trim(${at('Position')}) AS INTEGER)`;
    const selectParams: Record<string, string | null> = {
      ev: ctx.experimentVersionId ?? null,
      method_version: toolVersion(ctx),
    };
    const locSample = exps.some((e) => has(`Localization prob ${e}`))
      ? `CASE q.exp ${exps
          .map((e, i) => {
            selectParams[`le${i}`] = e;
            return `WHEN $le${i} THEN ${value(`Localization prob ${e}`)}`;
          })
          .join(' ')} END`
      : 'NULL::DOUBLE';
    const idType = exps.some((e) => has(`Identification type ${e}`))
      ? `CASE q.exp ${exps
          .map((e, i) => {
            selectParams[`it${i}`] = e;
            return `WHEN $it${i} THEN ${has(`Identification type ${e}`) ? na(at(`Identification type ${e}`), NA_TOKENS) : 'NULL'}`;
          })
          .join(' ')} END`
      : 'NULL::VARCHAR';
    const intensity = num(na('long.value', NA_TOKENS), source.decimal);
    // ___j intensities should add up to the summed "Intensity <exp>" (relative tolerance for rounding in the file).
    const n = (c: string) => `coalesce(${num(na(ident(c), NA_TOKENS), source.decimal)}, 0)`;
    const sumChecks = split3.length
      ? exps
          .filter((e) => has(`Intensity ${e}`))
          .map((e) => {
            const parts = split3.filter((q) => q.exp === e).map((q) => n(q.column));
            return `abs(${parts.join(' + ')} - ${n(`Intensity ${e}`)}) > 1e-3 * greatest(abs(${n(`Intensity ${e}`)}), 1)`;
          })
      : [];
    // Every column not read, named in the release (per-sample columns by family).
    const used = new Set([
      ...quant.map((q) => q.column),
      ...flags,
      ...exps.flatMap((e) => [`Localization prob ${e}`, `Identification type ${e}`]),
      'Protein',
      'Proteins',
      'Positions within proteins',
      'Gene names',
      'Amino acid',
      'Position',
      'Sequence window',
      'Localization prob',
      'Score diff',
      'PEP',
    ]);
    const family = (c: string) => {
      const e = exps.find((x) => c.endsWith(` ${x}`) || c.includes(` ${x}___`));
      return e ? c.replace(` ${e}`, ' <sample>') : c.replace(/___\d+$/, '___<j>');
    };
    const notImported = [...new Set(source.columns.filter((c) => !used.has(c)).map(family))];

    return {
      setup: [
        {
          sql: `CREATE OR REPLACE TEMP TABLE ${qcols} (run_column VARCHAR, exp VARCHAR, mult INTEGER); INSERT INTO ${qcols} VALUES ${values}`,
          params,
        },
        ...matching.setup,
      ],
      select: `
        WITH src AS (
          SELECT row_number() OVER () AS __row, * FROM ${source.table}${keep || !flags.length ? '' : ` WHERE NOT (${flagged})`}
        ),
        long AS (
          SELECT __row, run_column, value
          FROM src UNPIVOT INCLUDE NULLS (value FOR run_column IN (${quant.map((q) => ident(q.column)).join(', ')}))
        )
        SELECT
          $ev::UUID AS experiment_version_id,
          r.sample_key,
          r.instrument_run,
          trim(${at('Protein')}) || '_' || trim(${at('Amino acid')}) || CAST(${position} AS VARCHAR) AS site_id,
          trim(${at('Protein')}) AS protein,
          ${split(at('Proteins'))} AS protein_ids,
          ${has('Positions within proteins') ? split(at('Positions within proteins')) : '[]::VARCHAR[]'} AS positions_in_proteins,
          ${has('Gene names') ? split(at('Gene names')) : '[]::VARCHAR[]'} AS gene_names,
          ${literal(modification)} AS modification,
          trim(${at('Amino acid')}) AS amino_acid,
          ${position} AS position,
          ${has('Sequence window') ? at('Sequence window') : 'NULL::VARCHAR'} AS sequence_window,
          q.mult AS multiplicity,
          ${value('Localization prob')} AS localization_prob,
          ${locSample} AS localization_prob_sample,
          ${idType} AS identification_type,
          ${value('Score diff')} AS score_diff,
          ${value('PEP')} AS pep,
          ${intensity} AS intensity,
          ${na('long.value', NA_TOKENS)} AS __raw_intensity,
          CASE WHEN isfinite(${intensity}) AND ${intensity} > 0 THEN log2(${intensity}) END AS log2_intensity,
          'MaxQuant' AS method,
          $method_version AS method_version
        FROM long
          JOIN src USING (__row)
          JOIN ${qcols} q USING (run_column)
          JOIN ${matching.table} r ON r.run_col = q.exp`,
      params: selectParams,
      rules: [
        ...matching.rules,
        {
          id: 'position_readable',
          severity: 'error',
          source: 'SOURCE.md: site_id = Protein + Amino acid + Position (an integer)',
          sql: `SELECT ${ident('Protein')} || ' (Position "' || coalesce(${ident('Position')}, '') || '")' AS example FROM ${source.table} WHERE TRY_CAST(trim(${ident('Position')}) AS INTEGER) IS NULL`,
          message: (count, ex) =>
            `${count} row(s) have a Position that is not a whole number: ${ex.join(', ')}.`,
        },
        ...(sumChecks.length
          ? [
              {
                id: 'multiplicity_sum',
                severity: 'warn' as const,
                source: 'SOURCE.md: Intensity <sample>___<j> are the parts of Intensity <sample>',
                sql: `SELECT ${ident('Protein')} || '_' || ${ident('Amino acid')} || ${ident('Position')} AS example FROM ${source.table} WHERE ${sumChecks.join(' OR ')}`,
                message: (count: number, ex: string[]) =>
                  `${count} site row(s) whose multiplicity intensities do not add up to the summed intensity: ${ex.join(', ')}.`,
              },
            ]
          : []),
        ...(!keep && flags.length
          ? [
              removedRowsRule(
                'flagged_rows_removed',
                FLAG_SOURCE,
                `SELECT ${ident('Protein')} AS example FROM ${source.table} WHERE ${flagged}`,
                'site row(s)',
              ),
            ]
          : []),
      ],
      transformations: [
        {
          step: 'melt',
          detail: split3.length
            ? `${quant.length} "Intensity <sample>___<j>" columns → one row per site × sample × multiplicity (j); the summed "Intensity <sample>" columns are not imported`
            : `${quant.length} "Intensity <sample>" columns → one row per site × sample; multiplicity null`,
        },
        {
          step: 'map_runs',
          detail: 'Sample name → manifest sample (sample_key, instrument_run or raw_file name)',
        },
        { step: 'site_id', detail: 'site_id = Protein + "_" + Amino acid + Position' },
        {
          step: 'split',
          detail:
            'protein_ids = Proteins, positions_in_proteins = Positions within proteins, gene_names = Gene names, each split on ";"',
        },
        {
          step: 'modification',
          detail:
            probs.length === 1
              ? `modification = "${modification}" from the "${modification} Probabilities" column`
              : `modification = "${modification}" from options.modification`,
        },
        {
          step: 'zeros',
          detail:
            'MaxQuant writes 0 when a site is not quantified; zeros are kept as reported and log2_intensity is null for them',
        },
        { step: 'derive', detail: 'log2_intensity = log2(intensity) where intensity > 0' },
        ...(!keep && flags.length
          ? [
              {
                step: 'filter',
                detail: `Rows with "+" in ${flags.join(', ')} removed (count in rule flagged_rows_removed)`,
              },
            ]
          : []),
        {
          step: 'not_imported',
          detail: `Columns not imported: ${notImported.join(', ')}`,
        },
      ],
      naTokens: NA_TOKENS,
      toolVersion: toolVersion(ctx),
      mapping: {
        site_id: 'Protein_Amino acid+Position',
        protein: 'Protein',
        protein_ids: 'Proteins',
        positions_in_proteins: 'Positions within proteins',
        gene_names: 'Gene names',
        amino_acid: 'Amino acid',
        position: 'Position',
        sequence_window: 'Sequence window',
        localization_prob: 'Localization prob',
        localization_prob_sample: 'Localization prob <sample>',
        score_diff: 'Score diff',
        pep: 'PEP',
        intensity: split3.length ? 'Intensity <sample>___<multiplicity>' : 'Intensity <sample>',
      },
    };
  },
};
