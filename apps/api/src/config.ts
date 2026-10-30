import { DEFAULT_DATABASE_URL, DEV_TENANT_ID } from '@tributary/db';

/** IdP group → role mapping (SPEC §10). `programs` are program codes; `*` means every program. */
export interface GroupRoleMapping {
  group: string;
  role: 'viewer' | 'contributor' | 'approver' | 'admin' | 'system_admin';
  programs?: string[];
}

export interface ApiConfig {
  production: boolean;
  /** One tenant per deployment (SPEC §4). */
  tenantId: string;
  databaseUrl: string;
  /** Browser-facing origin of the SPA; the API is reached through it at `/api`. */
  publicUrl: string;
  oidc: { issuer: string; clientId: string; clientSecret: string; groupsClaim: string };
  cookieSecret: string;
  /** Internal Python service (statistics, SDRF). */
  computeUrl: string;
  /** Internal DuckDB service (importers, queries) and the token it requires. */
  queryUrl: string;
  queryInternalToken: string;
  /** EBI OLS4 or a self-hosted mirror (SPEC M2: configurable base URL). */
  olsUrl: string;
  sessionTtlHours: number;
  groupRoleMap: GroupRoleMapping[];
  s3: S3Config;
}

/** Object storage (SPEC M3). Locally SeaweedFS (docker-compose.yml); on AWS the endpoint is left unset. */
export interface S3Config {
  endpoint: string | undefined;
  region: string;
  /** Unset on AWS (instance role credentials). */
  credentials: { accessKeyId: string; secretAccessKey: string } | undefined;
  rawBucket: string;
  /** Dataset release objects (Parquet; ADR 0017). */
  warehouseBucket: string;
  /** Multipart part size; S3 needs ≥ 5 MiB for every part but the last. */
  partSizeBytes: number;
  /** Lifetime of presigned part URLs. */
  presignTtlSeconds: number;
  /** Key prefixes that may be registered with "link existing objects" (never the managed `programs/` area). */
  linkablePrefixes: string[];
}

const DEV_GROUP_ROLE_MAP: GroupRoleMapping[] = [
  { group: 'admin', role: 'system_admin' },
  { group: 'scientist', role: 'contributor', programs: ['*'] },
  { group: 'viewer', role: 'viewer', programs: ['*'] },
];

/** Reads configuration from the environment. Dev defaults match docker-compose.yml; production requires secrets. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === 'production';
  const required = (name: string, devDefault: string) => {
    const value = env[name];
    if (value) return value;
    if (production) throw new Error(`${name} must be set in production`);
    return devDefault;
  };
  return {
    production,
    tenantId: required('TRIBUTARY_TENANT_ID', DEV_TENANT_ID),
    databaseUrl: required('DATABASE_URL', DEFAULT_DATABASE_URL),
    publicUrl: required('PUBLIC_URL', 'http://localhost:5173'),
    oidc: {
      issuer: required('OIDC_ISSUER', 'http://localhost:8080/realms/tributary'),
      clientId: required('OIDC_CLIENT_ID', 'tributary-api'),
      clientSecret: required('OIDC_CLIENT_SECRET', 'tributary-api-dev-secret'),
      groupsClaim: env.OIDC_GROUPS_CLAIM ?? 'groups',
    },
    cookieSecret: required('COOKIE_SECRET', 'dev-only-cookie-secret-change-me-0123456789'),
    computeUrl: env.COMPUTE_URL ?? 'http://127.0.0.1:8000',
    queryUrl: env.QUERY_URL ?? 'http://127.0.0.1:3100',
    queryInternalToken: required('QUERY_INTERNAL_TOKEN', 'dev-only-internal-token'),
    olsUrl: env.OLS_URL ?? 'https://www.ebi.ac.uk/ols4',
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    s3: {
      endpoint: env.S3_ENDPOINT ?? (production ? undefined : 'http://localhost:8333'),
      region: env.S3_REGION ?? 'us-east-1',
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : production
            ? undefined
            : { accessKeyId: 'tributary-dev', secretAccessKey: 'tributary-dev-secret' },
      rawBucket: env.S3_RAW_BUCKET ?? 'tributary-raw',
      warehouseBucket: env.S3_WAREHOUSE_BUCKET ?? 'tributary-warehouse',
      partSizeBytes: Number(env.S3_PART_SIZE_MB ?? 16) * 1024 * 1024,
      presignTtlSeconds: Number(env.S3_PRESIGN_TTL_SECONDS ?? 3600),
      linkablePrefixes: (env.S3_LINKABLE_PREFIXES ?? 'incoming/').split(',').filter(Boolean),
    },
    groupRoleMap: env.AUTH_GROUP_ROLE_MAP
      ? (JSON.parse(env.AUTH_GROUP_ROLE_MAP) as GroupRoleMapping[])
      : production
        ? []
        : DEV_GROUP_ROLE_MAP,
  };
}
