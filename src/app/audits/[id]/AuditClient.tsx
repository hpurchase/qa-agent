"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function AuditAutoRefresh(props: { status: string }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (props.status === "done" || props.status === "failed") return;
    const refresh = window.setInterval(() => router.refresh(), 4000);
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, [props.status, router]);

  if (props.status === "done" || props.status === "failed") return null;

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/50">
      <svg className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
        Audit in progress
      </span>
      <span className="text-xs text-amber-600 dark:text-amber-400">
        {elapsed}s elapsed — this page refreshes automatically
      </span>
    </div>
  );
}
