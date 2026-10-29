import { loadConfig, type ApiConfig } from './config.ts';

/** Configuration for API tests: dev defaults, no IdP group mapping. */
export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return { ...loadConfig({ NODE_ENV: 'test' }), groupRoleMap: [], ...overrides };
}
