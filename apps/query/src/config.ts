import { DEFAULT_DATABASE_URL } from '@tributary/db';

/** Query service configuration. Dev defaults match docker-compose.yml; production requires secrets. */
export interface QueryConfig {
  production: boolean;
  /** Shared secret apps/api sends as `X-Internal-Token` (the service is internal only). */
  internalToken: string;
  s3: {
    endpoint: string | undefined;
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string } | undefined;
  };
  /** Local scratch space for source files and the immutable release cache. */
  workDir: string;
  /** Postgres for the metadata views (read as tributary_query_ro inside read-only transactions). */
  databaseUrl: string;
  /** ARCHITECTURE §6 limits. */
  limits: { timeoutMs: number; rowCap: number; maxConcurrent: number };
  /** DuckDB settings; unset keeps DuckDB's defaults (80% of RAM, one thread per core). */
  duckdb: { memoryLimit: string | undefined; threads: number | undefined; tempDirectory: string | undefined };
}

export function loadQueryConfig(env: NodeJS.ProcessEnv = process.env): QueryConfig {
  const production = env.NODE_ENV === 'production';
  const required = (name: string, devDefault: string) => {
    const value = env[name];
    if (value) return value;
    if (production) throw new Error(`${name} must be set in production`);
    return devDefault;
  };
  return {
    production,
    internalToken: required('QUERY_INTERNAL_TOKEN', 'dev-only-internal-token'),
    s3: {
      endpoint: env.S3_ENDPOINT ?? (production ? undefined : 'http://localhost:8333'),
      region: env.S3_REGION ?? 'us-east-1',
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : production
            ? undefined
            : { accessKeyId: 'tributary-dev', secretAccessKey: 'tributary-dev-secret' },
    },
    workDir: env.QUERY_WORK_DIR ?? '',
    databaseUrl: required('DATABASE_URL', DEFAULT_DATABASE_URL),
    limits: {
      timeoutMs: Number(env.QUERY_TIMEOUT_MS ?? 30_000),
      rowCap: Number(env.QUERY_ROW_CAP ?? 1_000_000),
      maxConcurrent: Number(env.QUERY_MAX_CONCURRENT ?? 4),
    },
    duckdb: {
      memoryLimit: env.QUERY_MEMORY_LIMIT,
      threads: env.QUERY_THREADS ? Number(env.QUERY_THREADS) : undefined,
      tempDirectory: env.QUERY_TEMP_DIR,
    },
  };
}
