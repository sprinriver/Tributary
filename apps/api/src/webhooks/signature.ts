import { createHmac } from 'node:crypto';
import { safeEqual } from '../auth/crypto.ts';

/** Deliveries older than this are treated as replays. */
export const TOLERANCE_SECONDS = 300;

export const signatureOf = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** `X-Tributary-Signature` value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. */
export const signatureHeader = (secret: string, body: string, now = Date.now()) => {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${signatureOf(secret, t, body)}`;
};

/**
 * Verifies a delivery as a receiver would (the Python SDK has the same function): the HMAC over the raw body and
 * the timestamp, within the tolerance window. `now` is unix seconds.
 */
export function verifyWebhook(
  secret: string,
  header: string,
  body: string,
  options: { now?: number; toleranceSeconds?: number } = {},
): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!match) return false;
  const t = Number(match[1]);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (options.toleranceSeconds ?? TOLERANCE_SECONDS)) return false;
  return safeEqual(match[2]!, signatureOf(secret, t, body));
}
