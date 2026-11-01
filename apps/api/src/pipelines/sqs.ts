import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import type { SendClient } from './aws.ts';

/**
 * EventBridge → SQS consumer for run state changes (aws.batch, aws.omics). A message is deleted only after
 * `handle` succeeds, so failures are retried by SQS; `handle` is idempotent (applyRunStatus).
 */
export async function consumeOnce(
  client: SendClient,
  queueUrl: string,
  handle: (message: object) => Promise<unknown>,
  waitSeconds = 20,
): Promise<{ handled: number; failed: number }> {
  const res = (await client.send(
    new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: waitSeconds }),
  )) as { Messages?: { Body?: string; ReceiptHandle?: string }[] };
  let handled = 0;
  let failed = 0;
  for (const message of res.Messages ?? []) {
    try {
      await handle(JSON.parse(message.Body ?? '{}') as object);
      await client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
      );
      handled++;
    } catch {
      failed++; // Left on the queue: visible again after the visibility timeout (and to the DLQ after N tries).
    }
  }
  return { handled, failed };
}
