import { describe, expect, it } from 'vitest';
import { runnersFromEnv } from './env-runners.ts';

/** A Terraform deployment configures the AWS runners through the API's environment (infra/terraform/envs/dev). */
describe('pipeline runners from the environment', () => {
  it('PIPE-01: AWS Batch and HealthOmics runners are created when their settings are present', () => {
    const runners = runnersFromEnv({
      AWS_REGION: 'eu-west-2',
      BATCH_JOB_QUEUE: 'arn:aws:batch:eu-west-2:111122223333:job-queue/tributary-dev-pipelines',
      BATCH_JOB_DEFINITION: 'tributary-dev-nextflow-head',
      OMICS_WORKFLOW_ID: '1234567',
      OMICS_ROLE_ARN: 'arn:aws:iam::111122223333:role/tributary-dev-healthomics-runs',
    });
    expect(Object.keys(runners).sort()).toEqual(['aws_batch', 'healthomics']);
    expect(runners.aws_batch?.kind).toBe('aws_batch');
    expect(runners.healthomics?.kind).toBe('healthomics');
  });

  it('PIPE-01: no settings, no runners; half a configuration is an error', () => {
    expect(runnersFromEnv({})).toEqual({});
    expect(() => runnersFromEnv({ BATCH_JOB_QUEUE: 'q' })).toThrow(/BATCH_JOB_DEFINITION/);
    expect(() => runnersFromEnv({ OMICS_WORKFLOW_ID: 'w' })).toThrow(/OMICS_ROLE_ARN/);
  });
});
