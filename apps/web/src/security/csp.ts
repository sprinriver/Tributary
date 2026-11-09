// Content-Security-Policy header (Phase 40, SEC-01) from the one policy in
// infra/terraform/modules/cloudfront/csp.json. CloudFront builds the same string in Terraform: directives sorted
// by name, sources in order, "{upload_origin}" replaced by the raw bucket's origin, joined with "; ".
// Used by vite.config.ts for the dev and preview servers; pure so it is unit-tested.

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;

export function cspHeader(
  policy: Record<string, string[]>,
  options: { uploadOrigin: string; dev?: boolean },
): string {
  if (!ORIGIN.test(options.uploadOrigin))
    throw new Error(`The upload origin must be a bare http(s) origin, got "${options.uploadOrigin}".`);
  return Object.keys(policy)
    .sort()
    .map((name) => {
      const sources = policy[name]!.map((s) => (s === '{upload_origin}' ? options.uploadOrigin : s));
      // The dev server injects the React refresh preamble as an inline script.
      if (options.dev && name === 'script-src') sources.push("'unsafe-inline'");
      return `${name} ${sources.join(' ')}`;
    })
    .join('; ');
}
