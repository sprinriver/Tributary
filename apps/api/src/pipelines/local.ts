import type { LogLink } from '@tributary/contracts';
import { execFile } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Storage } from '../storage.ts';
import { parseS3Uri, type ObservedStatus, type PipelineRunner, type RunSpec } from './runner.ts';

const exec = promisify(execFile);

export interface LocalRunnerConfig {
  /** Image with Nextflow (offline-capable: NXF_OFFLINE=true). */
  image: string;
  /** Repository root: definitions with repo `pipelines/<dir>` run from here. */
  repoRoot: string;
  /** Mounted read-only at /fixtures (synthetic inputs referenced by the demo pipeline's params). */
  fixturesDir: string;
  /** Host directory for run work dirs. */
  workRoot: string;
}

const PARAM = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** Nextflow in Docker on this machine (development and CI). Status from `docker inspect`, logs from `docker logs`. */
export class LocalDockerRunner implements PipelineRunner {
  readonly kind = 'local' as const;
  readonly #config: LocalRunnerConfig;
  readonly #storage: Storage;

  constructor(config: LocalRunnerConfig, storage: Storage) {
    this.#config = config;
    this.#storage = storage;
  }

  #dir(externalId: string) {
    return join(this.#config.workRoot, externalId);
  }

  async start(spec: RunSpec) {
    const repo = spec.pipeline.repo;
    if (!/^pipelines\/[a-z0-9_-]+$/.test(repo)) {
      throw new Error(`The local runner only runs pipelines/<dir> from this repository, not ${repo}.`);
    }
    const name = `trb-run-${spec.runId}`;
    const dir = this.#dir(name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
    const params = Object.entries(spec.params).flatMap(([k, v]) => {
      if (!PARAM.test(k)) throw new Error(`Invalid parameter name ${k}`);
      return [`--${k}`, String(v)];
    });
    await exec('docker', [
      'run',
      '-d',
      '--name',
      name,
      '-e',
      'NXF_OFFLINE=true',
      '-e',
      'NXF_ANSI_LOG=false',
      '-v',
      `${resolve(this.#config.repoRoot, repo)}:/pipeline:ro`,
      '-v',
      `${resolve(this.#config.fixturesDir)}:/fixtures:ro`,
      '-v',
      `${resolve(dir)}:/work`,
      '-w',
      '/work',
      this.#config.image,
      'nextflow',
      'run',
      '/pipeline/main.nf',
      '-with-trace',
      '/work/trace.txt',
      '--outdir',
      '/work/output',
      ...params,
    ]);
    return { externalId: name, workDir: dir };
  }

  async getStatus(externalId: string): Promise<ObservedStatus> {
    let state: { Status: string; ExitCode: number; StartedAt: string; FinishedAt: string; Error?: string };
    try {
      const { stdout } = await exec('docker', ['inspect', '--format', '{{json .State}}', externalId]);
      state = JSON.parse(stdout) as typeof state;
    } catch {
      return { status: 'failed', externalStatus: 'missing', reason: 'The run container no longer exists.' };
    }
    const dir = this.#dir(externalId);
    if (state.Status === 'created') return { status: 'pending', externalStatus: 'created' };
    if (state.Status === 'running')
      return { status: 'running', externalStatus: 'running', at: new Date(state.StartedAt) };
    const at = new Date(state.FinishedAt);
    if (existsSync(join(dir, '.cancelled')))
      return { status: 'cancelled', externalStatus: `exited:${state.ExitCode}`, at };
    if (state.Status === 'exited' && state.ExitCode === 0) {
      await this.#uploadOutputs(dir);
      return { status: 'succeeded', externalStatus: 'exited:0', at };
    }
    return {
      status: 'failed',
      externalStatus: `${state.Status}:${state.ExitCode}`,
      at,
      reason: state.Error || `Nextflow exited with ${state.ExitCode}`,
    };
  }

  /** Copies /work/output to the run's output prefix in object storage, once. */
  async #uploadOutputs(dir: string) {
    if (existsSync(join(dir, '.uploaded'))) return;
    const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8')) as RunSpec;
    const { bucket, prefix } = parseS3Uri(spec.outputUri);
    const root = join(dir, 'output');
    const walk = (d: string): string[] =>
      existsSync(d)
        ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
          )
        : [];
    for (const file of walk(root)) {
      await this.#storage.putFile(
        bucket,
        `${prefix}${relative(root, file)}`,
        createReadStream(file),
        statSync(file).size,
      );
    }
    writeFileSync(join(dir, '.uploaded'), new Date().toISOString());
  }

  async cancel(externalId: string): Promise<void> {
    writeFileSync(join(this.#dir(externalId), '.cancelled'), new Date().toISOString());
    await exec('docker', ['stop', '--time', '10', externalId]).catch(() => undefined);
  }

  async logLinks(externalId: string): Promise<LogLink[]> {
    return [
      {
        label: 'Nextflow log (local work dir)',
        url: `file://${resolve(this.#dir(externalId), '.nextflow.log')}`,
      },
    ];
  }

  async recentLogs(externalId: string, lines: number): Promise<string[]> {
    try {
      const { stdout, stderr } = await exec('docker', ['logs', '--tail', String(lines), externalId], {
        maxBuffer: 4 * 1024 * 1024,
      });
      return `${stdout}${stderr}`.split('\n').filter((l) => l.trim() !== '');
    } catch {
      return [];
    }
  }
}
