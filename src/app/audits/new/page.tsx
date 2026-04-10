"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function NewAuditForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(searchParams.get("url") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "Failed to create audit");
      if (!json?.id) throw new Error("Missing audit id");
      router.push(`/audits/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-2xl px-6 py-14">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3v11.25A2.25 2.25 0 006 16.5h12A2.25 2.25 0 0020.25 14.25V3M8.25 21h7.5"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Run a SaaS Growth Audit
              </h1>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                We’ll audit your website CRO and map your onboarding flow.
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="mt-6">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              SaaS homepage URL
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-2 focus-within:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:ring-zinc-700">
              <input
                type="url"
                required
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-saas.com"
                className="h-11 flex-1 bg-transparent px-4 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-600"
              />
              <button
                disabled={loading || !url.trim()}
                className="h-11 shrink-0 rounded-xl bg-zinc-900 px-6 text-sm font-semibold text-white transition-all hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    Starting…
                  </span>
                ) : (
                  "Start audit"
                )}
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
                {error}
              </div>
            ) : null}
          </form>

          <div className="mt-6 grid gap-2 text-xs text-zinc-500 dark:text-zinc-400 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
              <div className="font-semibold text-zinc-900 dark:text-zinc-50">CRO</div>
              <div className="mt-0.5">Screenshots + grounded fixes</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
              <div className="font-semibold text-zinc-900 dark:text-zinc-50">Onboarding</div>
              <div className="mt-0.5">Step map + time-to-value</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
              <div className="font-semibold text-zinc-900 dark:text-zinc-50">Async</div>
              <div className="mt-0.5">Results appear as they finish</div>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Tip: start from your marketing homepage (we’ll attempt to find pricing and signup).
        </p>
      </div>
    </div>
  );
}

export default function NewAuditPage() {
  return (
    <Suspense>
      <NewAuditForm />
    </Suspense>
  );
}
