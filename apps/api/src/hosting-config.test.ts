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

describe('private service addresses (Render hostport)', () => {
  it('OSS-01: QUERY_HOSTPORT and COMPUTE_HOSTPORT stand in for QUERY_URL and COMPUTE_URL', async () => {
    const config = loadConfig({
      ...PROD,
      DATABASE_URL: 'postgres://x@y/z',
      BUNDLED_KEYCLOAK: 'true',
      QUERY_HOSTPORT: 'tributary-query-ab12:3100',
      COMPUTE_HOSTPORT: 'tributary-compute-cd34:8000',
    });
    expect(config.queryUrl).toBe('http://tributary-query-ab12:3100');
    expect(config.computeUrl).toBe('http://tributary-compute-cd34:8000');
    const { loadQueryConfig } = await import('@tributary/query/config');
    expect(
      loadQueryConfig({
        NODE_ENV: 'production',
        QUERY_INTERNAL_TOKEN: 't',
        DATABASE_URL: 'postgres://x@y/z',
        S3_HOSTPORT: 'tributary-s3-ef56:8333',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 'b',
      }).s3.endpoint,
    ).toBe('http://tributary-s3-ef56:8333');
  });
});

describe('plain-http identity provider', () => {
  it('OSS-01: production refuses an http issuer unless it is on localhost (local trials only)', async () => {
    const { allowInsecureIssuer } = await import('./auth/oidc.ts');
    expect(allowInsecureIssuer('http://localhost:8080/realms/tributary', false)).toBe(true);
    expect(allowInsecureIssuer('http://tributary.localhost:8080/auth/realms/tributary', true)).toBe(true);
    expect(allowInsecureIssuer('http://idp.example.com/realms/x', true)).toBe(false);
    expect(allowInsecureIssuer('http://localhost.example.com/realms/x', true)).toBe(false);
    expect(allowInsecureIssuer('https://idp.example.com/realms/x', true)).toBe(false);
  });
});
