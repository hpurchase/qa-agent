import { supabaseAdmin } from "@/lib/supabase/server";
import type { AuditArtifactKind, AuditFindingSource, AuditRunStatus } from "@/lib/db/types";

export async function createAuditRun(params: {
  url: string;
  normalizedUrl: string;
}): Promise<{ id: string }> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("audit_runs")
    .insert({
      url: params.url,
      normalized_url: params.normalizedUrl,
      status: "queued" satisfies AuditRunStatus,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function updateAuditRun(params: {
  id: string;
  status?: AuditRunStatus;
  error?: string | null;
  siteSummary?: unknown;
}) {
  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = {};
  if (params.status) patch.status = params.status;
  if (params.error !== undefined) patch.error = params.error;
  if (params.siteSummary !== undefined) patch.site_summary = params.siteSummary;

  const { error } = await sb.from("audit_runs").update(patch).eq("id", params.id);
  if (error) throw error;
}

export async function insertArtifact(params: {
  auditRunId: string;
  auditTargetId?: string | null;
  kind: AuditArtifactKind;
  storagePath?: string | null;
  content?: string | null;
  meta?: Record<string, unknown>;
}) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("audit_artifacts").insert({
    audit_run_id: params.auditRunId,
    audit_target_id: params.auditTargetId ?? null,
    kind: params.kind,
    storage_path: params.storagePath ?? null,
    content: params.content ?? null,
    meta: params.meta ?? {},
  });
  if (error) throw error;
}

export async function insertFinding(params: {
  auditRunId: string;
  auditTargetId?: string | null;
  source: AuditFindingSource;
  summary: string;
  findingsJson: unknown;
  meta?: Record<string, unknown>;
}) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("audit_findings").insert({
    audit_run_id: params.auditRunId,
    audit_target_id: params.auditTargetId ?? null,
    source: params.source,
    summary: params.summary,
    findings_json: params.findingsJson,
    meta: params.meta ?? {},
  });
  if (error) throw error;
}
