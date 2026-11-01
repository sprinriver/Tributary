import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { redact } from '../ai/assistant.ts';
import { injectContext } from '../ai/context.ts';
import { REGISTRY } from '../ai/registry.ts';
import { aiSettings } from '../ai/settings.ts';
import { API_VERSION } from '../version.ts';
import { insertAudit } from '../audit.ts';
import { ASSERTION_HEADER, signAssertion } from '../auth/assertion.ts';
import type { Introspection } from '../auth/oidc.ts';
import { findToken, type TokenScope } from '../auth/tokens.ts';
import type { ApiConfig } from '../config.ts';

/** MCP tool results stay well under ~25k tokens (ARCHITECTURE §11). */
const MAX_TEXT = 90_000;

interface Caller {
  userId: string;
  tenantId: string;
  scopes: TokenScope[];
  via: 'pat' | 'oauth';
}

interface Deps {
  root: FastifyInstance;
  db: Database;
  config: ApiConfig;
  introspect: (token: string) => Promise<Introspection>;
}

/** The public URL of the protected-resource metadata (RFC 9728), as MCP clients reach it through `/api`. */
const metadataUrl = (config: ApiConfig) => `${config.publicUrl}/api/.well-known/oauth-protected-resource/mcp`;

/**
 * A PAT (`trb_…`, any scope), or an IdP access token that is active, issued for this resource and carries
 * `tributary:read` (`tributary:write` adds writes).
 */
async function authenticate(deps: Deps, request: FastifyRequest): Promise<Caller | undefined> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  const pat = await findToken(deps.db, token);
  const oauth = pat ? undefined : await oauthUser(deps, token);
  const userId = pat?.userId ?? oauth?.userId;
  if (!userId) return undefined;
  const user = await deps.db
    .selectFrom('app_user')
    .select(['id', 'tenant_id'])
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) return undefined;
  return {
    userId: user.id,
    tenantId: user.tenant_id,
    scopes: pat?.scopes ?? oauth!.scopes,
    via: pat ? 'pat' : 'oauth',
  };
}

async function oauthUser(
  deps: Deps,
  token: string,
): Promise<{ userId: string; scopes: TokenScope[] } | undefined> {
  // One introspection per request; an IdP error is an authentication failure (401), never a 500.
  const info = await deps.introspect(token).catch(() => ({ active: false }) as Introspection);
  const audience = [info.aud ?? []].flat();
  const granted = (info.scope ?? '').split(' ');
  // Audience validation: a token issued for another resource is never accepted (no token passthrough).
  if (!info.active || !info.sub || !audience.includes(deps.config.mcpResource)) return undefined;
  if (!granted.includes('tributary:read') && !granted.includes('tributary:write')) return undefined;
  const user = await deps.db
    .selectFrom('app_user')
    .select('id')
    .where('tenant_id', '=', deps.config.tenantId)
    .where('sub', '=', info.sub)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) return undefined;
  return { userId: user.id, scopes: granted.includes('tributary:write') ? ['read', 'write'] : ['read'] };
}

/** One MCP server per request (stateless Streamable HTTP), with the registry's tools bound to the caller. */
function serverFor(deps: Deps, request: FastifyRequest, caller: Caller): McpServer {
  const server = new McpServer({ name: 'tributary', version: API_VERSION });
  const ctx = injectContext(deps.root, {
    [ASSERTION_HEADER]: signAssertion(caller.userId, caller.scopes),
  });
  for (const tool of REGISTRY) {
    const write = tool.risk === 'write';
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input as never,
        annotations: { readOnlyHint: !write, destructiveHint: false, openWorldHint: false },
        // Write tools change data as the user: MCP hosts must ask the user first (SPEC §11.4).
        ...(write ? { _meta: { 'tributary/requiresUserInteraction': true } } : {}),
      },
      (async (args: unknown) => {
        let text: string;
        let error: string | null = null;
        try {
          if (write && !caller.scopes.includes('write')) throw new Error('This access token is read-only.');
          if (write && !(await aiSettings(deps.db, caller.tenantId, deps.config.ai)).write_tools_enabled)
            throw new Error('Write tools are switched off by your administrator.');
          const output = await tool.run(ctx, args as never, { reason: 'Requested through an MCP client' });
          text = JSON.stringify(output);
          if (text.length > MAX_TEXT)
            text = `${text.slice(0, MAX_TEXT)}\n…(truncated; open the Explorer or narrow the request)`;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          text = error;
        }
        await insertAudit(
          deps.db,
          {
            tenantId: caller.tenantId,
            userId: caller.userId,
            kind: 'ai_assistant_on_behalf_of',
            requestId: request.id,
            ip: request.ip || null,
            reason: null,
          },
          {
            action: 'mcp.tool_call',
            entityType: 'app_user',
            entityId: caller.userId,
            after: {
              tool: tool.name,
              via: caller.via,
              status: error ? 'error' : 'ok',
              input: redact(args),
              error,
            },
          },
        );
        return { content: [{ type: 'text', text }], ...(error ? { isError: true } : {}) };
      }) as never,
    );
  }
  return server;
}

/** MCP server at /mcp (SPEC M12, ARCHITECTURE §11) and its OAuth protected-resource metadata (RFC 9728). */
export function registerMcpRoutes(app: FastifyInstance, deps: Deps): void {
  const metadata = () => ({
    resource: deps.config.mcpResource,
    authorization_servers: [deps.config.oidc.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['tributary:read', 'tributary:write'],
    resource_documentation:
      'https://github.com/sprinriver/Tributary/blob/main/integrations/claude-skill/SKILL.md',
  });
  for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])
    app.get(url, { config: { public: true } }, async () => metadata());

  app.post('/mcp', { config: { public: true, selfAuth: true } }, async (request, reply) => {
    const caller = await authenticate(deps, request);
    if (!caller) {
      reply.code(401).header('www-authenticate', `Bearer resource_metadata="${metadataUrl(deps.config)}"`);
      return {
        code: 'unauthenticated',
        message: 'Send a Tributary access token or an IdP token for this resource.',
      };
    }
    const server = serverFor(deps, request, caller);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    // No sessionIdGenerator: stateless mode. (The SDK's types predate exactOptionalPropertyTypes.)
    await server.connect(transport as never);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
  // Stateless: no server-initiated streams and no sessions to end.
  for (const method of ['GET', 'DELETE'] as const)
    app.route({
      method,
      url: '/mcp',
      config: { public: true, selfAuth: true },
      handler: async (_request, reply) =>
        reply.code(405).header('allow', 'POST').send({ code: 'method_not_allowed', message: 'Use POST.' }),
    });
}
