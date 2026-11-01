import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.ts';
import { forbidden, HttpError, unauthenticated } from '../errors.ts';
import { inProgram, type Action, type SubjectType } from './abilities.ts';
import { safeEqual } from './crypto.ts';
import { loadPrincipal, type Principal } from './principal.ts';
import { findSession, SESSION_COOKIE } from './sessions.ts';
import { findToken } from './tokens.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
    /** Browser sessions older than this must sign in again to publish or approve (SPEC M10). */
    reauthMaxAgeSeconds: number;
  }
  interface FastifyContextConfig {
    /** Routes reachable without signing in (health, login callback). */
    public?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Resolves the caller from a Bearer personal access token or the session cookie, enforces PAT scopes and the
 * CSRF token for cookie-authenticated mutations, and rejects anonymous calls to non-public routes.
 */
export function registerAuth(app: FastifyInstance, db: Database, config: ApiConfig): void {
  app.decorateRequest('principal', null);
  app.decorateRequest('reauthMaxAgeSeconds', 0);

  app.addHook('onRequest', async (request) => {
    request.reauthMaxAgeSeconds = config.reauthMaxAgeSeconds;
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token = await findToken(db, header.slice('Bearer '.length).trim());
      if (token) {
        request.principal =
          (await loadPrincipal(db, config, token.userId, {
            type: 'token',
            tokenId: token.id,
            scopes: token.scopes,
          })) ?? null;
      }
      if (!request.principal) throw unauthenticated();
      if (!SAFE_METHODS.has(request.method) && !token?.scopes.includes('write')) {
        throw new HttpError(403, 'insufficient_scope', 'This access token is read-only.');
      }
    } else {
      const cookie = request.cookies[SESSION_COOKIE];
      const session = cookie ? await findSession(db, cookie) : undefined;
      if (session) {
        request.principal =
          (await loadPrincipal(db, config, session.userId, {
            type: 'session',
            sessionId: session.id,
            csrfToken: session.csrfToken,
            idToken: session.idToken,
            authTime: session.authTime,
          })) ?? null;
        const sent = request.headers['x-csrf-token'];
        if (request.principal && !SAFE_METHODS.has(request.method)) {
          if (typeof sent !== 'string' || !safeEqual(sent, session.csrfToken)) {
            throw new HttpError(403, 'csrf', 'Missing or invalid CSRF token.');
          }
        }
      }
    }
    if (!request.principal && !request.routeOptions.config.public) throw unauthenticated();
  });
}

export function requirePrincipal(request: FastifyRequest): Principal {
  if (!request.principal) throw unauthenticated();
  return request.principal;
}

/** Throws 403 unless the caller may do `action` on `type` in the program. */
export function authorize(
  request: FastifyRequest,
  action: Action,
  type: SubjectType,
  programId: string,
): Principal {
  const principal = requirePrincipal(request);
  if (!principal.ability.can(action, inProgram(type, programId))) throw forbidden();
  return principal;
}

/** Program ids the caller may read; scoping for list queries. `null` means every program (system admin). */
export function readablePrograms(principal: Principal): string[] | null {
  if (principal.bindings.some((b) => b.role === 'system_admin')) return null;
  return [...new Set(principal.bindings.map((b) => b.program_id).filter((id): id is string => id !== null))];
}

/** Throws 403 unless the caller holds the global system_admin role (program admins do not qualify). */
export function requireSystemAdmin(request: FastifyRequest): Principal {
  const principal = requirePrincipal(request);
  if (!principal.bindings.some((b) => b.role === 'system_admin')) throw forbidden();
  return principal;
}

/**
 * Part 11-ready control (SPEC M10, §10): publishing, approving, rejecting and overriding need a recent sign-in.
 * Browser sessions older than the configured age get 401 `reauth_required`; the UI sends the user through the IdP
 * with `prompt=login` and `max_age=0`. API tokens are not interactive and are exempt (their scopes still apply).
 */
export function requireRecentAuth(request: FastifyRequest): void {
  const principal = requirePrincipal(request);
  if (principal.via.type !== 'session') return;
  const ageSeconds = (Date.now() - principal.via.authTime.getTime()) / 1000;
  if (ageSeconds > request.reauthMaxAgeSeconds) {
    const minutes = Math.round(request.reauthMaxAgeSeconds / 60);
    throw new HttpError(
      401,
      'reauth_required',
      `Sign in again to confirm it is you: this needs a sign-in within the last ${minutes} minutes.`,
    );
  }
}
