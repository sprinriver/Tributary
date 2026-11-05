import { API_ROUTES, type ApiOperation, type ContractError } from '@tributary/contracts';
import type { z } from 'zod';

type Route<O extends ApiOperation> = (typeof API_ROUTES)[O];
export type ApiResponse<O extends ApiOperation> =
  Route<O> extends { response: infer S extends z.ZodType } ? z.infer<S> : void;
export type ApiBody<O extends ApiOperation> =
  Route<O> extends { body: infer S extends z.ZodType } ? z.input<S> : never;
export type ApiQuery<O extends ApiOperation> =
  Route<O> extends { query: infer S extends z.ZodType } ? z.input<S> : never;
type PathParams<P extends string> = P extends `${string}{${infer K}}${infer Rest}`
  ? K | PathParams<Rest>
  : never;

export interface ApiCallOptions<O extends ApiOperation> {
  params?: Record<PathParams<Route<O>['path']>, string>;
  query?: ApiQuery<O>;
  body?: ApiBody<O>;
  /** Sent as `X-Change-Reason` (recorded in the audit log). */
  reason?: string;
}

/** An API error with the contract body `{code, field?, message, errors?}`. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ContractError & { errors?: ContractError[] };
  constructor(status: number, body: ContractError & { errors?: ContractError[] }) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

let csrfToken: string | undefined;
/** True while `/v1/auth/me` is being fetched: mutations wait for its token rather than race it. */
let sessionPending = false;
const waiting: (() => void)[] = [];
/** How long a mutation waits for `/v1/auth/me` before it is sent anyway (and refused, if it needs a token). */
const SESSION_WAIT_MS = 10_000;
/**
 * Set from `/v1/auth/me` (undefined when signed out); sent as `X-CSRF-Token` on mutations. Mutations started while
 * the session is loading (a page that POSTs on load) wait for it instead of racing it.
 */
export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
  sessionPending = false;
  for (const resolve of waiting.splice(0)) resolve();
}
/** Marks `/v1/auth/me` as in flight (fetchMe); cleared by setCsrfToken or sessionFailed. */
export function sessionLoading(): void {
  sessionPending = true;
}
export function sessionFailed(): void {
  sessionPending = false;
  for (const resolve of waiting.splice(0)) resolve();
}
const sessionResolved = () =>
  !sessionPending
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        waiting.push(resolve);
        setTimeout(resolve, SESSION_WAIT_MS);
      });

/** Builds the request URL for an operation (path params encoded, query params dropped when empty). */
export function buildUrl(
  path: string,
  params: Record<string, string> = {},
  query: Record<string, unknown> = {},
): string {
  const filled = path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(params[key] ?? ''));
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) for (const v of value) search.append(key, String(v));
    else if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return `/api${filled}${qs ? `?${qs}` : ''}`;
}

/** Typed call to an operation in API_ROUTES; validates the response with the operation's contract schema. */
export async function api<O extends ApiOperation>(
  operation: O,
  options: ApiCallOptions<O> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResponse<O>> {
  const route = API_ROUTES[operation] as {
    method: string;
    path: string;
    response?: z.ZodType;
  };
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (route.method !== 'get') {
    await sessionResolved();
    headers['x-csrf-token'] = csrfToken ?? '';
  }
  if (options.reason) headers['x-change-reason'] = options.reason;
  const res = await fetchImpl(
    buildUrl(route.path, options.params as Record<string, string>, options.query as Record<string, unknown>),
    {
      method: route.method.toUpperCase(),
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    },
  );
  if (!res.ok) {
    const body = (await res
      .json()
      .catch(() => ({ code: 'http_error', message: `HTTP ${res.status}` }))) as ContractError;
    // Publishing and approving need a recent sign-in (SPEC M10): the shell asks the user to confirm identity.
    if (body.code === 'reauth_required' && typeof document !== 'undefined')
      document.dispatchEvent(new CustomEvent('tributary:reauth', { detail: body.message }));
    throw new ApiError(res.status, body);
  }
  if (!route.response || res.status === 204) return undefined as ApiResponse<O>;
  return route.response.parse(await res.json()) as ApiResponse<O>;
}
