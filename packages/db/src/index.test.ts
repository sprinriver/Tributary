import { expect, it } from 'vitest';
import { packageName } from './index.ts';

it('OPS-01: @tributary/db is wired into the workspace', () => {
  expect(packageName).toBe('@tributary/db');
});
