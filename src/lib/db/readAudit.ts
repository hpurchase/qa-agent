import { supabaseAdmin } from "@/lib/supabase/server";

export type AuditRunRow = {
  id: string;
  url: string;
  normalized_url: string;
  site_summary: unknown | null;
  status: string;
  error: string | null;
  onboarding_status: string;
  onboarding_summary: unknown | null;
  created_at: string;
  updated_at: string;
};

export type AuditArtifactRow = {
  id: string;
  audit_run_id: string;
  audit_target_id: string | null;
  kind: string;
  storage_path: string | null;
  content: string | null;
  meta: unknown;
  created_at: string;
};

export type AuditFindingRow = {
  id: string;
  audit_run_id: string;
  audit_target_id: string | null;
  source: string;
  summary: string;
  findings_json: unknown;
  meta: unknown;
  created_at: string;
};

export type AuditTargetRow = {
  id: string;
  audit_run_id: string;
  role: string;
  url: string;
  normalized_url: string;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function getAuditRun(id: string): Promise<AuditRunRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("audit_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as AuditRunRow) ?? null;
}

export async function listAuditTargets(auditRunId: string): Promise<AuditTargetRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("audit_targets")
    .select("*")
    .eq("audit_run_id", auditRunId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as AuditTargetRow[]) ?? [];
}

export async function listArtifacts(auditRunId: string): Promise<AuditArtifactRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("audit_artifacts")
    .select("*")
    .eq("audit_run_id", auditRunId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as AuditArtifactRow[]) ?? [];
}

export async function listFindings(auditRunId: string): Promise<AuditFindingRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("audit_findings")
    .select("*")
    .eq("audit_run_id", auditRunId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as AuditFindingRow[]) ?? [];
}

export type OnboardingStepRow = {
  id: string;
  audit_run_id: string;
  step_idx: number;
  url: string | null;
  action_type: string;
  action_detail: Record<string, unknown>;
  duration_ms: number;
  screenshot_path: string | null;
  blocked_reason: string | null;
  created_at: string;
};

export async function listOnboardingSteps(auditRunId: string): Promise<OnboardingStepRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("audit_onboarding_steps")
    .select("*")
    .eq("audit_run_id", auditRunId)
    .order("step_idx", { ascending: true });
  if (error) throw error;
  return (data as OnboardingStepRow[]) ?? [];
}

export async function listAuditRuns(limit = 50): Promise<AuditRunRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("audit_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as AuditRunRow[]) ?? [];
}

export async function listAuditRunsForUrl(normalizedUrl: string, limit = 5): Promise<AuditRunRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("audit_runs")
    .select("*")
    .eq("normalized_url", normalizedUrl)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as AuditRunRow[]) ?? [];
}
