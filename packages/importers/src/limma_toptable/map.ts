/** topTable column → canonical column (SOURCE.md; limma `man/toptable.Rd`, 3.99.3). */
export const NUMERIC_MAP: Record<string, string> = {
  log2_fc: 'logFC',
  ci_low: 'CI.L',
  ci_high: 'CI.R',
  avg_log2_abundance: 'AveExpr',
  t_stat: 't',
  p_value: 'P.Value',
  adj_p_value: 'adj.P.Val',
};
