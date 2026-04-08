"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AuditAutoRefresh(props: { status: string }) {
  const router = useRouter();

  useEffect(() => {
    if (props.status === "done" || props.status === "failed") return;
    const t = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(t);
  }, [props.status, router]);

  return null;
}

