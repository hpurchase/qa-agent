import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditAutoRefresh } from "./AuditClient";
import {
  getAuditRun,
  listAuditTargets,
  listArtifacts,
  listFindings,
} from "@/lib/db/readAudit";
import { signAuditArtifactUrl } from "@/lib/storage";
import type { CroFinding } from "@/lib/cro/heuristics";

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

  const [targets, artifacts, findings] = await Promise.all([
    listAuditTargets(id),
    listArtifacts(id),
    listFindings(id),
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

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <AuditAutoRefresh status={run.status} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            CRO Audit
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{run.normalized_url}</p>
        </div>
        <Link
          href="/audits/new"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          New audit
        </Link>
      </div>

      {/* Status bar */}
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        {isDone ? (
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        ) : isFailed ? (
          <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
        ) : (
          <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
        )}
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {isDone
            ? "Audit complete"
            : isFailed
              ? "Audit failed"
              : stage
                ? STEP_LABELS[stage] ?? stage
                : "Starting…"}
        </span>
        {run.error && !isDone ? (
          <span className="ml-auto text-xs text-red-600">{run.error}</span>
        ) : null}
        {isDone && (
          <span className="ml-auto text-xs text-zinc-500">
            {targets.length} page{targets.length !== 1 ? "s" : ""} audited
            {hasLlm ? " • AI-powered" : ""}
          </span>
        )}
      </div>

      {/* Progress steps (only while running) */}
      {isRunning ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {(["discover", "capture", "analysis", "claude"] as const).map((s) => {
            const st = stepState(stage, s);
            return (
              <div
                key={s}
                className={`rounded-lg px-3 py-2 text-center text-xs font-medium transition-colors ${
                  st === "done"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                    : st === "doing"
                      ? "bg-zinc-900 text-white animate-pulse dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
                }`}
              >
                {STEP_LABELS[s] ?? s}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Pages discovered */}
      {targets.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {targets.map((t) => (
            <a
              key={t.id}
              href={`#page-${t.role}`}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {roleLabel(t.role)}
              </span>
              <span className="max-w-[180px] truncate text-zinc-400">{t.url}</span>
              {t.status === "done" ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : t.status === "failed" ? (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              ) : (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              )}
            </a>
          ))}
        </div>
      ) : null}

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
                  className="group"
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
                          <img
                            src={urls.desktop}
                            alt={`${roleLabel(target.role)} desktop`}
                            className="w-full"
                          />
                        </div>
                      ) : (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400 dark:border-zinc-800">
                          {isRunning ? "Capturing…" : "Not available"}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium text-zinc-500">Mobile</div>
                      {urls?.mobile ? (
                        <div className="mx-auto max-h-[500px] max-w-[200px] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={urls.mobile}
                            alt={`${roleLabel(target.role)} mobile`}
                            className="w-full"
                          />
                        </div>
                      ) : (
                        <div className="mx-auto flex h-40 max-w-[200px] items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-400 dark:border-zinc-800">
                          {isRunning ? "Capturing…" : "Not available"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          : (() => {
              const urls = screenshotUrls.get("legacy");
              if (!urls?.desktop && !urls?.mobile) return null;
              return (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {urls?.desktop ? (
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                      <div className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">Desktop</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urls.desktop} alt="Desktop" className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800" />
                    </div>
                  ) : null}
                  {urls?.mobile ? (
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                      <div className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">Mobile</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urls.mobile} alt="Mobile" className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800" />
                    </div>
                  ) : null}
                </div>
              );
            })()}
      </div>
    </div>
  );
}
