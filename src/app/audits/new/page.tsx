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
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-14">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Create a SaaS CRO audit
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          PLG-focused. We’ll capture desktop+mobile screenshots and generate CRO suggestions.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            URL
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="e.g. https://seospace.co"
            className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:ring-zinc-700"
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            disabled={loading}
            className="mt-2 inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {loading ? "Creating…" : "Run audit"}
          </button>
        </form>
      </div>
    </div>
  );
}

