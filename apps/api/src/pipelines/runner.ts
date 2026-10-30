import type { LogLink, RunStatus, RunnerKind } from '@tributary/contracts';

// SPEC §7.4 PipelineRunner: one interface, adapters for local Docker, AWS Batch and HealthOmics (and a fake for tests).

export interface RunSpec {
  runId: string;
  pipeline: { key: string; repo: string; revision: string };
  params: Record<string, string | number | boolean>;
  /** s3://<work bucket>/runs/<run-id>/work/ and …/output/ (ARCHITECTURE §5). */
  workUri: string;
  outputUri: string;
}

export interface ObservedStatus {
  status: RunStatus;
  /** The runner's own state name (idempotency key with the time). */
  externalStatus: string;
  /** When the runner reports the state started; defaults to now. */
  at?: Date | undefined;
  reason?: string | undefined;
}

export interface PipelineRunner {
  readonly kind: RunnerKind;
  start(spec: RunSpec): Promise<{ externalId: string; workDir?: string | undefined }>;
  getStatus(externalId: string): Promise<ObservedStatus>;
  cancel(externalId: string): Promise<void>;
  logLinks(externalId: string): Promise<LogLink[]>;
  /** Most recent log lines, when the runner can read them. */
  recentLogs(externalId: string, lines: number): Promise<string[]>;
}

export type Runners = Partial<Record<RunnerKind, PipelineRunner>>;

/** Splits s3://bucket/prefix into its parts. */
export function parseS3Uri(uri: string): { bucket: string; prefix: string } {
  const url = new URL(uri);
  if (url.protocol !== 's3:') throw new Error(`Not an s3:// URI: ${uri}`);
  return { bucket: url.host, prefix: url.pathname.replace(/^\//, '') };
}
