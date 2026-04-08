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
      <div className="w-full max-w-lg text-center">
        {/* Logo */}
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 dark:bg-zinc-100">
          <svg className="h-7 w-7 text-white dark:text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-1.5M12 12.75l3-1.5m0 0l1.5-.75M12 12.75l-3-1.5m0 0l-1.5-.75M12 12.75V18" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          SaaS Growth Audit
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Drop your SaaS URL. We audit your landing pages <span className="font-medium text-zinc-700 dark:text-zinc-300">and</span> sign up for your product to map the entire onboarding flow.
        </p>

        {/* Input */}
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

        {/* What you get */}
        <div className="mt-10">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            What you get
          </p>
          <div className="grid grid-cols-2 gap-3">
            {/* CRO Audit card */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Website CRO Audit</h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Desktop + mobile screenshots of homepage, pricing, and signup. AI-powered recommendations to improve conversion.
              </p>
            </div>

            {/* Onboarding Audit card */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950">
                <svg className="h-5 w-5 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Onboarding Flow Audit</h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Signs up for your product, maps every step, measures time-to-value, and finds drop-off points.
              </p>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-8">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            How it works
          </p>
          <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 text-xs dark:border-zinc-800 dark:bg-zinc-800">
            <div className="flex flex-col items-center gap-1.5 bg-white px-2 py-3 dark:bg-zinc-950">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800">1</span>
              <span className="text-center text-zinc-600 dark:text-zinc-400">Discover pages</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 bg-white px-2 py-3 dark:bg-zinc-950">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800">2</span>
              <span className="text-center text-zinc-600 dark:text-zinc-400">Screenshot &amp; scrape</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 bg-white px-2 py-3 dark:bg-zinc-950">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800">3</span>
              <span className="text-center text-zinc-600 dark:text-zinc-400">Sign up &amp; map flow</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 bg-white px-2 py-3 dark:bg-zinc-950">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800">4</span>
              <span className="text-center text-zinc-600 dark:text-zinc-400">AI analysis</span>
            </div>
          </div>
        </div>

        <p className="mt-6 text-[11px] text-zinc-400 dark:text-zinc-600">
          Results typically appear within 2-5 minutes. Both audits run independently.
        </p>
      </div>
    </div>
  );
}
