import type { FastifyInstance, FastifyRequest, InjectOptions } from 'fastify';
import { ToolError, type ToolContext } from './tools.ts';

/**
 * A tool context that calls the API in-process with the given credentials (SPEC §11.2: tools run as the user, so
 * authorisation, validation and audit are the API's own).
 */
export function injectContext(root: FastifyInstance, headers: Record<string, string>): ToolContext {
  return {
    async call(method, url, payload, extra) {
      const options: InjectOptions = {
        method,
        url,
        headers: extra?.reason ? { ...headers, 'x-change-reason': extra.reason } : headers,
      };
      if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
      const res = await root.inject(options);
      const body = res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null;
      // Tools do not tell apart "missing" from "not yours": both read as not found.
      if (res.statusCode === 404 || (res.statusCode === 403 && method === 'GET'))
        throw new ToolError('Not found, or not in a program you can read.');
      if (res.statusCode >= 400)
        throw new ToolError(String(body?.message ?? `The API answered ${res.statusCode}.`));
      return body;
    },
  };
}

/** The signed-in caller's own credentials (bearer token or session cookie with its CSRF token). */
export function requestContext(root: FastifyInstance, request: FastifyRequest): ToolContext {
  const headers: Record<string, string> = {};
  for (const h of ['authorization', 'cookie', 'x-csrf-token'] as const) {
    const v = request.headers[h];
    if (typeof v === 'string') headers[h] = v;
  }
  return injectContext(root, headers);
}
