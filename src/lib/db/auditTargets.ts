import { supabaseAdmin } from "@/lib/supabase/server";
import type { AuditTargetRole, AuditTargetStatus } from "@/lib/db/types";

export type AuditTargetRow = {
  id: string;
  audit_run_id: string;
  role: AuditTargetRole;
  url: string;
  normalized_url: string;
  status: AuditTargetStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function insertAuditTarget(params: {
  auditRunId: string;
  role: AuditTargetRole;
  url: string;
  normalizedUrl: string;
}): Promise<{ id: string }> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("audit_targets")
    .insert({
      audit_run_id: params.auditRunId,
      role: params.role,
      url: params.url,
      normalized_url: params.normalizedUrl,
      status: "queued" as AuditTargetStatus,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function updateAuditTarget(params: {
  id: string;
  status?: AuditTargetStatus;
  error?: string | null;
}) {
  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = {};
  if (params.status !== undefined) patch.status = params.status;
  if (params.error !== undefined) patch.error = params.error;
  const { error } = await sb.from("audit_targets").update(patch).eq("id", params.id);
  if (error) throw error;
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
