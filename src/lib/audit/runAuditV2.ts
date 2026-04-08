import { downloadBytes, firecrawlScrape } from "@/lib/firecrawl";
import { insertArtifact, insertFinding, updateAuditRun } from "@/lib/db/auditRuns";
import { buildEvidencePack } from "@/lib/cro/evidence";
import { runHeuristicCroChecks } from "@/lib/cro/heuristics";
import { extractPricingSummary } from "@/lib/cro/pricing";
import { inferSaaSSiteSummary, generateGroundedRecommendations } from "@/lib/cro/llm";
import { downloadAuditArtifact, uploadAuditArtifact } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/server";

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

  function normalizeImageMediaType(v: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
    const t = v.split(";")[0]?.trim().toLowerCase();
    if (t === "image/jpeg" || t === "image/png" || t === "image/gif" || t === "image/webp") return t;
    return "image/jpeg";
  }

  function extFor(mt: string) {
    if (mt === "image/png") return "png";
    if (mt === "image/gif") return "gif";
    if (mt === "image/webp") return "webp";
    return "jpg";
  }

  // Stage: capture
  await updateAuditRun({
    id: params.auditRunId,
    siteSummary: stagePatch("capture"),
  });

  const sb = supabaseAdmin();
  const { data: existingArtifacts, error: artifactsErr } = await sb
    .from("audit_artifacts")
    .select("kind, storage_path, content")
    .eq("audit_run_id", params.auditRunId);
  if (artifactsErr) throw artifactsErr;

  const byKind = new Map<string, { storage_path: string | null; content: string | null }>();
  for (const a of (existingArtifacts ?? []) as Array<{
    kind: string;
    storage_path: string | null;
    content: string | null;
  }>) {
    byKind.set(a.kind, {
      storage_path: a.storage_path ?? null,
      content: a.content ?? null,
    });
  }

  const existingHtml = byKind.get("html")?.content ?? null;
  const existingDesktopPath = byKind.get("screenshot_desktop")?.storage_path ?? null;
  const existingMobilePath = byKind.get("screenshot_mobile")?.storage_path ?? null;

  const hasCapture = Boolean(existingHtml && existingDesktopPath && existingMobilePath);

  const desktop = hasCapture
    ? { html: existingHtml!, markdown: "", screenshotUrl: null as string | null }
    : await firecrawlScrape({
        url: params.url,
        mobile: false,
        viewport: { width: 1440, height: 900 },
      });

  const mobile = hasCapture
    ? { html: "", markdown: "", screenshotUrl: null as string | null }
    : await firecrawlScrape({
        url: params.url,
        mobile: true,
        viewport: { width: 390, height: 844 },
      });

  if (!hasCapture) {
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
  }

  let desktopShotBytes: ArrayBuffer | null = null;
  let mobileShotBytes: ArrayBuffer | null = null;
  let desktopShotMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null = null;
  let mobileShotMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null = null;

  if (hasCapture) {
    const d = await downloadAuditArtifact({ bucket, path: existingDesktopPath! });
    const m = await downloadAuditArtifact({ bucket, path: existingMobilePath! });
    desktopShotBytes = d.bytes;
    mobileShotBytes = m.bytes;
    desktopShotMediaType = normalizeImageMediaType(d.contentType);
    mobileShotMediaType = normalizeImageMediaType(m.contentType);
  } else {
    if (desktop.screenshotUrl) {
      const { bytes, contentType } = await downloadBytes(desktop.screenshotUrl);
      desktopShotBytes = bytes;
      desktopShotMediaType = normalizeImageMediaType(contentType);
      const storagePath = `audits/${params.auditRunId}/desktop.${extFor(desktopShotMediaType)}`;
      await uploadAuditArtifact({ bucket, path: storagePath, bytes, contentType });
      await insertArtifact({
        auditRunId: params.auditRunId,
        kind: "screenshot_desktop",
        storagePath,
        meta: { source: "firecrawl", fullPage: true, contentType, viewport: { width: 1440, height: 900 } },
      });
    }
    if (mobile.screenshotUrl) {
      const { bytes, contentType } = await downloadBytes(mobile.screenshotUrl);
      mobileShotBytes = bytes;
      mobileShotMediaType = normalizeImageMediaType(contentType);
      const storagePath = `audits/${params.auditRunId}/mobile.${extFor(mobileShotMediaType)}`;
      await uploadAuditArtifact({ bucket, path: storagePath, bytes, contentType });
      await insertArtifact({
        auditRunId: params.auditRunId,
        kind: "screenshot_mobile",
        storagePath,
        meta: { source: "firecrawl", fullPage: true, contentType, viewport: { width: 390, height: 844 } },
      });
    }
  }

  // Stage: pricing
  await updateAuditRun({
    id: params.auditRunId,
    siteSummary: stagePatch("pricing"),
  });

  const evidence = buildEvidencePack({ html: desktop.html, baseUrl: params.url });
  const existingPricingHtml = byKind.get("pricing_html")?.content ?? null;

  if (existingPricingHtml) {
    evidence.plg.pricingSummary = extractPricingSummary({
      baseUrl: params.url,
      pricingUrlCandidates: evidence.plg.pricingLinkHrefs,
      pricingHtml: existingPricingHtml,
    });
  } else if (evidence.plg.pricingLinkHrefs.length) {
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

    const llm = await generateGroundedRecommendations({
      evidence,
      siteSummary,
      screenshots: {
        desktop:
          desktopShotBytes && desktopShotMediaType
            ? { bytes: desktopShotBytes, mediaType: desktopShotMediaType }
            : undefined,
        mobile:
          mobileShotBytes && mobileShotMediaType
            ? { bytes: mobileShotBytes, mediaType: mobileShotMediaType }
            : undefined,
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
