// What the signed-in user may do, from /v1/auth/me (AUTH-03). The API enforces the same rules; screens only follow them.
import type { MeResponse } from '@tributary/contracts';

type Roles = MeResponse['roles'] | undefined;

/** System admins administer the whole platform (every /admin page). */
export const isSystemAdmin = (roles: Roles): boolean => !!roles?.some((r) => r.role === 'system_admin');

/** A non-viewer role in the program (or in any program when none is given), or system admin. */
export const canWriteIn = (roles: Roles, programId?: string): boolean =>
  isSystemAdmin(roles) ||
  !!roles?.some((r) => r.role !== 'viewer' && (programId === undefined || r.program_id === programId));
