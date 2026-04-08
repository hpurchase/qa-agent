import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditAutoRefresh } from "./AuditClient";
import { getAuditRun, listArtifacts, listFindings } from "@/lib/db/readAudit";
import { signAuditArtifactUrl } from "@/lib/storage";
import type { CroFinding } from "@/lib/cro/heuristics";

function env(name: string, fallback?: string) {
  return process.env[name] ?? fallback ?? "";
}

type Stage = "capture" | "pricing" | "analysis" | "claude" | "done";

function stageFromSiteSummary(siteSummary: unknown | null): Stage | null {
  if (!siteSummary || typeof siteSummary !== "object") return null;
  const s = (siteSummary as { stage?: unknown }).stage;
  if (s === "capture" || s === "pricing" || s === "analysis" || s === "claude") return s;
  return null;
}

function stepState(current: Stage | null, step: Stage): "todo" | "doing" | "done" {
  const order: Stage[] = ["capture", "pricing", "analysis", "claude", "done"];
  const ci = current ? order.indexOf(current) : -1;
  const si = order.indexOf(step);
  if (ci === -1) return "todo";
  if (ci === si) return "doing";
  if (ci > si) return "done";
  return "todo";
}

export default async function AuditRunPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const run = await getAuditRun(id);
  if (!run) return notFound();

  const [artifacts, findings] = await Promise.all([listArtifacts(id), listFindings(id)]);
  const bucket = env("AUDIT_ARTIFACTS_BUCKET", "audit-artifacts");

  const desktop = artifacts.find((a) => a.kind === "screenshot_desktop");
  const mobile = artifacts.find((a) => a.kind === "screenshot_mobile");
  const pricing = artifacts.find((a) => a.kind === "pricing_html" || a.kind === "pricing_markdown");

  const desktopUrl =
    desktop?.storage_path ? await signAuditArtifactUrl({ bucket, path: desktop.storage_path, expiresInSeconds: 60 * 30 }) : null;
  const mobileUrl =
    mobile?.storage_path ? await signAuditArtifactUrl({ bucket, path: mobile.storage_path, expiresInSeconds: 60 * 30 }) : null;

  const heuristic = findings.find((f) => f.source === "heuristic");
  const llm = findings.find((f) => f.source === "llm");

  const recs = (llm?.findings_json ?? heuristic?.findings_json ?? []) as unknown;
  const recList: CroFinding[] = Array.isArray(recs) ? (recs as CroFinding[]) : [];

  const stage = run.status === "done" ? ("done" satisfies Stage) : stageFromSiteSummary(run.site_summary);

  const highCount = recList.filter((r) => r.severity === "high").length;
  const medCount = recList.filter((r) => r.severity === "med").length;
  const lowCount = recList.filter((r) => r.severity === "low").length;

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <AuditAutoRefresh status={run.status} />

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Audit
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{run.normalized_url}</p>
          <p className="text-sm">
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {run.status}
            </span>
            {run.error ? <span className="ml-2 text-xs text-red-600">{run.error}</span> : null}
          </p>
        </div>
        <Link
          href="/audits/new"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          New audit
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Progress</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-500">
            {pricing ? "Pricing found" : "No pricing artifact yet"} • {llm ? "Claude complete" : "Claude pending"}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["capture", "pricing", "analysis", "claude"] as const).map((s) => {
            const st = stepState(stage, s);
            const cls =
              st === "done"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                : st === "doing"
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                  : "bg-zinc-50 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-500";
            return (
              <div key={s} className={`rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium dark:border-zinc-800 ${cls}`}>
                {s}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Sticky recommendations sidebar */}
        <aside className="order-2 lg:order-1">
          <div className="lg:sticky lg:top-6 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Top issues</h2>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
                {llm ? "Claude" : "Heuristic"} • {recList.length}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-red-50 px-2 py-1 font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
                High {highCount}
              </span>
              <span className="rounded-full bg-amber-50 px-2 py-1 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Med {medCount}
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-1 font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                Low {lowCount}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {recList.length ? (
                recList.slice(0, 8).map((r, idx) => (
                  <a
                    key={r.id || idx}
                    href={`#rec-${idx}`}
                    className="group rounded-xl border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-zinc-900 dark:text-zinc-50 line-clamp-2">
                        {r.title ?? "Recommendation"}
                      </div>
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        {r.severity ?? "med"}
                      </span>
                    </div>
                  </a>
                ))
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Recommendations will appear once analysis finishes.
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="order-1 lg:order-2 flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">Desktop</div>
              {desktopUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={desktopUrl}
                  alt="Desktop screenshot"
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800"
                />
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
                  Screenshot pending…
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">Mobile</div>
              {mobileUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mobileUrl}
                  alt="Mobile screenshot"
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800"
                />
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
                  Screenshot pending…
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Recommendations</h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-500">
                {llm ? "Claude (vision)" : "Heuristic"} • {recList.length}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {recList.length ? (
                recList.map((r, idx) => {
                  const titleLower = (r.title ?? "").toLowerCase();
                  const category =
                    titleLower.includes("pricing")
                      ? "Pricing"
                      : titleLower.includes("sign") || titleLower.includes("trial")
                        ? "Signup"
                        : titleLower.includes("trust")
                          ? "Trust"
                          : "Messaging";

                  return (
                    <details
                      key={r.id || idx}
                      id={`rec-${idx}`}
                      className="group rounded-xl border border-zinc-200 p-4 open:bg-zinc-50 dark:border-zinc-800 dark:open:bg-zinc-900"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-col gap-1">
                            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                              {category}
                            </div>
                            <div className="font-medium text-zinc-900 dark:text-zinc-50">
                              {r.title ?? "Recommendation"}
                            </div>
                          </div>
                          <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                            {r.severity ?? "med"}
                          </span>
                        </div>
                        {r.recommendation ? (
                          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 line-clamp-2">
                            {r.recommendation}
                          </p>
                        ) : null}
                      </summary>

                      <div className="mt-3">
                        {r.recommendation ? (
                          <p className="text-sm text-zinc-700 dark:text-zinc-300">{r.recommendation}</p>
                        ) : null}
                        {r.whyItMatters ? (
                          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{r.whyItMatters}</p>
                        ) : null}
                        {r.howToTest ? (
                          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">Test: {r.howToTest}</p>
                        ) : null}
                      </div>
                    </details>
                  );
                })
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Recommendations will appear once the capture and analysis finishes.
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

