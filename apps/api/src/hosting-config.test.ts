import { databaseUrlFromEnv } from '@tributary/db';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const PROD = {
  NODE_ENV: 'production',
  TRIBUTARY_TENANT_ID: '00000000-0000-7000-8000-000000000001',
  PUBLIC_URL: 'https://tributary-web.onrender.com',
  OIDC_CLIENT_ID: 'tributary-api',
  OIDC_CLIENT_SECRET: 's',
  COOKIE_SECRET: 'c'.repeat(40),
  QUERY_INTERNAL_TOKEN: 't',
};

/** Render Blueprints cannot compose values, and generated secrets are base64 (with "/", "+" and "="). */
describe('hosting configuration (Render)', () => {
  it('OSS-01: the database URL can be given in parts; the password is URL-encoded', () => {
    expect(
      databaseUrlFromEnv({
        DATABASE_HOST: 'tributary-db',
        DATABASE_PASSWORD: 'a/b+c=d@e',
        DATABASE_USER: 'tributary',
        DATABASE_NAME: 'tributary',
      }),
    ).toBe('postgres://tributary:a%2Fb%2Bc%3Dd%40e@tributary-db:5432/tributary');
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgres://x@y/z', DATABASE_HOST: 'ignored' })).toBe(
      'postgres://x@y/z',
    );
    expect(databaseUrlFromEnv({})).toBeUndefined();
    const config = loadConfig({
      ...PROD,
      OIDC_ISSUER: 'https://idp.example/realm',
      DATABASE_HOST: 'db',
      DATABASE_PASSWORD: 'p',
    });
    expect(config.databaseUrl).toBe('postgres://tributary:p@db:5432/tributary');
  });

  it('OSS-01: with the bundled Keycloak the issuer follows PUBLIC_URL; otherwise OIDC_ISSUER is required', () => {
    const bundled = loadConfig({ ...PROD, DATABASE_URL: 'postgres://x@y/z', BUNDLED_KEYCLOAK: 'true' });
    expect(bundled.oidc.issuer).toBe('https://tributary-web.onrender.com/auth/realms/tributary');
    expect(() => loadConfig({ ...PROD, DATABASE_URL: 'postgres://x@y/z' })).toThrow(/OIDC_ISSUER/);
  });
});
