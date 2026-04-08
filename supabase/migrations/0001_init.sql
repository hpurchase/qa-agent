-- Core tables for single-URL CRO audits.

create extension if not exists pgcrypto;

create table if not exists public.audit_runs (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  normalized_url text not null,
  site_summary jsonb,
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_runs_normalized_url_idx on public.audit_runs (normalized_url);
create index if not exists audit_runs_status_idx on public.audit_runs (status);

create table if not exists public.audit_artifacts (
  id uuid primary key default gen_random_uuid(),
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  kind text not null check (kind in ('html','markdown','screenshot_desktop','screenshot_mobile')),
  storage_path text,
  content text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_artifacts_run_kind_idx on public.audit_artifacts (audit_run_id, kind);

create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  source text not null check (source in ('heuristic','llm')),
  summary text not null,
  findings_json jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_findings_run_source_idx on public.audit_findings (audit_run_id, source);

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_audit_runs_updated_at on public.audit_runs;
create trigger set_audit_runs_updated_at
before update on public.audit_runs
for each row
execute function public.set_updated_at();

