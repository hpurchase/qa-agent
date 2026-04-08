import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            SaaS CRO Audit (single URL)
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Paste a SaaS landing page URL. We’ll capture desktop + mobile
            full-page screenshots, extract DOM evidence, and generate PLG-focused
            CRO suggestions.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/audits/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Create an audit
          </Link>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            v1 focuses on PLG signals like pricing clarity and signup motion.
          </p>
        </div>
      </main>
    </div>
  );
}
