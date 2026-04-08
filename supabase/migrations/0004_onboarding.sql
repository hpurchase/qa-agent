-- v4: onboarding flow steps + job_type support

-- Onboarding step records (one row per action in the signup flow).
create table if not exists public.audit_onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  step_idx int not null,
  url text,
  action_type text not null,
  action_detail jsonb not null default '{}',
  duration_ms int not null default 0,
  screenshot_path text,
  blocked_reason text,
  created_at timestamptz not null default now()
);

create index if not exists onboarding_steps_run_idx
  on public.audit_onboarding_steps (audit_run_id, step_idx);

-- Add onboarding status + summary columns to audit_runs.
alter table public.audit_runs
  add column if not exists onboarding_status text
    not null default 'pending'
    check (onboarding_status in ('pending','running','done','failed','blocked'));

alter table public.audit_runs
  add column if not exists onboarding_summary jsonb;

-- Add job_type column to audit_jobs (defaults to 'cro_audit' for backward compat).
alter table public.audit_jobs
  add column if not exists job_type text not null default 'cro_audit'
    check (job_type in ('cro_audit','onboarding_audit'));

-- Expand artifact kinds to include onboarding artifacts.
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
    'pricing_html','pricing_markdown',
    'onboarding_screenshot','onboarding_summary'
  ));
