import * as client from 'openid-client';
import type { ApiConfig } from '../config.ts';

/** State kept in a short-lived signed cookie between /login and /callback. */
export interface LoginFlow {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

export interface LoginResult {
  sub: string;
  email: string;
  name: string;
  groups: string[];
  authTime: Date;
  idToken: string | null;
}

/**
 * Plain-http issuers are allowed in development, and in production only on localhost or `*.localhost` (a local
 * trial of the deployment). Such names never resolve to another machine, so no real deployment can use this.
 */
export function allowInsecureIssuer(issuer: string, production: boolean): boolean {
  const url = new URL(issuer);
  if (url.protocol !== 'http:') return false;
  if (!production) return true;
  return url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
}

/** What the API needs from RFC 7662 introspection. */
export interface Introspection {
  active: boolean;
  sub?: string;
  aud?: string | string[];
  scope?: string;
}

/** OIDC authorization code + PKCE, run by the API (BFF): tokens never reach the browser (SPEC §10). */
export class OidcClient {
  private configuration: Promise<client.Configuration> | undefined;
  private readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  /** The redirect URI registered at the IdP; the SPA proxies `/api` to this service. */
  get redirectUri(): string {
    return `${this.config.publicUrl}/api/v1/auth/callback`;
  }

  private discover(): Promise<client.Configuration> {
    this.configuration ??= client
      .discovery(
        new URL(this.config.oidc.issuer),
        this.config.oidc.clientId,
        this.config.oidc.clientSecret,
        undefined,
        allowInsecureIssuer(this.config.oidc.issuer, this.config.production)
          ? { execute: [client.allowInsecureRequests] }
          : undefined,
      )
      .catch((error: unknown) => {
        this.configuration = undefined;
        throw error;
      });
    return this.configuration;
  }

  /**
   * RFC 7662 token introspection at the IdP (MCP clients send IdP-issued access tokens). The caller checks
   * `active` and the audience.
   */
  async introspect(token: string): Promise<Introspection> {
    const result = await client.tokenIntrospection(await this.discover(), token);
    return {
      active: result.active,
      ...(typeof result.sub === 'string' ? { sub: result.sub } : {}),
      ...(result.aud ? { aud: result.aud as string | string[] } : {}),
      ...(typeof result.scope === 'string' ? { scope: result.scope } : {}),
    };
  }

  /** `reauth` asks the IdP for credentials again (OIDC `prompt=login`, `max_age=0`) even with a live IdP session. */
  async startLogin(
    returnTo: string,
    maxAge?: number,
    reauth = false,
  ): Promise<{ url: URL; flow: LoginFlow }> {
    const configuration = await this.discover();
    const flow: LoginFlow = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      verifier: client.randomPKCECodeVerifier(),
      returnTo,
    };
    const params: Record<string, string> = {
      redirect_uri: this.redirectUri,
      scope: 'openid profile email',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
      code_challenge_method: 'S256',
    };
    if (maxAge !== undefined) params.max_age = String(maxAge);
    if (reauth) {
      params.max_age = '0';
      params.prompt = 'login';
    }
    return { url: client.buildAuthorizationUrl(configuration, params), flow };
  }

  async finishLogin(callbackQuery: string, flow: LoginFlow): Promise<LoginResult> {
    const configuration = await this.discover();
    const currentUrl = new URL(this.redirectUri);
    currentUrl.search = callbackQuery;
    const tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('The identity provider returned no ID token.');
    const groups = claims[this.config.oidc.groupsClaim];
    const str = (value: unknown) => (typeof value === 'string' ? value : '');
    return {
      sub: claims.sub,
      email: str(claims.email),
      name: str(claims.name) || str(claims.preferred_username) || claims.sub,
      groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
      authTime: authTimeFrom(claims.auth_time),
      idToken: tokens.id_token ?? null,
    };
  }

  async logoutUrl(idToken: string | null): Promise<string> {
    const configuration = await this.discover();
    const params: Record<string, string> = { post_logout_redirect_uri: `${this.config.publicUrl}/` };
    if (idToken) params.id_token_hint = idToken;
    return client.buildEndSessionUrl(configuration, params).href;
  }
}

/**
 * When the user last entered credentials (OIDC `auth_time`). An IdP may omit the claim when no `max_age` was
 * asked for; a missing claim then counts as long ago, so publishing still requires re-authentication (which
 * sends `max_age=0`, making the claim mandatory) instead of trusting a silent sign-in as fresh.
 */
export function authTimeFrom(claim: unknown): Date {
  return typeof claim === 'number' && Number.isFinite(claim) ? new Date(claim * 1000) : new Date(0);
}
