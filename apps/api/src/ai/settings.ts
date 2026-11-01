import type { AiSettings, PutAiSettingsBody } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { sql } from 'kysely';
import { getSetting } from '../admin/settings.ts';
import type { AiConfig } from './provider.ts';
import { TOOLS } from './tools.ts';

/** Tokens the assistant used this calendar month (UTC), summed from assistant messages. */
export async function tokensThisMonth(db: Database, tenantId: string): Promise<number> {
  const row = await db
    .selectFrom('ai_message')
    .select(sql<string>`coalesce(sum(input_tokens + output_tokens), 0)`.as('n'))
    .where('tenant_id', '=', tenantId)
    .where('role', '=', 'assistant')
    .where(sql<boolean>`created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/**
 * Effective settings: the provider comes from the deployment (SPEC §11.1); admins switch the assistant and write
 * tools on or off and set the budget. With a provider configured, the assistant is on until an admin turns it off.
 */
export async function aiSettings(db: Database, tenantId: string, config: AiConfig): Promise<AiSettings> {
  const saved = await getSetting<PutAiSettingsBody>(db, tenantId, 'ai');
  const assistant_enabled = saved?.assistant_enabled ?? true;
  return {
    enabled: config.provider !== 'none' && assistant_enabled,
    provider: config.provider,
    model: config.provider === 'none' ? null : config.model,
    assistant_enabled,
    write_tools_enabled: saved?.write_tools_enabled ?? false,
    monthly_token_budget: saved?.monthly_token_budget ?? config.monthlyTokenBudget,
    tokens_used_this_month: await tokensThisMonth(db, tenantId),
    tools: TOOLS.map((t) => ({ name: t.name, risk: t.risk, description: t.description })),
  };
}
