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
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-lg">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            SaaS CRO Audit
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Paste a landing page URL. We screenshot it, analyse the DOM and
            visuals, and give you PLG-focused conversion recommendations.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-8">
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:ring-zinc-700">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="h-10 flex-1 bg-transparent px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-600"
            />
            <button
              disabled={loading || !url.trim()}
              className="h-10 shrink-0 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {loading ? "Analysing…" : "Audit"}
            </button>
          </div>

          {error ? (
            <p className="mt-3 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
        </form>

        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-zinc-400 dark:text-zinc-600">
          <span>Desktop + mobile screenshots</span>
          <span aria-hidden="true">·</span>
          <span>Pricing analysis</span>
          <span aria-hidden="true">·</span>
          <span>Claude vision</span>
        </div>
      </div>
    </div>
  );
}
