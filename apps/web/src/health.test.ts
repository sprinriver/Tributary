import { describe, expect, it } from 'vitest';
import { describeHealth, fetchApiHealth } from './health.ts';

describe('home page API health', () => {
  it('OPS-01: shows ok when the API reports ok', () => {
    expect(
      describeHealth({ state: 'success', health: { service: 'api', status: 'ok', version: '0.0.0' } }),
    ).toEqual({ label: 'API: ok', tone: 'ok' });
  });

  it('OPS-01: shows unreachable on error', () => {
    expect(describeHealth({ state: 'error' })).toEqual({ label: 'API: unreachable', tone: 'error' });
  });

  it('OPS-01: rejects a malformed health payload', async () => {
    const fakeFetch = (async () => Response.json({ status: 'fine' })) as typeof fetch;
    await expect(fetchApiHealth(fakeFetch)).rejects.toThrow();
  });
});
