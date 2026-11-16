// API rate limiting (Phase 44, SEC-03), without a dependency. A fixed-window counter per key, in memory: the limit
// is per API process (with N replicas a client can make up to N times the limit), so a WAF rate rule remains the
// global limit. Keys: the hash of the credential sent (bearer token or session cookie), else the client address.
import type { FastifyInstance } from 'fastify';
import { ASSERTION_HEADER, verifyAssertion } from './auth/assertion.ts';
import { sha256 } from './auth/crypto.ts';
import { SESSION_COOKIE } from './auth/sessions.ts';
import { HttpError } from './errors.ts';

export interface RateLimitConfig {
  /** Requests per minute per credential; 0 turns limiting off. */
  perMinute: number;
  /** Requests per minute per client address when no credential is sent. */
  anonymousPerMinute: number;
}

export function createLimiter(options: { windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();
  return {
    take(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
      const t = now();
      // Forget finished windows once per window, so memory follows the clients of the current window only.
      if (t - lastSweep >= options.windowMs) {
        for (const [k, w] of windows) if (t - w.start >= options.windowMs) windows.delete(k);
        lastSweep = t;
      }
      let w = windows.get(key);
      if (!w || t - w.start >= options.windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= limit)
        return { allowed: false, retryAfterSeconds: Math.ceil((w.start + options.windowMs - t) / 1000) };
      w.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size: () => windows.size,
  };
}

const SESSION = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`);

/** Registers the limiter before authentication, so guessing credentials is limited too. */
export function registerRateLimit(app: FastifyInstance, config: RateLimitConfig): void {
  if (config.perMinute <= 0) return;
  const limiter = createLimiter({ windowMs: 60_000 });
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === '/healthz' || path === '/readyz') return;
    // In-process calls the MCP endpoint makes for an already authenticated (and limited) request.
    const assertion = request.headers[ASSERTION_HEADER];
    if (typeof assertion === 'string' && verifyAssertion(assertion)) return;
    const bearer = request.headers.authorization;
    const session = SESSION.exec(request.headers.cookie ?? '')?.[1];
    const credential = bearer ?? session;
    const result = credential
      ? limiter.take(`c:${sha256(credential)}`, config.perMinute)
      : limiter.take(`a:${request.ip}`, config.anonymousPerMinute);
    if (!result.allowed) {
      void reply.header('retry-after', String(result.retryAfterSeconds));
      throw new HttpError(
        429,
        'rate_limited',
        `Too many requests: try again in ${result.retryAfterSeconds} s.`,
      );
    }
  });
}
