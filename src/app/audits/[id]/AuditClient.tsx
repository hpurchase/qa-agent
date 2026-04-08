"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function AuditAutoRefresh(props: {
  status: string;
  onboardingStatus: string;
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);

  const croTerminal = props.status === "done" || props.status === "failed";
  const obTerminal =
    props.onboardingStatus === "done" ||
    props.onboardingStatus === "failed" ||
    props.onboardingStatus === "blocked";
  const allDone = croTerminal && obTerminal;

  useEffect(() => {
    if (allDone) return;
    const refresh = window.setInterval(() => router.refresh(), 4000);
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, [allDone, router]);

  if (allDone) return null;

  const croLabel = croTerminal
    ? props.status === "done"
      ? "CRO done"
      : "CRO failed"
    : "CRO running";
  const obLabel = obTerminal
    ? props.onboardingStatus === "done"
      ? "Onboarding done"
      : props.onboardingStatus === "blocked"
        ? "Onboarding blocked"
        : "Onboarding failed"
    : props.onboardingStatus === "running"
      ? "Onboarding running"
      : "Onboarding queued";

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/50">
      <svg className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
        Audit in progress
      </span>
      <div className="ml-auto flex items-center gap-3 text-xs text-amber-600 dark:text-amber-400">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${croTerminal ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`} />
          {croLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${obTerminal ? (props.onboardingStatus === "done" ? "bg-emerald-500" : "bg-red-500") : "animate-pulse bg-violet-500"}`} />
          {obLabel}
        </span>
        <span>{elapsed}s</span>
      </div>
    </div>
  );
}
