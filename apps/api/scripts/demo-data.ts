// `pnpm demo:data` — local development only: imports and publishes the synthetic demo datasets (DEMO-01) through the
// running API, as a "Demo loader" user who contributes to every program, so Explore, charts and results pages have
// data. Needs `pnpm db:seed` and `pnpm dev`. Running it again changes nothing. Refuses to run in production.
import { createDb, DEFAULT_DATABASE_URL, DEV_TENANT_ID } from '@tributary/db';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPersonalAccessToken, revokePersonalAccessToken } from '../src/auth/tokens.ts';
import { loadDemoData, type Call } from '../src/demo/loader.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('demo:data is for local development only.');
  process.exit(1);
}
const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const fixturesDir = resolve(import.meta.dirname, '../../../fixtures');

try {
  await fetch(`${apiUrl}/healthz`);
} catch (error) {
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
  console.error(
    `demo:data: the API is not reachable at ${apiUrl}${cause}. Start it with \`pnpm dev\` first.`,
  );
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
let exitCode = 0;
try {
  const user =
    (await db.selectFrom('app_user').select('id').where('sub', '=', 'dev|demo-loader').executeTakeFirst()) ??
    (await db
      .insertInto('app_user')
      .values({
        tenant_id: DEV_TENANT_ID,
        created_by: DEV_TENANT_ID,
        sub: 'dev|demo-loader',
        email: 'demo-loader@example.test',
        name: 'Demo loader',
      })
      .returning('id')
      .executeTakeFirstOrThrow());
  const programs = await db.selectFrom('program').select('id').where('deleted_at', 'is', null).execute();
  if (programs.length === 0) throw new Error('No programs found: run `pnpm db:seed` first.');
  for (const p of programs) {
    const bound = await db
      .selectFrom('role_binding')
      .select('id')
      .where('user_id', '=', user.id)
      .where('program_id', '=', p.id)
      .where('role', '=', 'contributor')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!bound)
      await db
        .insertInto('role_binding')
        .values({
          tenant_id: DEV_TENANT_ID,
          created_by: user.id,
          user_id: user.id,
          program_id: p.id,
          role: 'contributor',
        })
        .execute();
  }
  const pat = await createPersonalAccessToken(db, user.id, {
    name: 'demo:data',
    scopes: ['read', 'write'],
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const call: Call = async (method, url, payload) => {
    const res = await fetch(`${apiUrl}${url}`, {
      method,
      headers: {
        authorization: `Bearer ${pat.token}`,
        'x-change-reason': 'Demo data (pnpm demo:data)',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  try {
    console.log(`demo:data: loading demo datasets through ${apiUrl}`);
    const results = await loadDemoData({
      call,
      readFixture: (path) => readFileSync(resolve(fixturesDir, path)),
      putPart: async (url, bytes) => {
        const res = await fetch(url, { method: 'PUT', body: bytes });
        if (!res.ok) throw new Error(`Upload to object storage failed: HTTP ${res.status}.`);
        return res.headers.get('etag');
      },
      log: (line) => console.log(line),
    });
    const created = results.filter((r) => r.status === 'created').length;
    console.log(
      `demo:data: done — ${created} dataset(s) published, ${results.length - created} already present. ` +
        "Open Explore or an experiment's Results page.",
    );
  } finally {
    await revokePersonalAccessToken(db, user.id, pat.id);
  }
} catch (error) {
  console.error(`demo:data: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await db.destroy();
}
process.exit(exitCode);
