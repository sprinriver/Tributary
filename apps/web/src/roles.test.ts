import { describe, expect, it } from 'vitest';
import { canWriteIn, isSystemAdmin } from './roles.ts';

const ONC = '00000000-0000-7000-8000-000000000001';
const IMM = '00000000-0000-7000-8000-000000000002';
type Roles = Parameters<typeof canWriteIn>[0];
const roles = (...r: [string | null, string][]): Roles =>
  r.map(([program_id, role]) => ({ program_id, role })) as unknown as Roles;

describe('roles', () => {
  it('AUTH-03: write rights come from a non-viewer role in the program, or system admin anywhere', () => {
    expect(canWriteIn(roles([ONC, 'contributor']), ONC)).toBe(true);
    expect(canWriteIn(roles([ONC, 'contributor']), IMM)).toBe(false);
    expect(canWriteIn(roles([ONC, 'viewer']), ONC)).toBe(false);
    expect(canWriteIn(roles([ONC, 'approver']), ONC)).toBe(true);
    expect(canWriteIn(roles([null, 'system_admin']), IMM)).toBe(true);
    expect(canWriteIn(undefined, ONC)).toBe(false);
  });

  it('AUTH-03: without a program, write rights mean a non-viewer role in at least one program', () => {
    expect(canWriteIn(roles([ONC, 'viewer'], [IMM, 'viewer']))).toBe(false);
    expect(canWriteIn(roles([ONC, 'viewer'], [IMM, 'contributor']))).toBe(true);
    expect(canWriteIn(roles())).toBe(false);
  });

  it('AUTH-03: only system admins are admins of the whole platform', () => {
    expect(isSystemAdmin(roles([null, 'system_admin']))).toBe(true);
    expect(isSystemAdmin(roles([ONC, 'admin']))).toBe(false);
    expect(isSystemAdmin(undefined)).toBe(false);
  });
});
