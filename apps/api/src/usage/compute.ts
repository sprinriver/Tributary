// Usage analytics (Phase 36, USE-01/02): counted from the audit log and the registry. Counting only; nothing is
// tracked for this, and nothing leaves the account.
import { USAGE_MEASURES, type Usage, type UsageWeek } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { sql } from 'kysely';

type Measure = Exclude<(typeof USAGE_MEASURES)[number], 'active_users'>;

/** Which audit actions each measure counts. */
const ACTIONS: Record<Measure, string[] | 'triage'> = {
  experiments_created: ['experiment.create'],
  versions_published: ['experiment_version.publish'],
  imports: ['release.stage'],
  releases_published: ['release.publish'],
  pipeline_runs: ['run.launch'],
  exports: ['query.export', 'sdrf.export', 'report.export', 'audit.export', 'usage.export'],
  assistant: ['ai.tool_call', 'mcp.tool_call'],
  triage: 'triage',
};
/** Actors who are people (directly or through the assistant), not services. */
const PEOPLE = ['user', 'ai_assistant_on_behalf_of'];

export const DEFINITIONS: Record<string, string> = {
  active_users:
    'People with at least one action in the audit log that week (sign-ins included; services excluded)',
  experiments_created: 'Experiments created',
  versions_published: 'Experiment versions published',
  imports: 'Tool outputs imported into a staged release (release.stage)',
  releases_published: 'Dataset releases published',
  pipeline_runs: 'Pipeline runs launched',
  exports: 'Exports: query results, SDRF, reports, audit log and usage tables',
  assistant: 'Tool calls by the assistant or through MCP',
  triage: 'Triage actions (items, evidence, decisions, owners, comments)',
  programs:
    'Per program, all time: experiments, published versions and releases, pipeline runs; last activity is the latest of these',
  users: 'Per person: last action in the audit log, and actions in the last 30 days',
};

const DAY = 86_400_000;
const iso = (v: Date | string | null) =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/** Monday 00:00 UTC of the week holding `d` (Postgres date_trunc('week') uses the same ISO weeks). */
export function weekStart(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

export async function computeUsage(
  db: Database,
  tenantId: string,
  weeks: number,
  now = new Date(),
): Promise<Omit<Usage, 'figure'>> {
  const starts = Array.from(
    { length: weeks },
    (_, i) => new Date(weekStart(now).getTime() - (weeks - 1 - i) * 7 * DAY),
  );
  const since = starts[0]!;
  // The week as text (YYYY-MM-DD, UTC): a timestamp without time zone would be read in the server's local zone.
  const week = sql<string>`to_char(date_trunc('week', at at time zone 'UTC'), 'YYYY-MM-DD')`;

  const counts = await db
    .selectFrom('audit_log')
    .select([week.as('week'), 'action', (eb) => eb.fn.countAll<string>().as('n')])
    .where('tenant_id', '=', tenantId)
    .where('at', '>=', since)
    .groupBy([week, 'action'])
    .execute();
  const active = await db
    .selectFrom('audit_log')
    .select([week.as('week'), sql<string>`count(distinct actor_id)`.as('n')])
    .where('tenant_id', '=', tenantId)
    .where('at', '>=', since)
    .where('actor_type', 'in', PEOPLE)
    .groupBy(week)
    .execute();
  const key = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));
  const weekly: UsageWeek[] = starts.map((s) => {
    const k = key(s);
    const row: UsageWeek = {
      week_start: k,
      active_users: Number(active.find((a) => key(a.week) === k)?.n ?? 0),
      experiments_created: 0,
      versions_published: 0,
      imports: 0,
      releases_published: 0,
      pipeline_runs: 0,
      exports: 0,
      assistant: 0,
      triage: 0,
    };
    for (const c of counts.filter((c) => key(c.week) === k))
      for (const [m, actions] of Object.entries(ACTIONS) as [Measure, string[] | 'triage'][])
        if (actions === 'triage' ? c.action.startsWith('triage.') : actions.includes(c.action))
          row[m] += Number(c.n);
    return row;
  });

  // People.
  const people = await db
    .selectFrom('app_user as u')
    .leftJoin(
      db
        .selectFrom('audit_log')
        .select([
          'actor_id',
          (eb) => eb.fn.max('at').as('last_at'),
          sql<string>`count(*) filter (where at >= ${new Date(now.getTime() - 30 * DAY)})`.as('n30'),
        ])
        .where('tenant_id', '=', tenantId)
        .where('actor_type', 'in', PEOPLE)
        .groupBy('actor_id')
        .as('a'),
      'a.actor_id',
      'u.id',
    )
    .select(['u.id', 'u.name', 'u.email', 'u.last_login_at', 'u.deactivated_at', 'a.last_at', 'a.n30'])
    .where('u.tenant_id', '=', tenantId)
    .where('u.deleted_at', 'is', null)
    .where('u.kind', '=', 'human')
    .orderBy('u.name')
    .execute();
  const activeSince = (days: number) =>
    people.filter((p) => p.last_at && new Date(p.last_at).getTime() >= now.getTime() - days * DAY).length;

  // Programs (all time, from the registry).
  const programs = await db
    .selectFrom('program as p')
    .select((eb) => [
      'p.id',
      'p.code',
      'p.name',
      eb
        .selectFrom('experiment as e')
        .select((x) => x.fn.countAll<string>().as('n'))
        .whereRef('e.program_id', '=', 'p.id')
        .where('e.deleted_at', 'is', null)
        .as('experiments'),
      eb
        .selectFrom('experiment_version as v')
        .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
        .select((x) => x.fn.countAll<string>().as('n'))
        .whereRef('e.program_id', '=', 'p.id')
        .where('v.status', '=', 'published')
        .as('published_versions'),
      eb
        .selectFrom('dataset_release as r')
        .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
        .select((x) => x.fn.countAll<string>().as('n'))
        .whereRef('d.program_id', '=', 'p.id')
        .where('r.status', '=', 'published')
        .where('r.deleted_at', 'is', null)
        .as('published_releases'),
      eb
        .selectFrom('pipeline_run as run')
        .innerJoin('experiment_version as v', 'v.id', 'run.experiment_version_id')
        .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
        .select((x) => x.fn.countAll<string>().as('n'))
        .whereRef('e.program_id', '=', 'p.id')
        .as('pipeline_runs'),
      sql<Date | null>`greatest(
        (select max(e.updated_at) from experiment e where e.program_id = p.id and e.deleted_at is null),
        (select max(v.published_at) from experiment_version v join experiment e on e.id = v.experiment_id where e.program_id = p.id),
        (select max(r.published_at) from dataset_release r join dataset d on d.id = r.dataset_id where d.program_id = p.id),
        (select max(run.created_at) from pipeline_run run join experiment_version v on v.id = run.experiment_version_id
           join experiment e on e.id = v.experiment_id where e.program_id = p.id)
      )`.as('last_activity'),
    ])
    .where('p.tenant_id', '=', tenantId)
    .where('p.deleted_at', 'is', null)
    .orderBy('p.code')
    .execute();

  return {
    generated_at: now.toISOString(),
    weeks,
    totals: {
      users: people.filter((p) => !p.deactivated_at).length,
      active_7d: activeSince(7),
      active_30d: activeSince(30),
      never_active: people.filter((p) => !p.last_at).length,
    },
    weekly,
    programs: programs.map((p) => ({
      program_id: p.id,
      program_code: p.code,
      program_name: p.name,
      experiments: Number(p.experiments ?? 0),
      published_versions: Number(p.published_versions ?? 0),
      published_releases: Number(p.published_releases ?? 0),
      pipeline_runs: Number(p.pipeline_runs ?? 0),
      last_activity: iso(p.last_activity),
    })),
    users: people.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      last_login_at: iso(p.last_login_at),
      last_active_at: iso(p.last_at as Date | null),
      actions_30d: Number(p.n30 ?? 0),
      status: p.deactivated_at ? ('deactivated' as const) : ('active' as const),
    })),
    definitions: DEFINITIONS,
  };
}
