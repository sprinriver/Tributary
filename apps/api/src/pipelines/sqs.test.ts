import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { consumeOnce } from './sqs.ts';

describe('PIPE-02: SQS consumer', () => {
  it('PIPE-02: deletes handled messages and leaves failed ones for redelivery', async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof ReceiveMessageCommand) {
          return {
            Messages: [
              { Body: JSON.stringify({ source: 'aws.batch', detail: { jobId: 'ok' } }), ReceiptHandle: 'r1' },
              {
                Body: JSON.stringify({ source: 'aws.batch', detail: { jobId: 'boom' } }),
                ReceiptHandle: 'r2',
              },
            ],
          };
        }
        return {};
      },
    };
    const result = await consumeOnce(client, 'https://sqs.example/q', async (m) => {
      if ((m as { detail: { jobId: string } }).detail.jobId === 'boom') throw new Error('db down');
    });
    expect(result).toEqual({ handled: 1, failed: 1 });
    const deletes = sent.filter((c) => c instanceof DeleteMessageCommand) as DeleteMessageCommand[];
    expect(deletes.map((d) => d.input.ReceiptHandle)).toEqual(['r1']);
  });
});
