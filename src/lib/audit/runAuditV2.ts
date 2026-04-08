import { downloadBytes, firecrawlScrape } from "@/lib/firecrawl";
import { insertArtifact, insertFinding, updateAuditRun } from "@/lib/db/auditRuns";
import { buildEvidencePack } from "@/lib/cro/evidence";
import { runHeuristicCroChecks } from "@/lib/cro/heuristics";
import { extractPricingSummary } from "@/lib/cro/pricing";
import { inferSaaSSiteSummary, generateGroundedRecommendations } from "@/lib/cro/llm";
import { uploadAuditArtifact } from "@/lib/storage";

function requiredEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function stagePatch(stage: string) {
  return { stage, updatedAt: new Date().toISOString() };
}

export async function runSingleUrlCaptureV2(params: { auditRunId: string; url: string }) {
  const bucket = requiredEnv("AUDIT_ARTIFACTS_BUCKET", "audit-artifacts");

  // Stage: capture
  await updateAuditRun({
    id: params.auditRunId,
    siteSummary: stagePatch("capture"),
  });

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

  // Stage: pricing
  await updateAuditRun({
    id: params.auditRunId,
    siteSummary: stagePatch("pricing"),
  });

  const evidence = buildEvidencePack({ html: desktop.html, baseUrl: params.url });
  if (evidence.plg.pricingLinkHrefs.length) {
    const pricing = await firecrawlScrape({
      url: evidence.plg.pricingLinkHrefs[0]!,
      mobile: false,
      viewport: { width: 1440, height: 900 },
    });
    await insertArtifact({
      auditRunId: params.auditRunId,
      kind: "pricing_html",
      content: pricing.html,
      meta: { source: "firecrawl", url: evidence.plg.pricingLinkHrefs[0] },
    });
    await insertArtifact({
      auditRunId: params.auditRunId,
      kind: "pricing_markdown",
      content: pricing.markdown,
      meta: { source: "firecrawl", url: evidence.plg.pricingLinkHrefs[0] },
    });

    evidence.plg.pricingSummary = extractPricingSummary({
      baseUrl: params.url,
      pricingUrlCandidates: evidence.plg.pricingLinkHrefs,
      pricingHtml: pricing.html,
    });
  }

  // Stage: analysis
  await updateAuditRun({
    id: params.auditRunId,
    siteSummary: stagePatch("analysis"),
  });

  const heuristic = runHeuristicCroChecks(evidence);
  await insertFinding({
    auditRunId: params.auditRunId,
    source: "heuristic",
    summary: "Heuristic CRO checks",
    findingsJson: heuristic,
    meta: { evidence },
  });

  // Claude vision (optional; skip if key missing).
  if (process.env.ANTHROPIC_API_KEY) {
    const siteSummary = await inferSaaSSiteSummary({ evidence });
    await updateAuditRun({ id: params.auditRunId, siteSummary: { ...siteSummary, ...stagePatch("claude") } });

    const desktopShot = desktop.screenshotUrl ? await downloadBytes(desktop.screenshotUrl) : null;
    const mobileShot = mobile.screenshotUrl ? await downloadBytes(mobile.screenshotUrl) : null;

    const llm = await generateGroundedRecommendations({
      evidence,
      siteSummary,
      screenshots: {
        desktop: desktopShot ? { bytes: desktopShot.bytes, mediaType: "image/webp" } : undefined,
        mobile: mobileShot ? { bytes: mobileShot.bytes, mediaType: "image/webp" } : undefined,
      },
    });

    await insertFinding({
      auditRunId: params.auditRunId,
      source: "llm",
      summary: "Claude vision grounded recommendations",
      findingsJson: llm.recommendations,
      meta: { evidence, siteSummary },
    });
  }
}

