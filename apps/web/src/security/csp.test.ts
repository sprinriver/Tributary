import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cspHeader } from './csp.ts';

// The one policy: CloudFront (Terraform) and the Vite dev/preview servers both build their header from it.
const POLICY = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../infra/terraform/modules/cloudfront/csp.json'),
    'utf8',
  ),
) as Record<string, string[]>;
const UPLOADS = 'https://tributary-raw.s3.eu-west-1.amazonaws.com';

describe('Content-Security-Policy', () => {
  it('SEC-01: the production policy is strict: same origin, no eval or inline script, no framing, uploads to the raw bucket only', () => {
    const header = cspHeader(POLICY, { uploadOrigin: UPLOADS });
    // Directives sorted by name, as Terraform iterates the JSON object.
    expect(header).toBe(
      [
        "base-uri 'self'",
        `connect-src 'self' ${UPLOADS}`,
        "default-src 'self'",
        "font-src 'self' data:",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "worker-src 'self' blob:",
      ].join('; '),
    );
  });

  it('SEC-01: the dev server only adds inline scripts (the React refresh preamble); everything else is the same', () => {
    const prod = cspHeader(POLICY, { uploadOrigin: UPLOADS }).split('; ');
    const dev = cspHeader(POLICY, { uploadOrigin: UPLOADS, dev: true }).split('; ');
    expect(dev.filter((d) => !prod.includes(d))).toEqual(["script-src 'self' 'unsafe-inline'"]);
  });

  it('SEC-01: the upload origin must be a bare http(s) origin', () => {
    for (const bad of ['*', 'https://a.example/path', "https://a.example; script-src 'unsafe-eval'", 'data:'])
      expect(() => cspHeader(POLICY, { uploadOrigin: bad })).toThrow(/origin/);
  });
});
