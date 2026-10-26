// Test helper: a fresh Postgres 17 + pgvector container (same image as docker-compose.yml).
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

export const POSTGRES_IMAGE = 'pgvector/pgvector:0.8.7-pg17-trixie';

export interface TestDatabase {
  url: string;
  pool: pg.Pool;
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const url = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return {
    url,
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
