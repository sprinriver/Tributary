import { ImportError } from '../errors.ts';
import { ident } from '../sql.ts';
import { removedRowsRule } from '../shared/runs.ts';
import { buildWide, toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// MaxQuant proteinGroups.txt (SOURCE.md; flag columns per MSstatsConvert clean_MaxQuant.R).
const FLAGS = ['Reverse', 'Potential contaminant', 'Contaminant', 'Only identified by site'];
const FLAG_SOURCE =
  'SPEC §6.3 maxquant_protein_groups: remove reverse/contaminant rows only if flagged ("+")';

export const maxquantProteinGroups: Importer = {
  key: 'maxquant_protein_groups',
  label: 'MaxQuant proteinGroups.txt',
  kind: 'protein_quant',
  tool: 'MaxQuant',
  version: '1.0.0',
  formats: ['tsv', 'text'],
  detect: (c) =>
    c.includes('Protein IDs') && c.some((x) => x.startsWith('Intensity ') || x.startsWith('LFQ intensity ')),
  build(source, ctx, prefix) {
    const lfq = source.columns.filter((c) => c.startsWith('LFQ intensity '));
    const plain = source.columns.filter(
      // Label-free only: SILAC channel columns (Intensity L/M/H …) are not samples.
      (c) => c.startsWith('Intensity ') && !/^Intensity [LMH]( |$)/.test(c),
    );
    const quant = lfq.length ? lfq : plain;
    if (!source.columns.includes('Protein IDs') || !quant.length) {
      throw new ImportError(
        'wrong_format',
        'Not a MaxQuant proteinGroups table: expected Protein IDs and Intensity columns.',
      );
    }
    const prefixText = lfq.length ? 'LFQ intensity ' : 'Intensity ';
    const flags = FLAGS.filter((f) => source.columns.includes(f));
    const keep = ctx.options?.keep_flagged === true;
    const flagged = flags.map((f) => `coalesce(trim(${ident(f)}), '') = '+'`).join(' OR ') || 'false';
    const built = buildWide(source, ctx, prefix, {
      groupColumn: 'Protein IDs',
      genesColumn: 'Gene names',
      runs: quant.map((column) => ({ column, name: column.slice(prefixText.length) })),
      naTokens: ['', 'NaN'],
      normalisation: lfq.length ? 'MaxQuant LFQ' : null,
      qValueSql: source.columns.includes('Q-value') ? ident('Q-value') : undefined,
      where: keep ? undefined : `NOT (${flagged})`,
      zeros:
        'MaxQuant writes 0 when a group is not quantified; zeros are kept as reported and log2_intensity is null for them',
      toolVersion: toolVersion(ctx),
      mapping: {
        protein_group: 'Protein IDs',
        gene_names: 'Gene names',
        intensity: `${prefixText}<sample>`,
        q_value: 'Q-value',
      },
    });
    built.transformations.unshift({
      step: 'select_quantity',
      detail: `Quantity columns: "${prefixText}<sample>" (${quant.length})`,
    });
    if (!keep && flags.length) {
      built.transformations.push({
        step: 'filter',
        detail: `Rows with "+" in ${flags.join(', ')} removed (count in rule flagged_rows_removed)`,
      });
      built.rules.push(
        removedRowsRule(
          'flagged_rows_removed',
          FLAG_SOURCE,
          `SELECT ${ident('Protein IDs')} AS example FROM ${source.table} WHERE ${flagged}`,
          'protein group row(s)',
        ),
      );
    }
    return built;
  },
};
