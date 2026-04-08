import { supabaseAdmin } from "@/lib/supabase/server";
import type { OnboardingStepAction } from "@/lib/db/types";

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

export async function insertOnboardingStep(params: {
  auditRunId: string;
  stepIdx: number;
  url: string | null;
  actionType: OnboardingStepAction;
  actionDetail: Record<string, unknown>;
  durationMs: number;
  screenshotPath: string | null;
  blockedReason: string | null;
}) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("audit_onboarding_steps").insert({
    audit_run_id: params.auditRunId,
    step_idx: params.stepIdx,
    url: params.url,
    action_type: params.actionType,
    action_detail: params.actionDetail,
    duration_ms: params.durationMs,
    screenshot_path: params.screenshotPath,
    blocked_reason: params.blockedReason,
  });
  if (error) throw error;
}

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
