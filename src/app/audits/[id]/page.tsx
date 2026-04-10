import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditAutoRefresh, ShareButton, PrintButton } from "./AuditClient";
import {
  getAuditRun,
  listAuditTargets,
  listArtifacts,
  listFindings,
  listOnboardingSteps,
  listAuditRunsForUrl,
} from "@/lib/db/readAudit";
import { signAuditArtifactUrl } from "@/lib/storage";
import type { CroFinding } from "@/lib/cro/heuristics";
import { computeAuditScores, gradeColor, type AuditScores } from "@/lib/cro/scoring";

function env(name: string, fallback?: string) {
  return process.env[name] ?? fallback ?? "";
}

type Stage = "discover" | "capture" | "pricing" | "analysis" | "claude" | "done";

function stageFromSiteSummary(siteSummary: unknown | null): Stage | null {
  if (!siteSummary || typeof siteSummary !== "object") return null;
  const s = (siteSummary as { stage?: unknown }).stage;
  if (s === "discover" || s === "capture" || s === "pricing" || s === "analysis" || s === "claude")
    return s;
  return null;
}

function stepState(current: Stage | null, step: Stage): "todo" | "doing" | "done" {
  const order: Stage[] = ["discover", "capture", "pricing", "analysis", "claude", "done"];
  const ci = current ? order.indexOf(current) : -1;
  const si = order.indexOf(step);
  if (ci === -1) return "todo";
  if (ci === si) return "doing";
  if (ci > si) return "done";
  return "todo";
}

function roleLabel(role: string) {
  if (role === "homepage") return "Homepage";
  if (role === "pricing") return "Pricing";
  if (role === "signup") return "Signup";
  if (role === "cross_page") return "Cross-page";
  if (role === "site") return "Site-wide";
  return role;
}

function categorize(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("pricing") || t.includes("plan") || t.includes("billing")) return "Pricing";
  if (t.includes("sign") || t.includes("trial") || t.includes("friction") || t.includes("form"))
    return "Signup";
  if (t.includes("trust") || t.includes("proof") || t.includes("testimonial")) return "Trust";
  if (t.includes("cross") || t.includes("consisten") || t.includes("mismatch")) return "Cross-page";
  return "Messaging";
}

function severityColor(s: string) {
  if (s === "high") return "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200";
  if (s === "med") return "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400";
}

const STEP_LABELS: Record<string, string> = {
  discover: "Discovering pages",
  capture: "Taking screenshots",
  analysis: "Analysing",
  claude: "AI review",
};

export default async function AuditRunPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const run = await getAuditRun(id);
  if (!run) return notFound();

  const [targets, artifacts, findings, onboardingSteps] = await Promise.all([
    listAuditTargets(id),
    listArtifacts(id),
    listFindings(id),
    listOnboardingSteps(id),
  ]);
  const bucket = env("AUDIT_ARTIFACTS_BUCKET", "audit-artifacts");
  const stage =
    run.status === "done" ? ("done" satisfies Stage) : stageFromSiteSummary(run.site_summary);
  const isDone = run.status === "done";
  const isFailed = run.status === "failed";
  const isRunning = !isDone && !isFailed;

  // Screenshot URLs per target.
  const screenshotUrls = new Map<string, { desktop: string | null; mobile: string | null }>();
  for (const target of targets) {
    const desktop = artifacts.find(
      (a) => a.audit_target_id === target.id && a.kind === "screenshot_desktop",
    );
    const mobile = artifacts.find(
      (a) => a.audit_target_id === target.id && a.kind === "screenshot_mobile",
    );
    screenshotUrls.set(target.id, {
      desktop: desktop?.storage_path
        ? await signAuditArtifactUrl({ bucket, path: desktop.storage_path, expiresInSeconds: 60 * 60 })
        : null,
      mobile: mobile?.storage_path
        ? await signAuditArtifactUrl({ bucket, path: mobile.storage_path, expiresInSeconds: 60 * 60 })
        : null,
    });
  }

  // Legacy (no target_id) screenshots.
  if (targets.length === 0) {
    const desktop = artifacts.find((a) => a.kind === "screenshot_desktop");
    const mobile = artifacts.find((a) => a.kind === "screenshot_mobile");
    screenshotUrls.set("legacy", {
      desktop: desktop?.storage_path
        ? await signAuditArtifactUrl({ bucket, path: desktop.storage_path, expiresInSeconds: 60 * 60 })
        : null,
      mobile: mobile?.storage_path
        ? await signAuditArtifactUrl({ bucket, path: mobile.storage_path, expiresInSeconds: 60 * 60 })
        : null,
    });
  }

  // Collect all recs + deduplicate by id.
  const allRecs: Array<CroFinding & { pageRole: string }> = [];
  const seenIds = new Set<string>();
  for (const f of findings) {
    const items = Array.isArray(f.findings_json) ? (f.findings_json as CroFinding[]) : [];
    const meta = f.meta as Record<string, unknown> | null;
    const role =
      (meta?.role as string) ??
      (f.source === "llm" ? "site" : f.summary.includes("Cross") ? "cross_page" : "homepage");
    for (const r of items) {
      const key = r.id ?? `${f.id}-${allRecs.length}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      allRecs.push({ ...r, pageRole: role });
    }
  }

  // Sort: high first, then med, then low.
  const sevOrder = { high: 0, med: 1, low: 2 };
  allRecs.sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));

  const highCount = allRecs.filter((r) => r.severity === "high").length;
  const medCount = allRecs.filter((r) => r.severity === "med").length;
  const lowCount = allRecs.filter((r) => r.severity === "low").length;
  const hasLlm = findings.some((f) => f.source === "llm");

  // Onboarding data.
  const onboardingStatus = (run as Record<string, unknown>).onboarding_status as string | undefined ?? "pending";
  const onboardingSummary = (run as Record<string, unknown>).onboarding_summary as Record<string, unknown> | null;
  const onboardingDone = onboardingStatus === "done" || onboardingStatus === "blocked";
  const onboardingRunning = onboardingStatus === "running";
  const onboardingFailed = onboardingStatus === "failed";

  // Sign onboarding step screenshot URLs.
  const onboardingScreenshots = new Map<number, string>();
  for (const step of onboardingSteps) {
    if (step.screenshot_path) {
      try {
        const url = await signAuditArtifactUrl({
          bucket,
          path: step.screenshot_path,
          expiresInSeconds: 60 * 60,
        });
        onboardingScreenshots.set(step.step_idx, url);
      } catch {
        // Non-fatal.
      }
    }
  }

  const obStepCount = (onboardingSummary?.stepCount as number) ?? onboardingSteps.length;
  const obDistinctScreens = (onboardingSummary?.distinctScreens as number) ?? 0;
  const obTimeToValue = (onboardingSummary?.estimatedTimeToValueMs as number) ?? 0;
  const obFriction = (onboardingSummary?.frictionFlags as string[]) ?? [];
  const obFinalStatus = (onboardingSummary?.finalStatus as string) ?? onboardingStatus;
  const obBlockedReason = (onboardingSummary?.blockedReason as string) ?? null;
  const obRecommendations = (onboardingSummary?.recommendations as Array<Record<string, unknown>>) ?? [];
  const obDashboardFeedback = (onboardingSummary?.dashboardFeedback as Record<string, unknown> | null) ?? null;
  const obErrorText =
    (onboardingSummary?.error as string) ||
    (typeof (onboardingSummary as Record<string, unknown> | null)?.message === "string"
      ? String((onboardingSummary as Record<string, unknown>).message)
      : null);
  const lastObStep = onboardingSteps.length > 0 ? onboardingSteps[onboardingSteps.length - 1] : null;
  const lastObDetail = (lastObStep?.action_detail ?? {}) as Record<string, string | undefined>;
  const lastObInstruction = lastObDetail.instruction ? String(lastObDetail.instruction) : null;
  const lastObStepError = lastObDetail.error ? String(lastObDetail.error) : null;

  // Scoring
  const onboardingInput = obStepCount > 0 ? {
    stepCount: obStepCount,
    formFieldCount: (onboardingSummary?.formFieldCount as number) ?? 0,
    frictionFlags: obFriction,
    finalStatus: obFinalStatus,
    estimatedTimeToValueMs: obTimeToValue,
  } : null;
  const scores: AuditScores = computeAuditScores(allRecs, onboardingInput);
  const gc = gradeColor(scores.grade);

  // Executive summary from site_summary
  const siteSummary = run.site_summary as Record<string, unknown> | null;
  const productCategory = (siteSummary?.productCategory as string) ?? null;
  const valueProp = (siteSummary?.valueProp as string) ?? null;
  const icp = (siteSummary?.icp as string) ?? null;
  const conversionMotion = (siteSummary?.conversionMotion as string) ?? null;
  const plgMismatch = (siteSummary?.plgMismatch as boolean) ?? false;
  const hasSummary = !!(productCategory || valueProp);

  // Previous audits for this URL
  const previousAudits = await listAuditRunsForUrl(run.normalized_url, 5);
  const otherAudits = previousAudits.filter((a) => a.id !== run.id);

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <AuditAutoRefresh status={run.status} onboardingStatus={onboardingStatus} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 print:pb-2">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/audits" className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 print:hidden">
              All audits
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700 print:hidden">/</span>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              SaaS Growth Audit
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{run.normalized_url}</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <ShareButton />
          <PrintButton />
          <Link
            href={`/audits/new?url=${encodeURIComponent(run.normalized_url)}`}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Re-audit
          </Link>
          <Link
            href="/audits/new"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            New audit
          </Link>
        </div>
      </div>

      {/* Score + Executive Summary (shown when audit is done) */}
      {isDone && allRecs.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-[auto_1fr] print:grid-cols-[auto_1fr]">
          {/* Score ring */}
          <div className={`flex flex-col items-center justify-center rounded-2xl border border-zinc-200 ${gc.bg} px-8 py-6 dark:border-zinc-800`}>
            <div className="relative h-28 w-28">
              <svg className="h-28 w-28 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" strokeWidth="10" className="stroke-zinc-200 dark:stroke-zinc-800" />
                <circle
                  cx="60" cy="60" r="52" fill="none" strokeWidth="10"
                  strokeLinecap="round"
                  className={gc.ring}
                  strokeDasharray={`${(scores.overall / 100) * 327} 327`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-3xl font-bold ${gc.text}`}>{scores.overall}</span>
                <span className="text-xs text-zinc-500">/ 100</span>
              </div>
            </div>
            <div className={`mt-2 text-lg font-bold ${gc.text}`}>{scores.grade}</div>
            <div className="mt-1 flex gap-3 text-[11px] text-zinc-500">
              {scores.highCount > 0 && <span className="text-red-600">{scores.highCount} high</span>}
              {scores.medCount > 0 && <span className="text-amber-600">{scores.medCount} med</span>}
              {scores.lowCount > 0 && <span>{scores.lowCount} low</span>}
            </div>
            {scores.onboardingScore >= 0 && (
              <div className="mt-2 flex gap-3 text-[11px] text-zinc-400">
                <span>CRO: {scores.croScore}</span>
                <span>Onboarding: {scores.onboardingScore}</span>
              </div>
            )}
          </div>

          {/* Executive Summary */}
          <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">Executive Summary</h2>
            {hasSummary ? (
              <div className="mt-3 space-y-2">
                {valueProp && (
                  <p className="text-base font-medium text-zinc-900 dark:text-zinc-50">{valueProp}</p>
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  {productCategory && (
                    <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{productCategory}</span>
                  )}
                  {conversionMotion && (
                    <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {conversionMotion === "start_trial" ? "Free Trial" : conversionMotion === "signup" ? "Self-Serve Signup" : conversionMotion === "request_demo" ? "Demo-Led" : "Sales-Led"}
                    </span>
                  )}
                  {icp && (
                    <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{icp}</span>
                  )}
                </div>
                {plgMismatch && (
                  <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    PLG mismatch detected — your site targets self-serve buyers but uses a sales-led conversion motion.
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">
                {allRecs.length} recommendation{allRecs.length !== 1 ? "s" : ""} found across {targets.length} page{targets.length !== 1 ? "s" : ""}.
                {hasLlm ? " AI-powered analysis included." : ""}
              </p>
            )}
            <div className="mt-4 flex gap-4 text-xs text-zinc-500">
              <span>{targets.length} page{targets.length !== 1 ? "s" : ""} audited</span>
              <span>{allRecs.length} recommendation{allRecs.length !== 1 ? "s" : ""}</span>
              {hasLlm && <span>AI-powered</span>}
            </div>
          </div>
        </div>
      )}

      {/* Status bar (shown when running or failed) */}
      {!isDone && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          {isFailed ? (
            <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
          ) : (
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          )}
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {isFailed
              ? "Audit failed"
              : stage
                ? STEP_LABELS[stage] ?? stage
                : "Starting…"}
          </span>
          {run.error && !isDone ? (
            <span className="ml-auto text-xs text-red-600">{run.error}</span>
          ) : null}
        </div>
      )}

      {/* Two-job progress (always visible when not both done) */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {/* CRO progress */}
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-2 mb-2">
            <div className={`h-2 w-2 rounded-full ${isDone ? "bg-emerald-500" : isFailed ? "bg-red-500" : "animate-pulse bg-blue-500"}`} />
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">Website CRO</span>
            <span className="ml-auto text-[10px] text-zinc-400">
              {isDone ? "Complete" : isFailed ? "Failed" : stage ? STEP_LABELS[stage] ?? stage : "Starting"}
            </span>
          </div>
          {isRunning && (
            <div className="flex gap-1">
              {(["discover", "capture", "analysis", "claude"] as const).map((s) => {
                const st = stepState(stage, s);
                return (
                  <div
                    key={s}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      st === "done"
                        ? "bg-emerald-400 dark:bg-emerald-600"
                        : st === "doing"
                          ? "bg-blue-500 animate-pulse"
                          : "bg-zinc-200 dark:bg-zinc-800"
                    }`}
                  />
                );
              })}
            </div>
          )}
          {isDone && (
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-1 flex-1 rounded-full bg-emerald-400 dark:bg-emerald-600" />
              ))}
            </div>
          )}
        </div>

        {/* Onboarding progress */}
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-2 mb-2">
            <div className={`h-2 w-2 rounded-full ${
              onboardingDone
                ? obFinalStatus === "blocked" ? "bg-amber-500" : "bg-emerald-500"
                : onboardingFailed
                  ? "bg-red-500"
                  : onboardingRunning
                    ? "animate-pulse bg-violet-500"
                    : "bg-zinc-300 dark:bg-zinc-700"
            }`} />
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">Onboarding Flow</span>
            <span className="ml-auto text-[10px] text-zinc-400">
              {obFinalStatus === "done"
                ? "Complete"
                : obFinalStatus === "blocked"
                  ? "Blocked"
                  : onboardingFailed
                    ? "Failed"
                    : onboardingRunning
                      ? "Signing up..."
                      : "Queued"}
            </span>
          </div>
          <div className="flex gap-1">
            {onboardingRunning && !onboardingDone && !onboardingFailed ? (
              <div className="h-1 flex-1 rounded-full bg-violet-500 animate-pulse" />
            ) : onboardingDone ? (
              <div className={`h-1 flex-1 rounded-full ${obFinalStatus === "blocked" ? "bg-amber-400 dark:bg-amber-600" : "bg-emerald-400 dark:bg-emerald-600"}`} />
            ) : onboardingFailed ? (
              <div className="h-1 flex-1 rounded-full bg-red-400 dark:bg-red-600" />
            ) : (
              <div className="h-1 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800" />
            )}
          </div>
          {onboardingRunning && (
            <p className="mt-2 text-[10px] text-zinc-400">
              Navigating signup flow as test user...
            </p>
          )}
        </div>
      </div>

      {/* Pages discovered / captured (make this obvious) */}
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Pages</h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {targets.length > 0 ? `${targets.length} discovered` : isRunning ? "Discovering..." : "None found"}
          </span>
        </div>
        {targets.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {targets.map((t) => (
              <a
                key={t.id}
                href={`#page-${t.role}`}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/30 dark:hover:bg-zinc-900/60"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                    {roleLabel(t.role)}
                  </span>
                  <span className="ml-auto text-[11px] text-zinc-400">{t.status}</span>
                </div>
                <div className="mt-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{t.url}</div>
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {isRunning
              ? "We’ll show homepage/pricing/signup as soon as they’re discovered and captured."
              : "No pages have been captured yet."}
          </div>
        )}
      </div>

      {/* Main content: screenshots + recommendations */}
      <div className="mt-8 flex flex-col gap-6">
        {/* Severity summary (always visible) */}
        {allRecs.length > 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {allRecs.length} recommendation{allRecs.length !== 1 ? "s" : ""}
            </span>
            <div className="ml-auto flex gap-2 text-xs">
              {highCount > 0 && (
                <span className={`rounded-full px-2 py-0.5 font-medium ${severityColor("high")}`}>
                  {highCount} high
                </span>
              )}
              {medCount > 0 && (
                <span className={`rounded-full px-2 py-0.5 font-medium ${severityColor("med")}`}>
                  {medCount} med
                </span>
              )}
              {lowCount > 0 && (
                <span className={`rounded-full px-2 py-0.5 font-medium ${severityColor("low")}`}>
                  {lowCount} low
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Recommendations (above screenshots so they are visible first) */}
        {allRecs.length > 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  What to improve
                </h2>
                <span className="text-xs text-zinc-500">
                  {hasLlm ? "AI-powered" : "Heuristic"} analysis
                </span>
              </div>
            </div>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {allRecs.map((r, idx) => (
                <details
                  key={`${r.id ?? ""}-${idx}`}
                  id={`rec-${idx}`}
                  className={`group print:open ${
                    r.severity === "high"
                      ? "border-l-4 border-l-red-400 dark:border-l-red-600"
                      : r.severity === "med"
                        ? "border-l-4 border-l-amber-400 dark:border-l-amber-600"
                        : ""
                  }`}
                >
                  <summary className="flex cursor-pointer items-start gap-3 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${severityColor(r.severity ?? "med")}`}
                    >
                      {r.severity ?? "med"}
                    </span>
                    <div className="flex-1">
                      <div className="font-medium text-zinc-900 dark:text-zinc-50">
                        {r.title ?? "Recommendation"}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                        <span>{roleLabel(r.pageRole)}</span>
                        <span>·</span>
                        <span>{categorize(r.title ?? "")}</span>
                      </div>
                    </div>
                    <svg
                      className="mt-1 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                    {r.recommendation ? (
                      <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                        {r.recommendation}
                      </p>
                    ) : null}
                    {r.whyItMatters ? (
                      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">Why it matters: </span>
                        {r.whyItMatters}
                      </p>
                    ) : null}
                    {r.howToTest ? (
                      <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        How to test: {r.howToTest}
                      </p>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ) : isRunning ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
            Recommendations will appear once the analysis finishes.
          </div>
        ) : null}

        {/* ─── Onboarding Flow Section (always visible) ─── */}
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Onboarding Flow
          </h2>

            {/* Summary bar */}
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
              {onboardingDone ? (
                <div className={`h-2.5 w-2.5 rounded-full ${obFinalStatus === "blocked" ? "bg-amber-500" : "bg-emerald-500"}`} />
              ) : onboardingFailed ? (
                <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
              ) : (
                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
              )}
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {obFinalStatus === "done"
                  ? "Signup completed"
                  : obFinalStatus === "blocked"
                    ? "Signup blocked"
                    : onboardingFailed
                      ? "Onboarding failed"
                      : onboardingRunning
                        ? "Signing up…"
                        : "Pending"}
              </span>
              {obBlockedReason && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {obBlockedReason}
                </span>
              )}
              <div className="ml-auto flex gap-4 text-xs text-zinc-500">
                {obStepCount > 0 && (
                  <span>{obStepCount} step{obStepCount !== 1 ? "s" : ""}</span>
                )}
                {obDistinctScreens > 0 && (
                  <span>{obDistinctScreens} screen{obDistinctScreens !== 1 ? "s" : ""}</span>
                )}
                {obTimeToValue > 0 && (
                  <span>~{Math.round(obTimeToValue / 1000)}s to value</span>
                )}
              </div>
            </div>

            {/* Always-visible error details (copy/paste for debugging) */}
            {(obFinalStatus === "blocked" || onboardingFailed) && (obBlockedReason || obErrorText || lastObStepError || lastObInstruction) && (
              <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">Onboarding error details</p>
                  <p className="text-[11px] text-zinc-400">Copy/paste this whole block</p>
                </div>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
{`finalStatus: ${String(obFinalStatus)}
blockedReason: ${obBlockedReason ? String(obBlockedReason) : "—"}
error: ${obErrorText ? String(obErrorText) : "—"}
lastStep: ${lastObStep ? `${lastObStep.step_idx + 1} (${String(lastObStep.action_type)})` : "—"}
lastInstruction: ${lastObInstruction ? lastObInstruction : "—"}
lastStepError: ${lastObStepError ? lastObStepError : "—"}`}
                </pre>
              </div>
            )}

            {/* Friction flags */}
            {obFriction.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {obFriction.map((flag, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  >
                    {flag}
                  </span>
                ))}
              </div>
            )}

            {/* Step timeline */}
            {onboardingSteps.length > 0 && (
              <div className="mt-6 space-y-3">
                {onboardingSteps.map((step) => {
                  const screenshotSrc = onboardingScreenshots.get(step.step_idx);
                  const detail = (step.action_detail ?? {}) as Record<string, string | undefined>;
                  const isBlocked = step.action_type === "blocked";
                  const isDoneStep = step.action_type === "done";

                  return (
                    <details
                      key={step.id}
                      className={`group rounded-xl border ${
                        isBlocked
                          ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30"
                          : isDoneStep
                            ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30"
                            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                      }`}
                    >
                      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {step.step_idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                            {step.action_type === "fill"
                              ? `Fill: ${String(detail.instruction ?? "field").slice(0, 60)}`
                              : step.action_type === "click"
                                ? `Click: ${String(detail.reason ?? "button").slice(0, 50)}`
                                : step.action_type === "select"
                                  ? `Select: ${String(detail.value ?? "option").slice(0, 30)}`
                                  : step.action_type === "check"
                                    ? "Check checkbox"
                                    : step.action_type === "email_verify"
                                      ? "Email verification"
                                      : step.action_type === "skip"
                                        ? "Skip optional step"
                                        : step.action_type === "done"
                                          ? "Reached app / dashboard"
                                          : step.action_type === "blocked"
                                            ? `Blocked: ${step.blocked_reason ?? "unknown"}`
                                            : step.action_type}
                          </span>
                          {step.url && (
                            <span className="ml-2 truncate text-[11px] text-zinc-400">
                              {step.url}
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 text-[11px] text-zinc-400">
                          {step.duration_ms > 0 ? `${(step.duration_ms / 1000).toFixed(1)}s` : ""}
                        </span>
                        <svg
                          className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </summary>
                      <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                        {detail.reason && (
                          <p className="mb-3 text-xs text-zinc-500">{String(detail.reason)}</p>
                        )}
                        {screenshotSrc && (
                          <div className="max-h-[400px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={screenshotSrc}
                              alt={`Step ${step.step_idx + 1}`}
                              className="w-full"
                            />
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}

            {/* Onboarding recommendations */}
            {obRecommendations.length > 0 && (
              <div className="mt-6 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    Onboarding improvements
                  </h3>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {obRecommendations.map((rec, idx) => {
                    const title = String(rec.title ?? "Recommendation");
                    const severity = String(rec.severity ?? "med");
                    const recommendation = rec.recommendation ? String(rec.recommendation) : null;
                    const whyItMatters = rec.whyItMatters ? String(rec.whyItMatters) : null;
                    const howToTest = rec.howToTest ? String(rec.howToTest) : null;
                    const stepRefs = Array.isArray(rec.step_refs) ? (rec.step_refs as number[]) : [];
                    return (
                    <details key={idx} className="group">
                      <summary className="flex cursor-pointer items-start gap-3 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <span
                          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${severityColor(severity)}`}
                        >
                          {severity}
                        </span>
                        <div className="flex-1">
                          <div className="font-medium text-zinc-900 dark:text-zinc-50">
                            {title}
                          </div>
                          {stepRefs.length > 0 && (
                            <div className="mt-0.5 text-[11px] text-zinc-400">
                              Steps: {stepRefs.map((s) => s + 1).join(", ")}
                            </div>
                          )}
                        </div>
                        <svg
                          className="mt-1 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </summary>
                      <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                        {recommendation && (
                          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                            {recommendation}
                          </p>
                        )}
                        {whyItMatters && (
                          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                            <span className="font-medium text-zinc-700 dark:text-zinc-300">Why: </span>
                            {whyItMatters}
                          </p>
                        )}
                        {howToTest && (
                          <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            How to test: {howToTest}
                          </p>
                        )}
                      </div>
                    </details>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pending / running state */}
            {(onboardingRunning || onboardingStatus === "pending") && onboardingSteps.length === 0 && !onboardingFailed && (
              <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
                {onboardingRunning ? (
                  <>
                    <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Signing up as Jordan Rivera (Northlight Labs)</p>
                    <p className="mt-1 text-xs text-zinc-400">Navigating the signup flow, filling forms, mapping each step...</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-zinc-500">Onboarding audit queued</p>
                    <p className="mt-1 text-xs text-zinc-400">Will start shortly — runs independently from the CRO audit</p>
                  </>
                )}
              </div>
            )}

            {/* Failed state */}
            {onboardingFailed && onboardingSteps.length === 0 && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50/50 px-4 py-3 dark:border-red-900 dark:bg-red-950/30">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">Onboarding failed</p>
                {obBlockedReason && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{obBlockedReason}</p>
                )}
              </div>
            )}

            {/* Dashboard UI feedback */}
            {obDashboardFeedback && (
              <div className="mt-6 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    Dashboard UX review
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    First screen after signup — what a new user sees.
                  </p>
                </div>
                <div className="px-5 py-4">
                  {obDashboardFeedback.summary ? (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      {String(obDashboardFeedback.summary)}
                    </p>
                  ) : null}
                  {obDashboardFeedback.nextBestAction ? (
                    <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                      <span className="font-medium">Next best action: </span>
                      {String(obDashboardFeedback.nextBestAction)}
                    </p>
                  ) : null}
                  {Array.isArray(obDashboardFeedback.uiIssues) && obDashboardFeedback.uiIssues.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {(obDashboardFeedback.uiIssues as Array<Record<string, unknown>>).slice(0, 6).map((it, i) => (
                        <div key={i} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${severityColor(String(it.severity ?? "med"))}`}>
                              {String(it.severity ?? "med")}
                            </span>
                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                              {String(it.issue ?? "UI issue")}
                            </div>
                          </div>
                          {it.fix ? (
                            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                              {String(it.fix)}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {Array.isArray(obDashboardFeedback.activationChecklist) &&
                  obDashboardFeedback.activationChecklist.length > 0 ? (
                    <div className="mt-4">
                      <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                        Activation checklist
                      </div>
                      <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                        {(obDashboardFeedback.activationChecklist as string[]).slice(0, 8).map((s, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
                            <span>{String(s)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

        {/* Screenshots per target */}
        {targets.length > 0
          ? targets.map((target) => {
              const urls = screenshotUrls.get(target.id);
              return (
                <div
                  key={target.id}
                  id={`page-${target.role}`}
                  className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {roleLabel(target.role)}
                    </span>
                    <span className="truncate text-xs text-zinc-400">{target.url}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 p-4">
                    <div>
                      <div className="mb-2 text-xs font-medium text-zinc-500">Desktop</div>
                      {urls?.desktop ? (
                        <div className="max-h-[500px] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={urls.desktop} alt={`${roleLabel(target.role)} desktop`} className="w-full" />
                        </div>
                      ) : (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400 dark:border-zinc-800">
                          {isRunning ? "Capturing..." : "Not available"}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium text-zinc-500">Mobile</div>
                      {urls?.mobile ? (
                        <div className="mx-auto max-h-[500px] max-w-[200px] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={urls.mobile} alt={`${roleLabel(target.role)} mobile`} className="w-full" />
                        </div>
                      ) : (
                        <div className="mx-auto flex h-40 max-w-[200px] items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400 dark:border-zinc-800">
                          {isRunning ? "Capturing..." : "Not available"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          : null}

        {/* Previous audits for this URL */}
        {otherAudits.length > 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 print:hidden">
            <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Previous audits for this URL</h2>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {otherAudits.map((prev) => (
                <Link
                  key={prev.id}
                  href={`/audits/${prev.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <div className={`h-2 w-2 rounded-full ${prev.status === "done" ? "bg-emerald-500" : prev.status === "failed" ? "bg-red-500" : "bg-amber-500"}`} />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">
                    {new Date(prev.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="ml-auto text-xs text-zinc-400">{prev.status}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
