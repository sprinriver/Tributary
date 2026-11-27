// Headers for requests the API makes to public services (AlphaFold DB, UniProt). Some refuse anonymous clients:
// AlphaFold DB answers 403 to Node's default User-Agent (checked against the live service, 2026-11).
export const USER_AGENT = 'Tributary/2 (self-hosted experiment data platform)';

export const outboundHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  'user-agent': USER_AGENT,
  ...extra,
});
