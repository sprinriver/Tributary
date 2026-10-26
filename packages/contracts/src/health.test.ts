import { describe, expect, it } from 'vitest';
import { HealthStatusSchema } from './index.ts';

describe('HealthStatusSchema', () => {
  it('OPS-01: accepts a valid health payload', () => {
    expect(HealthStatusSchema.parse({ service: 'api', status: 'ok', version: '0.0.0' })).toEqual({
      service: 'api',
      status: 'ok',
      version: '0.0.0',
    });
  });

  it('OPS-01: rejects an unknown status', () => {
    expect(HealthStatusSchema.safeParse({ service: 'api', status: 'fine', version: '0.0.0' }).success).toBe(
      false,
    );
  });
});
