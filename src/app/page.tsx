import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3v11.25A2.25 2.25 0 006 16.5h12A2.25 2.25 0 0020.25 14.25V3M8.25 21h7.5"
                />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                SaaS Growth Audit
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                CRO + onboarding reality check
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/audits/new"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Run a free audit
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-14">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
              Now includes onboarding flow audits
            </div>

            <h1 className="mt-4 text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              See what users actually experience.
              <span className="block text-zinc-500 dark:text-zinc-400">
                Not what you think happens.
              </span>
            </h1>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
              Paste your SaaS URL. We audit your marketing pages and then sign up as a test user to
              map the real onboarding journey—steps, friction, and time-to-value.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/audits/new"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Run a growth audit
              </Link>
              <div className="flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400 sm:justify-start">
                2–5 minutes • Desktop + mobile • Onboarding steps & screenshots
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                  Website CRO
                </div>
                <div className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Homepage, pricing, signup discovery + screenshots + grounded recommendations.
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                  Onboarding reality map
                </div>
                <div className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Step count, time-to-value estimate, and drop-off fixes with evidence.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Example output
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                What you’ll see
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
                    high
                  </span>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                    Onboarding: too many required fields
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Step 2 requires phone + company size before the user sees value. Defer these
                  fields until after first success moment.
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    med
                  </span>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                    Website: competing CTAs in hero
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Reduce the hero to one primary action (Trial/Signup) and one secondary action
                  (See pricing).
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Onboarding step count</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">5 steps</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Estimated time-to-value</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">~2m 10s</span>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-dashed border-zinc-200 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Each recommendation links to the exact page + step screenshot evidence.
            </div>
          </div>
        </div>

        <section className="mt-14 grid gap-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950 lg:grid-cols-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              1) Discover pages
            </div>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Finds pricing + signup even if they’re on subdomains.
            </p>
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              2) Capture evidence
            </div>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Screenshots + DOM signals to ground recommendations.
            </p>
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              3) Map onboarding
            </div>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Signs up and records every step until dashboard (or detects a block).
            </p>
          </div>
        </section>

        <div className="mt-10 flex justify-center">
          <Link
            href="/audits/new"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-6 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Get started
          </Link>
        </div>
      </main>

      <footer className="border-t border-zinc-200 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Built for PLG SaaS teams. Audits run asynchronously.
      </footer>
    </div>
  );
}
