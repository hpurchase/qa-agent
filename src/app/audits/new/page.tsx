"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewAuditPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
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
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 dark:bg-zinc-100">
          <svg className="h-6 w-6 text-white dark:text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          SaaS CRO Audit
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          Enter your SaaS homepage. We find pricing and signup pages, take screenshots, and give you actionable PLG recommendations.
        </p>

        <form onSubmit={onSubmit} className="mt-8">
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-2 focus-within:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:ring-zinc-700">
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
              className="h-11 shrink-0 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white transition-all hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Starting…
                </span>
              ) : (
                "Run audit"
              )}
            </button>
          </div>

          {error ? (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          ) : null}
        </form>

        <div className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 text-xs dark:border-zinc-800 dark:bg-zinc-800">
          <div className="flex flex-col items-center gap-1 bg-white px-3 py-3 dark:bg-zinc-950">
            <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span className="text-zinc-600 dark:text-zinc-400">Auto-discover pages</span>
          </div>
          <div className="flex flex-col items-center gap-1 bg-white px-3 py-3 dark:bg-zinc-950">
            <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            <span className="text-zinc-600 dark:text-zinc-400">Desktop + mobile</span>
          </div>
          <div className="flex flex-col items-center gap-1 bg-white px-3 py-3 dark:bg-zinc-950">
            <svg className="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            <span className="text-zinc-600 dark:text-zinc-400">AI-powered CRO</span>
          </div>
        </div>
      </div>
    </div>
  );
}
