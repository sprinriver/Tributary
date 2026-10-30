import { DescribeJobsCommand, SubmitJobCommand, TerminateJobCommand } from '@aws-sdk/client-batch';
import { CancelRunCommand, GetRunCommand, StartRunCommand } from '@aws-sdk/client-omics';
import type { LogLink, RunStatus } from '@tributary/contracts';
import type { ObservedStatus, PipelineRunner, RunSpec } from './runner.ts';

// AWS adapters. Clients are injected ({ send }) so tests stub them without network access.

export interface SendClient {
  send(command: unknown): Promise<unknown>;
}

/** CloudWatch Logs console deep link (the console's fragment encoding replaces "%" with "$25"). */
export function cloudWatchLink(region: string, group: string, stream: string): string {
  const enc = (s: string) => encodeURIComponent(s).replaceAll('%', '$25');
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${enc(group)}/log-events/${enc(stream)}`;
}

/** AWS Batch job states (Batch User Guide "Job states") → run states. */
export function batchStatus(status: string, reason?: string): RunStatus {
  switch (status) {
    case 'SUBMITTED':
      return 'submitted';
    case 'PENDING':
    case 'RUNNABLE':
      return 'pending';
    case 'STARTING':
      return 'starting';
    case 'RUNNING':
      return 'running';
    case 'SUCCEEDED':
      return 'succeeded';
    case 'FAILED':
      // TerminateJob records its reason; our cancel passes "Terminated by Tributary".
      return reason?.startsWith('Terminated by Tributary') ? 'cancelled' : 'failed';
    default:
      return 'pending';
  }
}

/** HealthOmics run states (GetRun status) → run states. */
export function omicsStatus(status: string): RunStatus {
  const map: Record<string, RunStatus> = {
    PENDING: 'pending',
    STARTING: 'starting',
    RUNNING: 'running',
    STOPPING: 'stopping',
    COMPLETED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    DELETED: 'cancelled',
  };
  return map[status] ?? 'pending';
}

const paramArgs = (params: RunSpec['params']) =>
  Object.entries(params).flatMap(([k, v]) => [`--${k}`, String(v)]);

export interface BatchConfig {
  jobQueue: string;
  /** Job definition of the Nextflow head job (Nextflow docs, "AWS Batch": the head job submits task jobs). */
  jobDefinition: string;
  region: string;
  logGroup: string;
}

export class AwsBatchRunner implements PipelineRunner {
  readonly kind = 'aws_batch' as const;
  readonly #client: SendClient;
  readonly #config: BatchConfig;

  constructor(client: SendClient, config: BatchConfig) {
    this.#client = client;
    this.#config = config;
  }

  async start(spec: RunSpec) {
    const res = (await this.#client.send(
      new SubmitJobCommand({
        jobName: `trb-${spec.pipeline.key}-${spec.runId.slice(0, 8)}`,
        jobQueue: this.#config.jobQueue,
        jobDefinition: this.#config.jobDefinition,
        containerOverrides: {
          command: [
            'nextflow',
            'run',
            spec.pipeline.repo,
            '-r',
            spec.pipeline.revision,
            '-work-dir',
            spec.workUri,
            '-with-trace',
            '-ansi-log',
            'false',
            '--outdir',
            spec.outputUri,
            ...paramArgs(spec.params),
          ],
          environment: [{ name: 'TRIBUTARY_RUN_ID', value: spec.runId }],
        },
        tags: { 'tributary:run-id': spec.runId },
        propagateTags: true,
      }),
    )) as { jobId?: string };
    if (!res.jobId) throw new Error('AWS Batch returned no jobId');
    return { externalId: res.jobId, workDir: spec.workUri };
  }

  async #job(jobId: string) {
    const res = (await this.#client.send(new DescribeJobsCommand({ jobs: [jobId] }))) as {
      jobs?: {
        status?: string;
        statusReason?: string;
        startedAt?: number;
        stoppedAt?: number;
        container?: { logStreamName?: string };
      }[];
    };
    const job = res.jobs?.[0];
    if (!job) throw new Error(`AWS Batch job ${jobId} not found`);
    return job;
  }

  async getStatus(jobId: string): Promise<ObservedStatus> {
    const job = await this.#job(jobId);
    const status = batchStatus(job.status ?? 'PENDING', job.statusReason);
    const at = job.stoppedAt ?? job.startedAt;
    return {
      status,
      externalStatus: job.status ?? 'UNKNOWN',
      at: at ? new Date(at) : undefined,
      reason: job.statusReason,
    };
  }

  async cancel(jobId: string): Promise<void> {
    await this.#client.send(
      new TerminateJobCommand({ jobId, reason: 'Terminated by Tributary (user cancel)' }),
    );
  }

  async logLinks(jobId: string): Promise<LogLink[]> {
    const stream = (await this.#job(jobId)).container?.logStreamName;
    return stream
      ? [
          {
            label: 'Nextflow head job (CloudWatch)',
            url: cloudWatchLink(this.#config.region, this.#config.logGroup, stream),
          },
        ]
      : [];
  }

  async recentLogs(): Promise<string[]> {
    return []; // Lines come from CloudWatch Logs via the link; reading them needs logs:GetLogEvents (Phase 21 IAM).
  }
}

export interface OmicsConfig {
  workflowId: string;
  roleArn: string;
  region: string;
}

const OMICS_LOG_GROUP = '/aws/omics/WorkflowLog';

export class HealthOmicsRunner implements PipelineRunner {
  readonly kind = 'healthomics' as const;
  readonly #client: SendClient;
  readonly #config: OmicsConfig;

  constructor(client: SendClient, config: OmicsConfig) {
    this.#client = client;
    this.#config = config;
  }

  async start(spec: RunSpec) {
    const res = (await this.#client.send(
      new StartRunCommand({
        workflowId: this.#config.workflowId,
        roleArn: this.#config.roleArn,
        name: `trb-${spec.pipeline.key}-${spec.runId.slice(0, 8)}`,
        // Idempotency: a retried launch of the same run returns the same HealthOmics run.
        requestId: spec.runId,
        outputUri: spec.outputUri,
        parameters: spec.params,
        tags: { 'tributary:run-id': spec.runId },
      }),
    )) as { id?: string };
    if (!res.id) throw new Error('HealthOmics returned no run id');
    return { externalId: res.id };
  }

  async getStatus(id: string): Promise<ObservedStatus> {
    const run = (await this.#client.send(new GetRunCommand({ id }))) as {
      status?: string;
      statusMessage?: string;
      startTime?: Date;
      stopTime?: Date;
    };
    return {
      status: omicsStatus(run.status ?? 'PENDING'),
      externalStatus: run.status ?? 'UNKNOWN',
      at: run.stopTime ?? run.startTime,
      reason: run.statusMessage,
    };
  }

  async cancel(id: string): Promise<void> {
    await this.#client.send(new CancelRunCommand({ id }));
  }

  async logLinks(id: string): Promise<LogLink[]> {
    // HealthOmics writes run logs to /aws/omics/WorkflowLog, stream run/<id>/engine (and run/<id>/task/<task>).
    return [
      {
        label: 'Engine log (CloudWatch)',
        url: cloudWatchLink(this.#config.region, OMICS_LOG_GROUP, `run/${id}/engine`),
      },
      {
        label: 'Run manifest log (CloudWatch)',
        url: cloudWatchLink(this.#config.region, OMICS_LOG_GROUP, `manifest/run/${id}`),
      },
    ];
  }

  async recentLogs(): Promise<string[]> {
    return [];
  }
}
