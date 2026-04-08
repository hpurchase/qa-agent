import { supabaseAdmin } from "@/lib/supabase/server";

export type AuditRunRow = {
  id: string;
  url: string;
  normalized_url: string;
  site_summary: unknown | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditArtifactRow = {
  id: string;
  audit_run_id: string;
  kind: string;
  storage_path: string | null;
  content: string | null;
  meta: unknown;
  created_at: string;
};

export type AuditFindingRow = {
  id: string;
  audit_run_id: string;
  source: string;
  summary: string;
  findings_json: unknown;
  meta: unknown;
  created_at: string;
};

export async function getAuditRun(id: string): Promise<AuditRunRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("audit_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as AuditRunRow) ?? null;
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

