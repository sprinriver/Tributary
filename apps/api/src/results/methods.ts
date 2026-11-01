// SPEC M8: an auto-written methods paragraph the scientist can copy. Deterministic: built only from recorded
// provenance (run, releases, contrasts, thresholds), with every list sorted, so the same inputs give the same text.

export interface MethodsInput {
  experiment: { name: string; assay_type: string; species: string | null; sample_count: number };
  run: {
    pipeline_name: string;
    pipeline_repo: string;
    revision: string;
    runner: string;
    params: Record<string, unknown>;
  } | null;
  releases: {
    kind: string;
    importer: string | null;
    tool: string | null;
    tool_version: string | null;
    method: string | null;
    adj_method: string | null;
  }[];
  contrasts: string[];
  thresholds: { fc: number; p: number };
}

const ADJ: Record<string, string> = {
  BH: 'Benjamini–Hochberg',
  BY: 'Benjamini–Yekutieli',
  bonferroni: 'Bonferroni',
  holm: 'Holm',
  none: 'no',
};
const ASSAY: Record<string, string> = {
  proteomics_dia: 'data-independent acquisition (DIA) proteomics',
  proteomics_tmt: 'TMT-labelled proteomics',
  rnaseq: 'RNA-seq',
  crispr_screen: 'CRISPR screen',
};
const KIND: Record<string, string> = {
  protein_quant: 'protein quantities',
  precursor_quant: 'precursor quantities',
  differential_abundance: 'differential abundance',
  dose_response: 'dose-response curves',
  qc_metrics: 'QC metrics',
  rnaseq_counts: 'gene counts',
  crispr_gene_summary: 'CRISPR gene scores',
};

const tool = (r: MethodsInput['releases'][number]) =>
  !r.tool
    ? (r.importer ?? 'an unnamed tool')
    : !r.tool_version || r.tool_version === 'unknown'
      ? `${r.tool} (version not recorded)`
      : `${r.tool} ${r.tool_version}`;
const value = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);

export function methodsParagraph(input: MethodsInput): string {
  const e = input.experiment;
  const parts: string[] = [];
  parts.push(
    `${e.name}: ${ASSAY[e.assay_type] ?? e.assay_type} of ${e.sample_count} samples${e.species ? ` (${e.species})` : ''}.`,
  );
  if (input.run) {
    const params = Object.keys(input.run.params)
      .sort()
      .map((k) => `${k} = ${value(input.run!.params[k])}`);
    parts.push(
      `Data were processed with ${input.run.pipeline_name} (${input.run.pipeline_repo}, revision ${input.run.revision}; ${input.run.runner} runner)` +
        (params.length ? ` with parameters ${params.join(', ')}.` : '.'),
    );
  } else {
    parts.push('Results were imported from tool outputs (no pipeline run recorded).');
  }
  const releases = [...input.releases].sort((a, b) =>
    `${a.kind}${a.importer}`.localeCompare(`${b.kind}${b.importer}`),
  );
  for (const r of releases)
    parts.push(`${KIND[r.kind] ?? r.kind} came from ${tool(r)}.`.replace(/^./, (c) => c.toUpperCase()));
  const da = releases.filter((r) => r.kind === 'differential_abundance');
  if (input.contrasts.length) {
    const adj = [...new Set(da.map((r) => r.adj_method).filter((m): m is string => !!m))].sort();
    const unadjusted = adj.length > 0 && adj.every((m) => m === 'none');
    const feature = ['rnaseq', 'crispr_screen'].includes(e.assay_type) ? 'genes' : 'proteins';
    parts.push(
      `Contrasts (log2 fold change = log2(numerator / denominator)): ${[...input.contrasts].sort().join('; ')}.` +
        (da.length
          ? ` Results pages highlight ${feature} at |log2 fold change| ≥ ${input.thresholds.fc} and ${unadjusted ? 'p' : 'adjusted p'} ≤ ${input.thresholds.p} (display thresholds, not part of the tool's test)` +
            (adj.length && !unadjusted
              ? `; p-values were adjusted by ${adj.map((m) => ADJ[m] ?? m).join(' / ')}, as reported by the tool.`
              : '.')
          : ''),
    );
  }
  return parts.join(' ');
}
