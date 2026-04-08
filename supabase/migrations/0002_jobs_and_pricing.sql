-- v2: async job queue + pricing artifacts

create table if not exists public.audit_jobs (
  id uuid primary key default gen_random_uuid(),
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  status text not null check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  locked_at timestamptz,
  locked_by text,
  run_after timestamptz not null default now(),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_jobs_status_run_after_idx on public.audit_jobs (status, run_after);
create index if not exists audit_jobs_audit_run_id_idx on public.audit_jobs (audit_run_id);

drop trigger if exists set_audit_jobs_updated_at on public.audit_jobs;
create trigger set_audit_jobs_updated_at
before update on public.audit_jobs
for each row
execute function public.set_updated_at();

-- Allow pricing artifacts in the single artifacts table.
do $$
begin
  -- Drop and recreate constraint to include pricing_* kinds.
  if exists (
    select 1
    from pg_constraint
    where conname = 'audit_artifacts_kind_check'
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

-- Atomic job claim function for workers.
create or replace function public.claim_next_audit_job(p_locked_by text)
returns public.audit_jobs
language plpgsql
as $$
declare
  j public.audit_jobs;
begin
  update public.audit_jobs
  set
    status = 'running',
    attempts = attempts + 1,
    locked_at = now(),
    locked_by = p_locked_by,
    error = null
  where id = (
    select id
    from public.audit_jobs
    where status = 'queued'
      and run_after <= now()
    order by run_after asc, created_at asc
    for update skip locked
    limit 1
  )
  returning * into j;

  return j;
end;
$$;

