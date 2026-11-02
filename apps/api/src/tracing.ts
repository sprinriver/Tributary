// Request IDs and W3C trace context end to end (SPEC §9 Observability, OPS-08), without an OTel SDK:
// - every request gets an id (a valid inbound `x-request-id`, else a UUID), echoed in the response and logged as
//   pino's `reqId`;
// - an inbound `traceparent` (https://www.w3.org/TR/trace-context/#traceparent-header) continues its trace,
//   else a new trace starts; the trace id is logged as `traceId`;
// - calls to the internal services (query, compute) carry `x-request-id` and a child `traceparent`, so their logs
//   share the id. Third-party calls never receive either header.
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';

export interface TraceContext {
  requestId: string;
  traceId: string;
  flags: string;
}

const storage = new AsyncLocalStorage<TraceContext>();
const resources = new WeakMap<FastifyRequest, AsyncResource>();
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A caller-supplied request id, if it is safe to log and forward. */
export function validRequestId(value: string | string[] | undefined): string | undefined {
  const id = header(value);
  return id !== undefined && REQUEST_ID.test(id) ? id : undefined;
}

/** Fastify `genReqId`: keep a valid inbound `x-request-id`, else a new UUID. */
export const genRequestId = (req: IncomingMessage): string =>
  validRequestId(req.headers['x-request-id']) ?? randomUUID();

export function parseTraceparent(value: string | undefined): { traceId: string; flags: string } | undefined {
  const m = value ? TRACEPARENT.exec(value) : null;
  if (!m || /^0+$/.test(m[1]!) || /^0+$/.test(m[2]!)) return undefined;
  return { traceId: m[1]!, flags: m[3]! };
}

const newSpanId = () => randomBytes(8).toString('hex');

export const currentTrace = (): TraceContext | undefined => storage.getStore();

/** Hooks that open the trace context for each request and keep it across body parsing (as @fastify/request-context does). */
export function registerTracing(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    const requestId =
      validRequestId(request.headers['x-request-id']) ?? (UUID.test(request.id) ? request.id : randomUUID());
    const parent = parseTraceparent(header(request.headers.traceparent));
    const context: TraceContext = {
      requestId,
      traceId: parent?.traceId ?? randomBytes(16).toString('hex'),
      flags: parent?.flags ?? '01',
    };
    request.log = request.log.child(
      requestId === request.id ? { traceId: context.traceId } : { traceId: context.traceId, requestId },
    );
    void reply.header('x-request-id', requestId);
    storage.run(context, () => {
      resources.set(request, new AsyncResource('tributary-request'));
      done();
    });
  });
  // Body parsing runs on the socket's async context; re-enter the request's context before the handler.
  app.addHook('preValidation', (request, _reply, done) => {
    const resource = resources.get(request);
    if (resource) resource.runInAsyncScope(done);
    else done();
  });
}

function isInternal(url: string, origins: Set<string>): boolean {
  try {
    return origins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

/** Wraps fetch so calls to `internalOrigins` carry the current request id and a child traceparent. */
export function tracedFetch(inner: typeof fetch, internalOrigins: string[]): typeof fetch {
  const origins = new Set(internalOrigins.map((u) => new URL(u).origin));
  return (input, init) => {
    const context = storage.getStore();
    const url = input instanceof Request ? input.url : String(input);
    if (!context || !isInternal(url, origins)) return inner(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('x-request-id')) headers.set('x-request-id', context.requestId);
    if (!headers.has('traceparent'))
      headers.set('traceparent', `00-${context.traceId}-${newSpanId()}-${context.flags}`);
    return inner(input, { ...init, headers: Object.fromEntries(headers) });
  };
}
