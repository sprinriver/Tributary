import { BatchClient } from '@aws-sdk/client-batch';
import { OmicsClient } from '@aws-sdk/client-omics';
import { AwsBatchRunner, HealthOmicsRunner } from './aws.ts';
import type { Runners } from './runner.ts';

/**
 * AWS runners from the environment (set by infra/terraform): AWS Batch with BATCH_JOB_QUEUE and
 * BATCH_JOB_DEFINITION, HealthOmics with OMICS_WORKFLOW_ID and OMICS_ROLE_ARN. Credentials come from the task role.
 */
export function runnersFromEnv(env: NodeJS.ProcessEnv = process.env): Runners {
  const region = env.AWS_REGION ?? env.S3_REGION ?? 'us-east-1';
  const runners: Runners = {};
  if (env.BATCH_JOB_QUEUE || env.BATCH_JOB_DEFINITION) {
    if (!env.BATCH_JOB_QUEUE || !env.BATCH_JOB_DEFINITION)
      throw new Error('AWS Batch needs both BATCH_JOB_QUEUE and BATCH_JOB_DEFINITION');
    runners.aws_batch = new AwsBatchRunner(new BatchClient({ region }), {
      jobQueue: env.BATCH_JOB_QUEUE,
      jobDefinition: env.BATCH_JOB_DEFINITION,
      region,
      logGroup: env.BATCH_LOG_GROUP ?? '/aws/batch/job',
    });
  }
  if (env.OMICS_WORKFLOW_ID || env.OMICS_ROLE_ARN) {
    if (!env.OMICS_WORKFLOW_ID || !env.OMICS_ROLE_ARN)
      throw new Error('HealthOmics needs both OMICS_WORKFLOW_ID and OMICS_ROLE_ARN');
    runners.healthomics = new HealthOmicsRunner(new OmicsClient({ region }), {
      workflowId: env.OMICS_WORKFLOW_ID,
      roleArn: env.OMICS_ROLE_ARN,
      region,
    });
  }
  return runners;
}
