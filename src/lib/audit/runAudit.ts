import { firecrawlScrape, downloadBytes } from "@/lib/firecrawl";
import { insertArtifact, insertFinding, updateAuditRun } from "@/lib/db/auditRuns";
import { uploadAuditArtifact } from "@/lib/storage";
import { buildEvidencePack } from "@/lib/cro/evidence";
import { runHeuristicCroChecks } from "@/lib/cro/heuristics";


function requiredEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

export async function runSingleUrlCapture(params: {
  auditRunId: string;
  url: string;
}) {
  const bucket = requiredEnv("AUDIT_ARTIFACTS_BUCKET", "audit-artifacts");

  await updateAuditRun({ id: params.auditRunId, status: "running", error: null });

  const desktop = await firecrawlScrape({
    url: params.url,
    mobile: false,
    viewport: { width: 1440, height: 900 },
  });

  const mobile = await firecrawlScrape({
    url: params.url,
    mobile: true,
    viewport: { width: 390, height: 844 },
  });

  await insertArtifact({
    auditRunId: params.auditRunId,
    kind: "html",
    content: desktop.html,
    meta: { source: "firecrawl", variant: "desktop" },
  });

  await insertArtifact({
    auditRunId: params.auditRunId,
    kind: "markdown",
    content: desktop.markdown,
    meta: { source: "firecrawl", variant: "desktop" },
  });

  if (desktop.screenshotUrl) {
    const { bytes, contentType } = await downloadBytes(desktop.screenshotUrl);
    const storagePath = `audits/${params.auditRunId}/desktop.webp`;
    await uploadAuditArtifact({ bucket, path: storagePath, bytes, contentType });
    await insertArtifact({
      auditRunId: params.auditRunId,
      kind: "screenshot_desktop",
      storagePath,
      meta: { source: "firecrawl", fullPage: true, viewport: { width: 1440, height: 900 } },
    });
  }

  if (mobile.screenshotUrl) {
    const { bytes, contentType } = await downloadBytes(mobile.screenshotUrl);
    const storagePath = `audits/${params.auditRunId}/mobile.webp`;
    await uploadAuditArtifact({ bucket, path: storagePath, bytes, contentType });
    await insertArtifact({
      auditRunId: params.auditRunId,
      kind: "screenshot_mobile",
      storagePath,
      meta: { source: "firecrawl", fullPage: true, viewport: { width: 390, height: 844 } },
    });
  }

  // CRO analysis (heuristics + optional LLM).
  const evidence = buildEvidencePack({ html: desktop.html, baseUrl: params.url });
  const heuristic = runHeuristicCroChecks(evidence);
  await insertFinding({
    auditRunId: params.auditRunId,
    source: "heuristic",
    summary: "Heuristic CRO checks",
    findingsJson: heuristic,
    meta: { evidence },
  });

  // v1 path is deprecated; v2 uses async worker + Claude vision.

  await updateAuditRun({ id: params.auditRunId, status: "done" });
}

