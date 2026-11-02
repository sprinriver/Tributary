-- Phase 23 legacy onboarding (ING-06): one run per bulk onboarding of a folder layout, and one item per
-- experiment, file or import it plans. Items record status, attempts and errors, so a run can be resumed and its
-- migration report rebuilt at any time.

create table onboarding_run (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_id uuid not null references program (id),
  prefix text not null,
  -- The request as given (patterns, assay type, sample defaults, batch size) and the inferred plan.
  spec jsonb not null,
  unmatched text[] not null default '{}',
  status text not null check (status in ('running', 'incomplete', 'completed', 'completed_with_failures'))
);
create index onboarding_run_program_idx on onboarding_run (program_id, id desc) where deleted_at is null;
create trigger touch_updated_at before update on onboarding_run for each row execute function touch_updated_at();
grant select, insert, update on onboarding_run to tributary_app;

create table onboarding_item (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  run_id uuid not null references onboarding_run (id),
  kind text not null check (kind in ('experiment', 'file', 'import')),
  -- Experiment name, or the object key of the file (for file and import items).
  key text not null,
  experiment text not null,
  position integer not null,
  status text not null check (status in ('pending', 'done', 'failed')),
  -- The experiment, file or release this item created or found.
  entity_id uuid,
  error text,
  attempts integer not null default 0,
  unique (run_id, kind, key)
);
create index onboarding_item_run_idx on onboarding_item (run_id, position);
create trigger touch_updated_at before update on onboarding_item for each row execute function touch_updated_at();
grant select, insert, update on onboarding_item to tributary_app;
