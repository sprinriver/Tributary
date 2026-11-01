// Local development only: prints a 7-day read+write personal access token for a "sdk-dev" user who can read
// every program, for the Python SDK and MCP clients against the local stack. Refuses to run in production.
import { createDb, DEFAULT_DATABASE_URL, DEV_TENANT_ID } from '@tributary/db';
import { createPersonalAccessToken } from '../src/auth/tokens.ts';

if (process.env.NODE_ENV === 'production') {
  console.error('dev:token is for local development only.');
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
try {
  const user =
    (await db.selectFrom('app_user').select('id').where('sub', '=', 'dev|sdk-dev').executeTakeFirst()) ??
    (await db
      .insertInto('app_user')
      .values({
        tenant_id: DEV_TENANT_ID,
        created_by: DEV_TENANT_ID,
        sub: 'dev|sdk-dev',
        email: 'sdk-dev@example.test',
        name: 'SDK Dev',
      })
      .returning('id')
      .executeTakeFirstOrThrow());
  const programs = await db.selectFrom('program').select('id').where('deleted_at', 'is', null).execute();
  for (const p of programs) {
    const bound = await db
      .selectFrom('role_binding')
      .select('id')
      .where('user_id', '=', user.id)
      .where('program_id', '=', p.id)
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
          role: 'viewer',
        })
        .execute();
  }
  const { token } = await createPersonalAccessToken(db, user.id, {
    name: 'dev:token',
    scopes: ['read', 'write'],
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
  console.log(token);
} finally {
  await db.destroy();
}
