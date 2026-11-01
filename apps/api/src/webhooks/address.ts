import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Loopback, private, link-local, CGNAT, unspecified, multicast/reserved and IPv6 ULA/link-local addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

/**
 * SSRF guard (production): every address the host resolves to must be public. Checked when a subscription is
 * created and again before each delivery (DNS can change between the two).
 */
export async function assertPublicDestination(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress))
    throw new Error('The webhook host resolves to a private or reserved address.');
}
