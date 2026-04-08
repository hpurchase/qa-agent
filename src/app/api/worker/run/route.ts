import { NextResponse } from "next/server";
import { claimNextAuditJob, updateAuditJob } from "@/lib/db/auditJobs";
import { getAuditRun } from "@/lib/db/readAudit";
import { updateAuditRun } from "@/lib/db/auditRuns";
import { runSingleUrlCaptureV2 } from "@/lib/audit/runAuditV2";

export const maxDuration = 300;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  const workerToken = process.env.WORKER_TOKEN;
  const got = req.headers.get("x-worker-token");
  if (workerToken && got === workerToken) return true;

  return false;
}

async function runWorker(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId = req.headers.get("x-worker-id") ?? "vercel-cron";
  const maxJobs = Number(req.headers.get("x-max-jobs") ?? "1");

  const results: Array<{ jobId: string; auditRunId: string; status: string; error?: string }> = [];

  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextAuditJob({ lockedBy: workerId });
    if (!job) break;

    try {
      const run = await getAuditRun(job.audit_run_id);
      if (!run) throw new Error("Missing audit run");

      await updateAuditRun({ id: run.id, status: "running", error: null });
      await runSingleUrlCaptureV2({ auditRunId: run.id, url: run.normalized_url });
      await updateAuditJob({ id: job.id, status: "done", error: null });
      await updateAuditRun({ id: run.id, status: "done" });
      results.push({ jobId: job.id, auditRunId: run.id, status: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const attempts = job.attempts ?? 1;
      const maxAttempts = 3;

      if (attempts < maxAttempts) {
        const delayMs = Math.min(15 * 60_000, 30_000 * Math.pow(2, attempts - 1));
        await updateAuditJob({
          id: job.id,
          status: "queued",
          error: message,
          runAfter: new Date(Date.now() + delayMs),
        });
        await updateAuditRun({ id: job.audit_run_id, status: "queued", error: message });
        results.push({ jobId: job.id, auditRunId: job.audit_run_id, status: "requeued", error: message });
      } else {
        await updateAuditJob({ id: job.id, status: "failed", error: message });
        await updateAuditRun({ id: job.audit_run_id, status: "failed", error: message });
        results.push({ jobId: job.id, auditRunId: job.audit_run_id, status: "failed", error: message });
      }
    }

    await sleep(100);
  }

  return NextResponse.json({ processed: results.length, results }, { status: 200 });
}

export async function GET(req: Request) {
  return runWorker(req);
}

export async function POST(req: Request) {
  return runWorker(req);
}
