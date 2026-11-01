import { DescribeJobsCommand, SubmitJobCommand, TerminateJobCommand } from '@aws-sdk/client-batch';
import { CancelRunCommand, GetRunCommand, StartRunCommand } from '@aws-sdk/client-omics';
import { describe, expect, it } from 'vitest';
import { AwsBatchRunner, batchStatus, HealthOmicsRunner, omicsStatus } from './aws.ts';
import type { RunSpec } from './runner.ts';

/** A client stub: records commands, answers by command class. */
function stub(answers: Map<unknown, (input: Record<string, unknown>) => unknown>) {
  const sent: { command: unknown; input: Record<string, unknown> }[] = [];
  return {
    sent,
    client: {
      async send(command: { input: Record<string, unknown>; constructor: unknown }) {
        sent.push({ command: command.constructor, input: command.input });
        const answer = answers.get(command.constructor);
        if (!answer) throw new Error(`unexpected ${String((command.constructor as { name: string }).name)}`);
        return answer(command.input);
      },
    },
  };
}

const SPEC: RunSpec = {
  runId: '0190a000-0000-7000-8000-000000000001',
  pipeline: { key: 'demo', repo: 'nf-core/quantms', revision: '1.6.0' },
  params: { input: 's3://raw/x.sdrf.tsv' },
  workUri: 's3://work/runs/0190a000-0000-7000-8000-000000000001/work/',
  outputUri: 's3://work/runs/0190a000-0000-7000-8000-000000000001/output/',
};

describe('PIPE-01: AWS Batch adapter', () => {
  it('PIPE-01: start submits the Nextflow head job; status, cancel and logs map Batch fields', async () => {
    const { client, sent } = stub(
      new Map<unknown, (i: Record<string, unknown>) => unknown>([
        [SubmitJobCommand, () => ({ jobId: 'job-1', jobName: 'trb-demo' })],
        [
          DescribeJobsCommand,
          () => ({
            jobs: [
              {
                jobId: 'job-1',
                status: 'RUNNING',
                startedAt: 1793300000000,
                container: { logStreamName: 'trb/default/abc' },
              },
            ],
          }),
        ],
        [TerminateJobCommand, () => ({})],
      ]),
    );
    const runner = new AwsBatchRunner(client, {
      jobQueue: 'trb-head',
      jobDefinition: 'trb-nextflow-head:3',
      region: 'eu-west-2',
      logGroup: '/aws/batch/job',
    });
    expect(await runner.start(SPEC)).toMatchObject({ externalId: 'job-1' });
    const submit = sent[0]!.input as {
      jobQueue: string;
      containerOverrides: { command: string[] };
      tags: Record<string, string>;
    };
    expect(submit.jobQueue).toBe('trb-head');
    expect(submit.containerOverrides.command).toEqual(
      expect.arrayContaining([
        'nextflow',
        'run',
        'nf-core/quantms',
        '-r',
        '1.6.0',
        '-work-dir',
        SPEC.workUri,
        '--outdir',
        SPEC.outputUri,
      ]),
    );
    expect(submit.tags['tributary:run-id']).toBe(SPEC.runId);
    expect(await runner.getStatus('job-1')).toMatchObject({ status: 'running', externalStatus: 'RUNNING' });
    await runner.cancel('job-1');
    expect(sent.at(-1)).toMatchObject({ command: TerminateJobCommand, input: { jobId: 'job-1' } });
    const links = await runner.logLinks('job-1');
    expect(links[0]!.url).toContain('eu-west-2');
    expect(links[0]!.url).toContain(encodeURIComponent('trb/default/abc').replaceAll('%', '$25'));
  });

  it('PIPE-01: Batch states map to run states', () => {
    expect(
      ['SUBMITTED', 'PENDING', 'RUNNABLE', 'STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED'].map((s) =>
        batchStatus(s),
      ),
    ).toEqual(['submitted', 'pending', 'pending', 'starting', 'running', 'succeeded', 'failed']);
    expect(batchStatus('FAILED', 'Terminated by Tributary')).toBe('cancelled');
  });
});

describe('PIPE-01: HealthOmics adapter', () => {
  it('PIPE-01: StartRun uses the run id as requestId; GetRun/CancelRun; log stream ARNs', async () => {
    const { client, sent } = stub(
      new Map<unknown, (i: Record<string, unknown>) => unknown>([
        [StartRunCommand, () => ({ id: '1234567', status: 'PENDING' })],
        [
          GetRunCommand,
          () => ({
            id: '1234567',
            status: 'COMPLETED',
            startTime: new Date('2026-10-30T10:00:00Z'),
            stopTime: new Date('2026-10-30T11:00:00Z'),
          }),
        ],
        [CancelRunCommand, () => ({})],
      ]),
    );
    const runner = new HealthOmicsRunner(client, {
      workflowId: '9876543',
      roleArn: 'arn:aws:iam::123456789012:role/trb-omics',
      region: 'eu-west-2',
    });
    expect(await runner.start(SPEC)).toMatchObject({ externalId: '1234567' });
    expect(sent[0]!.input).toMatchObject({
      requestId: SPEC.runId,
      workflowId: '9876543',
      roleArn: 'arn:aws:iam::123456789012:role/trb-omics',
      outputUri: SPEC.outputUri,
      parameters: SPEC.params,
    });
    expect(await runner.getStatus('1234567')).toMatchObject({
      status: 'succeeded',
      externalStatus: 'COMPLETED',
    });
    await runner.cancel('1234567');
    expect(sent.at(-1)).toMatchObject({ command: CancelRunCommand, input: { id: '1234567' } });
    const links = await runner.logLinks('1234567');
    expect(links.map((l) => l.url).join(' ')).toContain('run$252F1234567$252Fengine');
  });

  it('PIPE-01: HealthOmics states map to run states', () => {
    expect(
      ['PENDING', 'STARTING', 'RUNNING', 'STOPPING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DELETED'].map((s) =>
        omicsStatus(s),
      ),
    ).toEqual([
      'pending',
      'starting',
      'running',
      'stopping',
      'succeeded',
      'failed',
      'cancelled',
      'cancelled',
    ]);
  });
});
