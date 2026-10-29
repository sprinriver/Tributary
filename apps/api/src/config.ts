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
  sessionTtlHours: number;
  groupRoleMap: GroupRoleMapping[];
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
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    groupRoleMap: env.AUTH_GROUP_ROLE_MAP
      ? (JSON.parse(env.AUTH_GROUP_ROLE_MAP) as GroupRoleMapping[])
      : production
        ? []
        : DEV_GROUP_ROLE_MAP,
  };
}
