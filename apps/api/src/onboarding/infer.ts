// Legacy onboarding (ING-06): object keys → experiments, inferred sample manifests and file roles, using only the
// caller's path patterns. Pure: no storage or database access. Nothing is guessed: unmatched objects are reported.
import type { OnboardingPattern, OnboardingPlan, OnboardingSpec } from '@tributary/contracts';

interface CompiledPattern {
  pattern: OnboardingPattern;
  regex: RegExp;
  tokens: string[];
}

const TOKEN = /\{([a-z_][a-z0-9_]*|\*)\}/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `{experiment}/raw/{sample}.raw` → an anchored regex; tokens match within one path segment. */
export function compilePattern(pattern: OnboardingPattern): CompiledPattern {
  const tokens: string[] = [];
  let source = '';
  let last = 0;
  for (const m of pattern.path.matchAll(TOKEN)) {
    source += escape(pattern.path.slice(last, m.index));
    if (m[1] === '*') source += '[^/]+?';
    else {
      tokens.push(m[1]!);
      source += `(?<${m[1]}>[^/]+?)`;
    }
    last = m.index! + m[0].length;
  }
  source += escape(pattern.path.slice(last));
  return { pattern, regex: new RegExp(`^${source}$`), tokens };
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

/** Groups the objects under `spec.prefix` into experiments; first matching pattern wins. */
export function inferPlan(spec: OnboardingSpec, objects: { key: string; size: number }[]): OnboardingPlan {
  const compiled = spec.patterns.map(compilePattern);
  const experiments = new Map<string, OnboardingPlan['experiments'][number]>();
  const samples = new Map<string, Map<string, Record<string, string>>>();
  const unmatched: string[] = [];
  const warnings: string[] = [];

  for (const object of [...objects].sort((a, b) => a.key.localeCompare(b.key))) {
    const relative = object.key.slice(spec.prefix.length);
    const hit = compiled
      .map((c) => ({ c, m: c.regex.exec(relative) }))
      .find((x): x is { c: CompiledPattern; m: RegExpExecArray } => x.m !== null);
    if (!hit) {
      unmatched.push(object.key);
      continue;
    }
    const groups = hit.m.groups ?? {};
    const name = groups.experiment!;
    const experiment = experiments.get(name) ?? { name, samples: [], files: [] };
    experiments.set(name, experiment);
    const sampleKey = groups.sample ?? null;
    experiment.files.push({
      key: object.key,
      size_bytes: object.size,
      role: hit.c.pattern.role,
      sample_key: sampleKey,
      importer: hit.c.pattern.importer ?? null,
    });
    if (sampleKey === null) continue;

    // Manifest row: defaults, then every other token from the path, then the raw file it came from.
    const fileName = object.key.split('/').at(-1)!;
    const inferred: Record<string, string> = { sample_key: sampleKey };
    for (const token of hit.c.tokens) {
      if (token !== 'experiment' && token !== 'sample') inferred[token] = groups[token]!;
    }
    if (hit.c.pattern.role === 'raw') {
      inferred.raw_file = fileName;
      inferred.instrument_run = stem(fileName);
    }
    const bySample = samples.get(name) ?? new Map<string, Record<string, string>>();
    samples.set(name, bySample);
    const existing = bySample.get(sampleKey);
    if (!existing) {
      bySample.set(sampleKey, { ...inferred, ...(spec.sample_defaults ?? {}), ...inferred });
      continue;
    }
    for (const [column, value] of Object.entries(inferred)) {
      if (existing[column] === undefined) existing[column] = value;
      else if (existing[column] !== value) {
        warnings.push(
          `${name}/${sampleKey}: ${column} is "${existing[column]}" and "${value}" (kept "${existing[column]}")`,
        );
      }
    }
  }
  for (const [name, experiment] of experiments) {
    experiment.samples = [...(samples.get(name)?.values() ?? [])];
  }
  return {
    object_count: objects.length,
    experiments: [...experiments.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unmatched,
    warnings,
  };
}
