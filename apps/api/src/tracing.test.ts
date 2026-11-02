import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { registerTracing, tracedFetch } from './tracing.ts';

const TRACE = '0af7651916cd43dd8448eb211c80319c';
const INBOUND = `00-${TRACE}-b7ad6b7169203331-01`;

/** A bare app with tracing and one route that calls an internal and an external service. */
function harness() {
  const calls: { url: string; headers: Headers }[] = [];
  const stub: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  const outbound = tracedFetch(stub, ['http://query.internal:3100', 'http://compute.internal:8000']);
  const app = Fastify({ genReqId: () => 'unused' });
  registerTracing(app);
  app.get('/probe', async () => {
    await outbound('http://query.internal:3100/internal/query', { method: 'POST', headers: { a: 'b' } });
    await new Promise((r) => setTimeout(r, 5)); // context survives awaits and timers
    await outbound('http://compute.internal:8000/stats/cluster');
    await outbound('https://api.example.com/v1/messages');
    return { id: 'ok' };
  });
  return { app, calls };
}

describe('request IDs and trace context', () => {
  it('OPS-08: an inbound x-request-id and traceparent are kept, echoed and sent to query and compute', async () => {
    const { app, calls } = harness();
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-request-id': 'req-abc12345', traceparent: INBOUND },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-abc12345');
    const [query, compute, external] = calls;
    for (const call of [query!, compute!]) {
      expect(call.headers.get('x-request-id')).toBe('req-abc12345');
      const parts = call.headers.get('traceparent')!.split('-');
      expect(parts[0]).toBe('00');
      expect(parts[1]).toBe(TRACE); // same trace
      expect(parts[2]).toMatch(/^[0-9a-f]{16}$/);
      expect(parts[2]).not.toBe('b7ad6b7169203331'); // a new span
    }
    expect(query!.headers.get('a')).toBe('b'); // caller headers are kept
    // Ids never leak to third parties.
    expect(external!.headers.get('x-request-id')).toBeNull();
    expect(external!.headers.get('traceparent')).toBeNull();
    await app.close();
  });

  it('OPS-08: a missing or malformed id or traceparent is replaced by fresh ones', async () => {
    const { app, calls } = harness();
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-request-id': 'bad id with spaces\n', traceparent: '00-zzzz-1-01' },
    });
    const id = res.headers['x-request-id'] as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]!.headers.get('x-request-id')).toBe(id);
    expect(calls[0]!.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(calls[0]!.headers.get('traceparent')!.split('-')[1]).not.toBe('0'.repeat(32));
    await app.close();
  });

  it("OPS-08: every log line of a request carries its trace id, including Fastify's own completion line", async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) };
    const api = buildApp({ server: { logger: { level: 'info', stream } } });
    await api.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'req-log12345', traceparent: INBOUND },
    });
    await api.close();
    const mine = lines.filter((l) => l.reqId === 'req-log12345');
    expect(mine.map((l) => l.msg)).toEqual(expect.arrayContaining(['incoming request', 'request completed']));
    for (const line of mine) expect(line.traceId).toBe(TRACE);
  });

  describe('in the API', () => {
    const app = buildApp();
    afterAll(() => app.close());
    it('OPS-08: the API echoes the request id it logs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { 'x-request-id': 'req-xyz98765' },
      });
      expect(res.headers['x-request-id']).toBe('req-xyz98765');
    });
  });
});
