import { ImportError } from '../errors.ts';
import type { Importer } from '../types.ts';
import { toolVersion } from '../shared/wide.ts';

// HUPO-PSI mzQC 1.0.0 (SOURCE.md; schema/mzqc_schema.json).
interface CvParam {
  accession?: unknown;
  name?: unknown;
  value?: unknown;
  unit?: unknown;
}
const stem = (name: string) =>
  (name.split(/[\\/]/).at(-1) ?? name).replace(/\.(raw|d|wiff2?|mzml|dia)$/i, '');
const unitName = (unit: unknown): string | null => {
  const first = Array.isArray(unit) ? unit[0] : unit;
  return first && typeof first === 'object' && typeof (first as CvParam).name === 'string'
    ? ((first as CvParam).name as string)
    : null;
};

export const mzqc: Importer = {
  key: 'mzqc',
  label: 'mzQC file (HUPO-PSI)',
  kind: 'qc_metrics',
  tool: 'mzQC',
  version: '1.0.0',
  formats: ['text'],
  input: 'json',
  detect: () => false,
  build(source, ctx, prefix) {
    const doc = (
      source.json as { mzQC?: { runQualities?: unknown; setQualities?: unknown; version?: unknown } } | null
    )?.mzQC;
    if (!doc || !Array.isArray(doc.runQualities)) {
      throw new ImportError(
        'wrong_format',
        'Not an mzQC file: expected an "mzQC" object with "runQualities".',
      );
    }
    const rows: { key: string; metric: string; value: number; unit: string | null }[] = [];
    let skipped = 0;
    for (const rq of doc.runQualities as {
      metadata?: { inputFiles?: { name?: unknown }[] };
      qualityMetrics?: CvParam[];
    }[]) {
      const file = rq.metadata?.inputFiles?.[0]?.name;
      if (typeof file !== 'string') {
        throw new ImportError(
          'no_input_file',
          'An mzQC runQuality has no inputFiles name, so its run cannot be identified.',
        );
      }
      const key = stem(file);
      for (const m of rq.qualityMetrics ?? []) {
        if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
          skipped++;
          continue;
        }
        rows.push({
          key,
          metric: `${String(m.name)} (${String(m.accession)})`,
          value: m.value,
          unit: unitName(m.unit),
        });
      }
    }
    const sets = Array.isArray(doc.setQualities) ? doc.setQualities.length : 0;
    const table = `${prefix}_mzqc`;
    const params: Record<string, string | number | null> = {};
    const values = rows
      .map((r, i) => {
        params[`k${i}`] = r.key;
        params[`m${i}`] = r.metric;
        params[`v${i}`] = r.value;
        params[`u${i}`] = r.unit;
        return `($k${i}, $m${i}, $v${i}::DOUBLE, $u${i})`;
      })
      .join(', ');
    return {
      setup: [
        {
          sql: `CREATE OR REPLACE TEMP TABLE ${table} (scope_key VARCHAR, metric VARCHAR, value DOUBLE, unit VARCHAR)${values ? `; INSERT INTO ${table} VALUES ${values}` : ''}`,
          params,
        },
      ],
      select: `SELECT $ev::UUID AS experiment_version_id, 'run' AS scope, scope_key, metric, value, unit,
        NULL::DOUBLE AS threshold, 'not_assessed' AS status FROM ${table}`,
      params: { ev: ctx.experimentVersionId ?? null },
      rules: [],
      transformations: [
        {
          step: 'flatten',
          detail:
            'runQualities[].qualityMetrics[] → one row per run × numeric metric; scope_key = input file name without extension',
        },
        {
          step: 'not_imported',
          detail: `${skipped} non-numeric metric value(s) and ${sets} setQualities entr${sets === 1 ? 'y' : 'ies'} not imported`,
        },
        { step: 'status', detail: 'mzQC has no thresholds: status not_assessed' },
      ],
      naTokens: [],
      toolVersion: typeof doc.version === 'string' ? `mzQC ${doc.version}` : toolVersion(ctx),
    };
  },
};
