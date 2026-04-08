-- v3: multi-page audit targets

create table if not exists public.audit_targets (
  id uuid primary key default gen_random_uuid(),
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  role text not null check (role in ('homepage','pricing','signup','unknown')),
  url text not null,
  normalized_url text not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed','skipped')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_targets_run_role_idx on public.audit_targets (audit_run_id, role);

drop trigger if exists set_audit_targets_updated_at on public.audit_targets;
create trigger set_audit_targets_updated_at
before update on public.audit_targets
for each row
execute function public.set_updated_at();

-- Add nullable audit_target_id FK to artifacts and findings.
alter table public.audit_artifacts
  add column if not exists audit_target_id uuid references public.audit_targets(id) on delete set null;

alter table public.audit_findings
  add column if not exists audit_target_id uuid references public.audit_targets(id) on delete set null;

create index if not exists audit_artifacts_target_idx on public.audit_artifacts (audit_target_id);
create index if not exists audit_findings_target_idx on public.audit_findings (audit_target_id);

-- Drop old kind constraint and add broader one (target-aware kinds removed; just keep it open).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'audit_artifacts_kind_check'
      and conrelid = 'public.audit_artifacts'::regclass
  ) then
    alter table public.audit_artifacts drop constraint audit_artifacts_kind_check;
  end if;
exception when undefined_object then
  null;
end $$;

alter table public.audit_artifacts
  add constraint audit_artifacts_kind_check
  check (kind in (
    'html','markdown','screenshot_desktop','screenshot_mobile',
    'pricing_html','pricing_markdown'
  ));
