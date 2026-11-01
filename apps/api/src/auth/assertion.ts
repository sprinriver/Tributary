import { createHmac, randomBytes } from 'node:crypto';
import type { TokenScope } from './tokens.ts';
import { safeEqual } from './crypto.ts';

/** Header carrying an in-process call made for a user who authenticated at the MCP endpoint (OAuth or PAT). */
export const ASSERTION_HEADER = 'x-tributary-assertion';
const TTL_SECONDS = 60;

interface Assertion {
  /** User id. */
  u: string;
  s: TokenScope[];
  /** Expiry, unix seconds. */
  exp: number;
}

/**
 * A key that exists only in this process's memory: assertions are created and consumed by in-process calls, so no
 * configured secret (and nothing an attacker could learn from the deployment) can mint one.
 */
const PROCESS_KEY = randomBytes(32);
const mac = (payload: string) => createHmac('sha256', PROCESS_KEY).update(payload).digest('base64url');

/** A short-lived, HMAC-signed statement that the API already authenticated this user (never leaves the process). */
export function signAssertion(userId: string, scopes: TokenScope[], now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, s: scopes, exp: Math.floor(now / 1000) + TTL_SECONDS } satisfies Assertion),
  ).toString('base64url');
  return `${payload}.${mac(payload)}`;
}

export function verifyAssertion(value: string, now = Date.now()): Assertion | undefined {
  const [payload, sig] = value.split('.');
  if (!payload || !sig || !safeEqual(sig, mac(payload))) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Assertion;
    return parsed.exp * 1000 >= now && typeof parsed.u === 'string' && Array.isArray(parsed.s)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
