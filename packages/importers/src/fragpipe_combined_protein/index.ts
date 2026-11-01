import { ImportError } from '../errors.ts';
import { buildWide, toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// FragPipe combined_protein.tsv (SOURCE.md; FragPipe docs "FragPipe output files").
const suffixed = (columns: string[], suffix: string) =>
  columns
    .filter((c) => c.endsWith(` ${suffix}`) && !c.startsWith('Combined '))
    .map((c) => ({ column: c, name: c.slice(0, -(suffix.length + 1)) }));

export const fragpipeCombinedProtein: Importer = {
  key: 'fragpipe_combined_protein',
  label: 'FragPipe combined_protein.tsv',
  kind: 'protein_quant',
  tool: 'FragPipe',
  version: '1.0.0',
  formats: ['tsv', 'text'],
  detect: (c) => c.includes('Protein ID') && c.includes('Protein Probability'),
  build(source, ctx, prefix) {
    if (!source.columns.includes('Protein ID'))
      throw new ImportError('wrong_format', 'Not a FragPipe combined_protein.tsv: no "Protein ID" column.');
    const maxlfq = suffixed(source.columns, 'MaxLFQ Intensity');
    // "[experiment] Intensity" excluding the Unique/Total/MaxLFQ variants.
    const topN = suffixed(source.columns, 'Intensity').filter(
      (r) => !/( Unique| Total| MaxLFQ)$/.test(r.name) && !r.name.endsWith(' MaxLFQ'),
    );
    const runs = maxlfq.length ? maxlfq : topN;
    if (!runs.length) throw new ImportError('wrong_format', 'No "[experiment] Intensity" columns found.');
    const label = maxlfq.length
      ? '[experiment] MaxLFQ Intensity (razor peptides, MaxLFQ)'
      : '[experiment] Intensity (razor peptides, top-N)';
    const built = buildWide(source, ctx, prefix, {
      groupColumn: 'Protein ID',
      genesColumn: 'Gene',
      runs,
      naTokens: [''],
      normalisation: maxlfq.length
        ? 'FragPipe MaxLFQ (normalised by default)'
        : 'FragPipe top-N (normalised by default)',
      zeros: 'FragPipe reports 0 when not quantified; zeros are kept and log2_intensity is null for them',
      toolVersion: toolVersion(ctx),
      mapping: { protein_group: 'Protein ID', gene_names: 'Gene', intensity: label },
    });
    built.transformations.unshift({
      step: 'select_quantity',
      detail: `Quantity columns: ${label}; Indistinguishable Proteins not merged`,
    });
    return built;
  },
};
