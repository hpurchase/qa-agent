import Link from "next/link";
import { listAuditRuns } from "@/lib/db/readAudit";

function statusDot(status: string) {
  if (status === "done") return "bg-emerald-500";
  if (status === "failed") return "bg-red-500";
  return "bg-amber-500 animate-pulse";
}

function statusLabel(status: string) {
  if (status === "done") return "Complete";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  return "Queued";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function AuditsPage() {
  const runs = await listAuditRuns(100);

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Audits
        </h1>
        <Link
          href="/audits/new"
          className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          New audit
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900">
            <svg className="h-7 w-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h12A2.25 2.25 0 0020.25 14.25V3M8.25 21h7.5" />
            </svg>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No audits yet</p>
          <Link
            href="/audits/new"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Run your first audit
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {runs.map((run) => {
              const siteSummary = run.site_summary as Record<string, unknown> | null;
              const valueProp = (siteSummary?.valueProp as string) ?? null;
              const productCategory = (siteSummary?.productCategory as string) ?? null;

              return (
                <Link
                  key={run.id}
                  href={`/audits/${run.id}`}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(run.status)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {run.normalized_url}
                      </span>
                      {productCategory && (
                        <span className="hidden shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 sm:inline dark:bg-zinc-800 dark:text-zinc-400">
                          {productCategory}
                        </span>
                      )}
                    </div>
                    {valueProp && (
                      <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {valueProp}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`text-xs font-medium ${run.status === "done" ? "text-emerald-600" : run.status === "failed" ? "text-red-600" : "text-amber-600"}`}>
                      {statusLabel(run.status)}
                    </span>
                    <span className="text-xs text-zinc-400">{timeAgo(run.created_at)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
