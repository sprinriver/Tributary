import { AbilityBuilder, createMongoAbility, subject, type MongoAbility } from '@casl/ability';

export type Role = 'viewer' | 'contributor' | 'approver' | 'admin' | 'system_admin';
export type Action = 'read' | 'create' | 'update' | 'publish' | 'approve' | 'manage';
export type SubjectType =
  | 'Program'
  | 'Experiment'
  | 'ExperimentVersion'
  | 'Sample'
  | 'Dataset'
  | 'File'
  | 'PipelineRun'
  | 'SavedView'
  | 'AuditLog'
  | 'TriageItem';

export interface RoleBinding {
  role: Role;
  /** null only for the global system_admin role. */
  program_id: string | null;
  program_code?: string | undefined;
}

/** Program-scoped checks pass `subject(type, { program_id })`; conditions are plain Mongo queries on that object. */
export type AppAbility = MongoAbility;

/** What each program role may do (SPEC §4 RoleBinding). Programs with `requires_approval` also need `approve` to
 * publish (SPEC M1). Higher roles include the lower ones. */
export const ROLE_ACTIONS: Record<Exclude<Role, 'system_admin'>, Action[]> = {
  viewer: ['read'],
  contributor: ['read', 'create', 'update', 'publish'],
  approver: ['read', 'create', 'update', 'publish', 'approve'],
  admin: ['manage'],
};

/** CASL abilities for a principal. Every program-scoped check passes `{ program_id }`. */
export function defineAbility(bindings: readonly RoleBinding[]): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const binding of bindings) {
    if (binding.role === 'system_admin') {
      can('manage', 'all');
      continue;
    }
    if (!binding.program_id) continue;
    for (const action of ROLE_ACTIONS[binding.role]) can(action, 'all', { program_id: binding.program_id });
  }
  return build();
}

export const inProgram = (type: SubjectType, programId: string) => subject(type, { program_id: programId });
