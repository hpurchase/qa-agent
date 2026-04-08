import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-black">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">SaaS Growth Audit</div>
        <Link
          href="/audits/new"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          Run audit
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            CRO + onboarding audit for your SaaS.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Paste your homepage URL. We capture evidence and return specific, actionable fixes — plus a
            step-by-step onboarding flow map.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/audits/new"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Start audit
            </Link>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              Results in ~2–5 minutes.
            </div>
          </div>

          <ul className="mt-10 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
              Desktop + mobile screenshots of homepage, pricing, and signup (when found).
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
              Onboarding flow run on desktop: step count, time-to-value estimate, friction points.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
              Evidence-based recommendations (quotes + screenshots), not generic tips.
            </li>
          </ul>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-10 text-xs text-zinc-500 dark:text-zinc-400">
        Built for PLG SaaS teams.
      </footer>
    </div>
  );
}
