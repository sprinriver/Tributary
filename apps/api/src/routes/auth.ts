import { CreateTokenBodySchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { upsertLoginUser } from '../auth/login-user.ts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { writeAudit } from '../audit.ts';
import type { OidcClient, LoginFlow } from '../auth/oidc.ts';
import { requirePrincipal } from '../auth/plugin.ts';
import { loadPrincipal } from '../auth/principal.ts';
import { createSession, revokeSession, SESSION_COOKIE } from '../auth/sessions.ts';
import { createPersonalAccessToken, listTokens, revokePersonalAccessToken } from '../auth/tokens.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, notFound, parse } from '../errors.ts';

const FLOW_COOKIE = 'trb_oidc';

/** Only same-origin relative paths: blocks open redirects such as `//evil.example`. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
    ? value
    : '/';
}

const htmlEscape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

export function registerAuthRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig,
  oidc: OidcClient,
): void {
  const cookieBase = { httpOnly: true, secure: config.production, path: '/' } as const;

  app.get('/v1/auth/login', { config: { public: true } }, async (request, reply) => {
    const { returnTo, reauth } = request.query as { returnTo?: string; reauth?: string };
    const { url, flow } = await oidc.startLogin(safeReturnTo(returnTo), undefined, reauth === '1');
    // Lax: the IdP redirects back with a top-level GET from another site in production.
    reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), {
      ...cookieBase,
      sameSite: 'lax',
      signed: true,
      maxAge: 600,
    });
    return reply.redirect(url.href);
  });

  app.get('/v1/auth/callback', { config: { public: true } }, async (request, reply) => {
    const raw = request.cookies[FLOW_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : undefined;
    if (!unsigned?.valid || !unsigned.value)
      throw new HttpError(400, 'login_expired', 'Sign-in expired; try again.');
    const flow = JSON.parse(unsigned.value) as LoginFlow;
    const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
    const login = await oidc.finishLogin(query, flow);

    const userId = await db
      .transaction()
      .execute((trx) => upsertLoginUser(trx as unknown as Database, config.tenantId, login));

    const session = await createSession(db, userId, {
      idToken: login.idToken,
      ttlHours: config.sessionTtlHours,
      authTime: login.authTime,
    });
    request.principal =
      (await loadPrincipal(db, config, userId, {
        type: 'session',
        sessionId: session.id,
        csrfToken: session.csrfToken,
        idToken: login.idToken,
        authTime: login.authTime,
      })) ?? null;
    await writeAudit(db, request, {
      action: 'auth.login',
      entityType: 'app_user',
      entityId: userId,
      reason: null,
    });

    reply.clearCookie(FLOW_COOKIE, { path: '/' });
    reply.setCookie(SESSION_COOKIE, session.cookieValue, {
      ...cookieBase,
      sameSite: 'strict',
      expires: session.expiresAt,
    });
    // Strict cookies are not sent on the redirect chain that started at the IdP, so finish with a same-site
    // navigation from this page instead of an HTTP redirect.
    const target = htmlEscape(safeReturnTo(flow.returnTo));
    return reply
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><meta http-equiv="refresh" content="0;url=${target}"><a href="${target}">Continue</a>`,
      );
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const principal = requirePrincipal(request);
    if (principal.via.type !== 'session')
      throw new HttpError(400, 'not_a_session', 'Only browser sessions sign out.');
    const logoutUrl = await oidc.logoutUrl(principal.via.idToken).catch(() => `${config.publicUrl}/`);
    await revokeSession(db, principal.via.sessionId);
    await writeAudit(db, request, {
      action: 'auth.logout',
      entityType: 'app_user',
      entityId: principal.userId,
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { logout_url: logoutUrl };
  });

  app.get('/v1/auth/me', async (request) => {
    const p = requirePrincipal(request);
    return {
      user: { id: p.userId, name: p.name, email: p.email, kind: p.kind },
      roles: p.bindings.map((b) => ({
        program_id: b.program_id,
        program_code: b.program_code ?? null,
        role: b.role,
      })),
      auth: p.via.type,
      ...(p.via.type === 'session'
        ? { csrf_token: p.via.csrfToken, auth_time: p.via.authTime.toISOString() }
        : {}),
      reauth_max_age_seconds: request.reauthMaxAgeSeconds,
    };
  });

  app.get('/v1/auth/tokens', async (request) => listTokens(db, requirePrincipal(request).userId));

  app.post('/v1/auth/tokens', async (request, reply: FastifyReply) => {
    const principal = requirePrincipal(request);
    const body = parse(CreateTokenBodySchema, request.body);
    const created = await db.transaction().execute(async (trx) => {
      const token = await createPersonalAccessToken(trx as unknown as Database, principal.userId, {
        name: body.name,
        scopes: body.scopes,
        expiresAt: new Date(Date.now() + body.expires_in_days * 86_400_000),
      });
      await writeAudit(trx, request, {
        action: 'access_token.create',
        entityType: 'access_token',
        entityId: token.id,
        after: {
          name: body.name,
          scopes: body.scopes,
          expires_at: token.expiresAt,
          token_prefix: token.prefix,
        },
      });
      return token;
    });
    return reply.status(201).send({
      id: created.id,
      token: created.token,
      token_prefix: created.prefix,
      expires_at: created.expiresAt,
    });
  });

  app.delete('/v1/auth/tokens/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const principal = requirePrincipal(request);
    await db.transaction().execute(async (trx) => {
      const revoked = await revokePersonalAccessToken(
        trx as unknown as Database,
        principal.userId,
        request.params.id,
      );
      if (!revoked) throw notFound('Access token');
      await writeAudit(trx, request, {
        action: 'access_token.revoke',
        entityType: 'access_token',
        entityId: request.params.id,
      });
    });
    return reply.status(204).send();
  });
}
