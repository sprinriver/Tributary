import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createStaticTermIndex,
  SEED_PROTEOMICS_TEMPLATE,
  SEED_TERMS,
  validateManifest,
  type AssayTypeKey,
  type ManifestRow,
} from '@tributary/contracts';

// Reads the synthetic corpus written by `pnpm synth` (fixtures/README.md describes every file).

export interface FixtureProgram {
  code: string;
  name: string;
  description: string;
}

export interface FixtureExperiment {
  key: string;
  program_code: string;
  assay_type: AssayTypeKey;
  name: string;
  description: string;
  experiment_date: string;
  species: { id: string; label: string };
  template_version: string;
  manifest: string;
  outputs: string[];
  contrasts: { label: string; numerator: string; denominator: string }[];
}

export interface FixtureFile {
  relativePath: string;
  sha256: string;
  sizeBytes: number;
}

const readJson = <T>(dir: string, path: string) => JSON.parse(readFileSync(join(dir, path), 'utf8')) as T;

/** Tab-separated file with a header row and no quoting (the synth writer never quotes). */
export function readTsv(dir: string, path: string): Record<string, string>[] {
  const [header, ...lines] = readFileSync(join(dir, path), 'utf8').trimEnd().split('\n');
  const columns = (header ?? '').split('\t');
  return lines.map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? '']));
  });
}

export function describeFile(dir: string, relativePath: string): FixtureFile {
  const full = join(dir, relativePath);
  return {
    relativePath,
    sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
    sizeBytes: statSync(full).size,
  };
}

export const readPrograms = (dir: string) => readJson<FixtureProgram[]>(dir, 'programs.json');
export const readExperiments = (dir: string) => readJson<FixtureExperiment[]>(dir, 'experiments.json');

/** Validates a manifest against the seed template exactly as the editor will (SPEC M2), then returns typed rows. */
export function readManifest(dir: string, experiment: FixtureExperiment): ManifestRow[] {
  const raw = readTsv(dir, `experiments/${experiment.key}/${experiment.manifest}`);
  const result = validateManifest(SEED_PROTEOMICS_TEMPLATE, [], raw, {
    termIndex: createStaticTermIndex(SEED_TERMS),
    plateFormat: '96',
  });
  if (!result.ok) {
    const first = result.errors.slice(0, 3).map((e) => `${e.field}: ${e.message}`);
    throw new Error(`Manifest of ${experiment.key} is invalid: ${first.join('; ')}`);
  }
  return result.rows;
}
