import { supabaseAdmin } from "@/lib/supabase/server";
import type { AuditJobStatus } from "@/lib/db/types";

export type AuditJobRow = {
  id: string;
  audit_run_id: string;
  status: AuditJobStatus;
  attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  run_after: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function enqueueAuditJob(params: { auditRunId: string }) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("audit_jobs").insert({
    audit_run_id: params.auditRunId,
    status: "queued" satisfies AuditJobStatus,
  });
  if (error) throw error;
}

export async function claimNextAuditJob(params: { lockedBy: string }): Promise<AuditJobRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .rpc("claim_next_audit_job", { p_locked_by: params.lockedBy })
    .maybeSingle();
  if (error) throw error;
  if (!data || !(data as Record<string, unknown>).id) return null;
  return data as unknown as AuditJobRow;
}

export async function updateAuditJob(params: {
  id: string;
  status?: AuditJobStatus;
  error?: string | null;
  runAfter?: Date;
}) {
  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = {};
  if (params.status) patch.status = params.status;
  if (params.error !== undefined) patch.error = params.error;
  if (params.runAfter) patch.run_after = params.runAfter.toISOString();

  const { error } = await sb.from("audit_jobs").update(patch).eq("id", params.id);
  if (error) throw error;
}

