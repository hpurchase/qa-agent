import { supabaseAdmin } from "@/lib/supabase/server";
import { updateAuditRun } from "@/lib/db/auditRuns";
import { insertOnboardingStep } from "@/lib/db/onboardingSteps";
import { uploadAuditArtifact } from "@/lib/storage";
import { buildTestPersona } from "@/lib/onboarding/persona";
import { runOnboardingFlow, type StepRecord } from "@/lib/onboarding/runner";
import {
  computeOnboardingMetrics,
  generateDashboardFeedback,
  generateOnboardingRecommendations,
} from "@/lib/cro/onboardingAnalysis";
import sharp from "sharp";
import type { OnboardingStatus } from "@/lib/db/types";

function requiredEnv(name: string, fallback?: string): string {
  return process.env[name] ?? fallback ?? "";
}

async function resizeForStorage(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const img = sharp(Buffer.from(bytes));
  const meta = await img.metadata();
  const maxEdge = 1568;
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= maxEdge && h <= maxEdge) return bytes;
  const resized = await img
    .resize({
      width: w > h ? maxEdge : undefined,
      height: h >= w ? maxEdge : undefined,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
  const ab = new ArrayBuffer(resized.byteLength);
  new Uint8Array(ab).set(resized);
  return ab;
}

async function updateOnboardingStatus(auditRunId: string, status: OnboardingStatus, summary?: Record<string, unknown>) {
  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = { onboarding_status: status };
  if (summary) patch.onboarding_summary = summary;
  const { error } = await sb.from("audit_runs").update(patch).eq("id", auditRunId);
  if (error) throw error;
}

async function findSignupUrl(auditRunId: string, fallbackUrl: string): Promise<string> {
  const sb = supabaseAdmin();
  const maxWaitMs = 60_000;
  const pollIntervalMs = 10_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const { data: targets } = await sb
      .from("audit_targets")
      .select("url")
      .eq("audit_run_id", auditRunId)
      .eq("role", "signup");

    const found = (targets as Array<{ url: string }> | null)?.[0];
    if (found?.url) return found.url;

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return fallbackUrl;
}

export async function runOnboardingAudit(params: { auditRunId: string; url: string }) {
  const bucket = requiredEnv("AUDIT_ARTIFACTS_BUCKET", "audit-artifacts");

  await updateOnboardingStatus(params.auditRunId, "running");

  // Build the test persona for this run.
  const persona = buildTestPersona(params.auditRunId);

  // Find the signup URL (from CRO discovery or fallback to homepage).
  const signupUrl = await findSignupUrl(params.auditRunId, params.url);

  const result = await runOnboardingFlow({ signupUrl, persona });

  // Store each step.
  for (const step of result.steps) {
    let screenshotPath: string | null = null;

    if (step.screenshotBytes) {
      const resized = await resizeForStorage(step.screenshotBytes);
      screenshotPath = `audits/${params.auditRunId}/onboarding_step_${step.stepIdx}.jpg`;
      await uploadAuditArtifact({
        bucket,
        path: screenshotPath,
        bytes: resized,
        contentType: "image/jpeg",
      });
    }

    await insertOnboardingStep({
      auditRunId: params.auditRunId,
      stepIdx: step.stepIdx,
      url: step.url,
      actionType: step.actionType,
      actionDetail: redactSecrets(step.actionDetail, persona),
      durationMs: step.durationMs,
      screenshotPath,
      blockedReason: step.blockedReason,
    });
  }

  // Run analysis.
  const metrics = computeOnboardingMetrics(result.steps);

  let recommendations: Array<Record<string, unknown>> = [];
  let dashboardFeedback: Record<string, unknown> | null = null;
  if (process.env.ANTHROPIC_API_KEY && result.steps.length > 0) {
    try {
      const recs = await generateOnboardingRecommendations({
        steps: result.steps,
        metrics,
        signupUrl,
      });
      recommendations = recs;
    } catch {
      // Non-fatal: we still have deterministic metrics.
    }

    try {
      const fb = await generateDashboardFeedback({
        steps: result.steps,
        finalStatus: result.finalStatus,
      });
      dashboardFeedback = fb as unknown as Record<string, unknown> | null;
    } catch {
      // Non-fatal.
    }
  }

  const summary = {
    signupUrl,
    finalStatus: result.finalStatus,
    blockedReason: result.blockedReason,
    stepCount: metrics.stepCount,
    distinctScreens: metrics.distinctScreens,
    totalDurationMs: metrics.totalDurationMs,
    estimatedTimeToValueMs: metrics.estimatedTimeToValueMs,
    frictionFlags: metrics.frictionFlags,
    recommendations,
    dashboardFeedback,
  };

  const finalStatus: OnboardingStatus =
    result.finalStatus === "done"
      ? "done"
      : result.finalStatus === "blocked"
        ? "blocked"
        : "failed";

  await updateOnboardingStatus(params.auditRunId, finalStatus, summary);
}

function redactSecrets(detail: Record<string, unknown>, persona: { email: string; password: string }): Record<string, unknown> {
  const redacted = { ...detail };
  for (const key of Object.keys(redacted)) {
    const val = redacted[key];
    if (typeof val === "string") {
      if (val.includes(persona.password)) {
        redacted[key] = val.replace(persona.password, "[REDACTED]");
      }
    }
  }
  return redacted;
}
