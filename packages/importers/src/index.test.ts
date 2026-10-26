import { expect, it } from 'vitest';
import { packageName } from './index.ts';

it('OPS-01: @tributary/importers is wired into the workspace', () => {
  expect(packageName).toBe('@tributary/importers');
});
