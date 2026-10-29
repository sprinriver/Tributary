import type { MetadataFieldDef, VersionDiff } from '@tributary/contracts';

interface DiffSide {
  fields: Record<string, unknown>;
  custom: Record<string, unknown>;
  customFields: MetadataFieldDef[];
  samples: { sample_key: string; raw: Record<string, string> }[];
  contrasts: { label: string }[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sorted = (values: Iterable<string>) => [...values].sort();

function changes(before: Record<string, unknown>, after: Record<string, unknown>) {
  return sorted(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((key) => !same(before[key], after[key]))
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

/** Exactly what changed from `base` to `target`: version fields, custom values/fields, sample rows, contrasts. */
export function diffVersions(base: DiffSide, target: DiffSide): VersionDiff {
  const baseSamples = new Map(base.samples.map((s) => [s.sample_key, s.raw]));
  const targetSamples = new Map(target.samples.map((s) => [s.sample_key, s.raw]));
  // Raw cells compare as text; a missing cell equals an empty one.
  const cells = (raw: Record<string, string>) =>
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v.trim() !== ''));
  const fieldIds = (side: DiffSide) => new Set(side.customFields.map((f) => `${f.scope}.${f.key}`));
  const baseFields = fieldIds(base);
  const targetFields = fieldIds(target);
  const baseContrasts = new Set(base.contrasts.map((c) => c.label));
  const targetContrasts = new Set(target.contrasts.map((c) => c.label));

  return {
    fields: changes(base.fields, target.fields),
    custom: changes(base.custom, target.custom),
    custom_fields: {
      added: sorted([...targetFields].filter((f) => !baseFields.has(f))),
      removed: sorted([...baseFields].filter((f) => !targetFields.has(f))),
    },
    samples: {
      added: sorted([...targetSamples.keys()].filter((k) => !baseSamples.has(k))),
      removed: sorted([...baseSamples.keys()].filter((k) => !targetSamples.has(k))),
      changed: sorted([...baseSamples.keys()].filter((k) => targetSamples.has(k)))
        .map((key) => ({
          sample_key: key,
          fields: changes(cells(baseSamples.get(key) ?? {}), cells(targetSamples.get(key) ?? {})),
        }))
        .filter((c) => c.fields.length > 0),
    },
    contrasts: {
      added: sorted([...targetContrasts].filter((c) => !baseContrasts.has(c))),
      removed: sorted([...baseContrasts].filter((c) => !targetContrasts.has(c))),
    },
  };
}
