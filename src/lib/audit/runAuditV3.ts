import { downloadBytes, firecrawlScrape, probeUrlExists } from "@/lib/firecrawl";
import sharp from "sharp";
import { insertArtifact, insertFinding, updateAuditRun } from "@/lib/db/auditRuns";
import {
  insertAuditTarget,
  updateAuditTarget,
  listAuditTargets,
} from "@/lib/db/auditTargets";
import { buildEvidencePack, type EvidencePack } from "@/lib/cro/evidence";
import { runHeuristicCroChecks } from "@/lib/cro/heuristics";
import { extractPricingSummary } from "@/lib/cro/pricing";
import { inferSaaSSiteSummary, generateGroundedRecommendations } from "@/lib/cro/llm";
import { runCrossPageChecks, type PageEvidence } from "@/lib/cro/crossPage";
import { discoverTargets } from "@/lib/discovery/discover";
import { downloadAuditArtifact, uploadAuditArtifact } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { AuditTargetRole } from "@/lib/db/types";

function requiredEnv(name: string, fallback?: string): string {
  return process.env[name] ?? fallback ?? "";
}

function stagePatch(stage: string) {
  return { stage, updatedAt: new Date().toISOString() };
}

function normalizeImageMediaType(
  v: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
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

// Use shared probeUrlExists from firecrawl.ts (has timeout + fallback).

async function resizeForVision(bytes: ArrayBuffer): Promise<{ bytes: ArrayBuffer; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }> {
  const img = sharp(Buffer.from(bytes));
  const meta = await img.metadata();
  const maxEdge = 1568;
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= maxEdge && h <= maxEdge) {
    return { bytes, mediaType: "image/jpeg" };
  }
  const resized = await img.resize({
    width: w > h ? maxEdge : undefined,
    height: h >= w ? maxEdge : undefined,
    fit: "inside",
    withoutEnlargement: true,
  }).jpeg({ quality: 85 }).toBuffer();
  const ab = new ArrayBuffer(resized.byteLength);
  new Uint8Array(ab).set(resized);
  return { bytes: ab, mediaType: "image/jpeg" };
}

type CapturedTarget = {
  targetId: string;
  role: AuditTargetRole;
  url: string;
  html: string;
  evidence: EvidencePack;
  desktopShotBytes: ArrayBuffer | null;
  desktopShotMediaType: string | null;
  mobileShotBytes: ArrayBuffer | null;
  mobileShotMediaType: string | null;
};

async function loadExistingScreenshots(params: {
  targetId: string;
  auditRunId: string;
  bucket: string;
}): Promise<{
  desktopShotBytes: ArrayBuffer | null;
  desktopShotMediaType: string | null;
  mobileShotBytes: ArrayBuffer | null;
  mobileShotMediaType: string | null;
}> {
  const sb = supabaseAdmin();
  const { data: arts } = await sb
    .from("audit_artifacts")
    .select("kind, storage_path")
    .eq("audit_target_id", params.targetId)
    .in("kind", ["screenshot_desktop", "screenshot_mobile"]);

  let desktopShotBytes: ArrayBuffer | null = null;
  let desktopShotMediaType: string | null = null;
  let mobileShotBytes: ArrayBuffer | null = null;
  let mobileShotMediaType: string | null = null;

  for (const a of (arts ?? []) as Array<{ kind: string; storage_path: string | null }>) {
    if (!a.storage_path) continue;
    try {
      const dl = await downloadAuditArtifact({ bucket: params.bucket, path: a.storage_path });
      const mt = normalizeImageMediaType(dl.contentType);
      if (a.kind === "screenshot_desktop") {
        desktopShotBytes = dl.bytes;
        desktopShotMediaType = mt;
      } else {
        mobileShotBytes = dl.bytes;
        mobileShotMediaType = mt;
      }
    } catch {
      // Non-fatal: screenshot may not exist in storage.
    }
  }

  return { desktopShotBytes, desktopShotMediaType, mobileShotBytes, mobileShotMediaType };
}

async function captureTarget(params: {
  auditRunId: string;
  targetId: string;
  role: AuditTargetRole;
  url: string;
  bucket: string;
}): Promise<CapturedTarget> {
  await updateAuditTarget({ id: params.targetId, status: "running" });

  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from("audit_artifacts")
    .select("kind, storage_path, content")
    .eq("audit_target_id", params.targetId);

  const byKind = new Map<string, { storage_path: string | null; content: string | null }>();
  for (const a of (existing ?? []) as Array<{
    kind: string;
    storage_path: string | null;
    content: string | null;
  }>) {
    byKind.set(a.kind, { storage_path: a.storage_path, content: a.content });
  }

  const existingHtml = byKind.get("html")?.content ?? null;
  const existingDesktopPath = byKind.get("screenshot_desktop")?.storage_path ?? null;
  const existingMobilePath = byKind.get("screenshot_mobile")?.storage_path ?? null;
  const hasCapture = Boolean(existingHtml && existingDesktopPath && existingMobilePath);

  if (!hasCapture) {
    const ok = await probeUrlExists(params.url);
    if (!ok) {
      throw new Error(`Preflight failed: URL not reachable (status >= 400) ${params.url}`);
    }
  }

  const desktop = hasCapture
    ? { html: existingHtml!, markdown: "", screenshotUrl: null as string | null, scrapeId: null as string | null }
    : await firecrawlScrape({ url: params.url, mobile: false, viewport: { width: 1440, height: 900 } });

  const mobile = hasCapture
    ? { html: "", markdown: "", screenshotUrl: null as string | null, scrapeId: null as string | null }
    : await firecrawlScrape({ url: params.url, mobile: true, viewport: { width: 390, height: 844 } });

  if (!hasCapture && !existingHtml) {
    await insertArtifact({
      auditRunId: params.auditRunId,
      auditTargetId: params.targetId,
      kind: "html",
      content: desktop.html,
      meta: { source: "firecrawl", variant: "desktop" },
    });
    await insertArtifact({
      auditRunId: params.auditRunId,
      auditTargetId: params.targetId,
      kind: "markdown",
      content: desktop.markdown,
      meta: { source: "firecrawl", variant: "desktop" },
    });
  }

  let desktopShotBytes: ArrayBuffer | null = null;
  let mobileShotBytes: ArrayBuffer | null = null;
  let desktopShotMediaType: string | null = null;
  let mobileShotMediaType: string | null = null;

  if (hasCapture) {
    const d = await downloadAuditArtifact({ bucket: params.bucket, path: existingDesktopPath! });
    const m = await downloadAuditArtifact({ bucket: params.bucket, path: existingMobilePath! });
    desktopShotBytes = d.bytes;
    desktopShotMediaType = normalizeImageMediaType(d.contentType);
    mobileShotBytes = m.bytes;
    mobileShotMediaType = normalizeImageMediaType(m.contentType);
  } else {
    if (desktop.screenshotUrl) {
      const { bytes, contentType } = await downloadBytes(desktop.screenshotUrl);
      desktopShotBytes = bytes;
      desktopShotMediaType = normalizeImageMediaType(contentType);
      const storagePath = `audits/${params.auditRunId}/${params.targetId}_desktop.${extFor(desktopShotMediaType)}`;
      await uploadAuditArtifact({ bucket: params.bucket, path: storagePath, bytes, contentType });
      await insertArtifact({
        auditRunId: params.auditRunId,
        auditTargetId: params.targetId,
        kind: "screenshot_desktop",
        storagePath,
        meta: { source: "firecrawl", fullPage: true, contentType, viewport: { width: 1440, height: 900 } },
      });
    }
    if (mobile.screenshotUrl) {
      const { bytes, contentType } = await downloadBytes(mobile.screenshotUrl);
      mobileShotBytes = bytes;
      mobileShotMediaType = normalizeImageMediaType(contentType);
      const storagePath = `audits/${params.auditRunId}/${params.targetId}_mobile.${extFor(mobileShotMediaType)}`;
      await uploadAuditArtifact({ bucket: params.bucket, path: storagePath, bytes, contentType });
      await insertArtifact({
        auditRunId: params.auditRunId,
        auditTargetId: params.targetId,
        kind: "screenshot_mobile",
        storagePath,
        meta: { source: "firecrawl", fullPage: true, contentType, viewport: { width: 390, height: 844 } },
      });
    }
  }

  const evidence = buildEvidencePack({ html: desktop.html || existingHtml || "", baseUrl: params.url });
  await updateAuditTarget({ id: params.targetId, status: "done" });

  return {
    targetId: params.targetId,
    role: params.role,
    url: params.url,
    html: desktop.html || existingHtml || "",
    evidence,
    desktopShotBytes,
    desktopShotMediaType,
    mobileShotBytes,
    mobileShotMediaType,
  };
}

export async function runMultiPageAudit(params: { auditRunId: string; url: string }) {
  const bucket = requiredEnv("AUDIT_ARTIFACTS_BUCKET", "audit-artifacts");

  // Stage: discover
  await updateAuditRun({ id: params.auditRunId, siteSummary: stagePatch("discover") });

  let targets = await listAuditTargets(params.auditRunId);

  const needsDiscovery =
    targets.length === 0 ||
    (targets.length === 1 && targets[0].role === "homepage" && targets[0].status !== "done");

  if (needsDiscovery && targets.length > 0) {
    // Partial discovery from a previous failed attempt — clean up orphaned homepage target.
    const sb2 = supabaseAdmin();
    await sb2.from("audit_artifacts").delete().eq("audit_target_id", targets[0].id);
    await sb2.from("audit_targets").delete().eq("id", targets[0].id);
    targets = [];
  }

  if (needsDiscovery) {
    const homepageTarget = await insertAuditTarget({
      auditRunId: params.auditRunId,
      role: "homepage",
      url: params.url,
      normalizedUrl: params.url,
    });

    // Scrape homepage for discovery + capture in one shot (saves 1 credit).
    await updateAuditRun({ id: params.auditRunId, siteSummary: stagePatch("capture") });

    const homepageScrape = await firecrawlScrape({
      url: params.url,
      mobile: false,
      viewport: { width: 1440, height: 900 },
    });

    await insertArtifact({
      auditRunId: params.auditRunId,
      auditTargetId: homepageTarget.id,
      kind: "html",
      content: homepageScrape.html,
      meta: { source: "firecrawl", variant: "desktop" },
    });
    await insertArtifact({
      auditRunId: params.auditRunId,
      auditTargetId: homepageTarget.id,
      kind: "markdown",
      content: homepageScrape.markdown,
      meta: { source: "firecrawl", variant: "desktop" },
    });

    // Upload desktop screenshot now (so homepage doesn't get re-scraped later).
    if (homepageScrape.screenshotUrl) {
      const { bytes, contentType } = await downloadBytes(homepageScrape.screenshotUrl);
      const mt = normalizeImageMediaType(contentType);
      const storagePath = `audits/${params.auditRunId}/${homepageTarget.id}_desktop.${extFor(mt)}`;
      await uploadAuditArtifact({ bucket, path: storagePath, bytes, contentType });
      await insertArtifact({
        auditRunId: params.auditRunId,
        auditTargetId: homepageTarget.id,
        kind: "screenshot_desktop",
        storagePath,
        meta: { source: "firecrawl", fullPage: true, contentType, viewport: { width: 1440, height: 900 } },
      });
    }

    // Mobile screenshot for homepage.
    const homepageMobile = await firecrawlScrape({
      url: params.url,
      mobile: true,
      viewport: { width: 390, height: 844 },
    });
    if (homepageMobile.screenshotUrl) {
      const { bytes, contentType } = await downloadBytes(homepageMobile.screenshotUrl);
      const mt = normalizeImageMediaType(contentType);
      const storagePath = `audits/${params.auditRunId}/${homepageTarget.id}_mobile.${extFor(mt)}`;
      await uploadAuditArtifact({ bucket, path: storagePath, bytes, contentType });
      await insertArtifact({
        auditRunId: params.auditRunId,
        auditTargetId: homepageTarget.id,
        kind: "screenshot_mobile",
        storagePath,
        meta: { source: "firecrawl", fullPage: true, contentType, viewport: { width: 390, height: 844 } },
      });
    }

    // Mark homepage done so captureTarget skips it on retry.
    await updateAuditTarget({ id: homepageTarget.id, status: "done" });

    const evidence = buildEvidencePack({ html: homepageScrape.html, baseUrl: params.url });

    const discovery = await discoverTargets({
      baseUrl: params.url,
      evidence,
      homepageScrapeId: homepageScrape.scrapeId,
    });

    if (discovery.pricing) {
      await insertAuditTarget({
        auditRunId: params.auditRunId,
        role: "pricing",
        url: discovery.pricing.url,
        normalizedUrl: discovery.pricing.url,
      });
    }
    if (discovery.signup) {
      await insertAuditTarget({
        auditRunId: params.auditRunId,
        role: "signup",
        url: discovery.signup.url,
        normalizedUrl: discovery.signup.url,
      });
    }

    targets = await listAuditTargets(params.auditRunId);
  }

  // If the previous run ended up with only a homepage target (even if it's already done),
  // rerun discovery using the stored homepage HTML (no additional Firecrawl credits).
  if (targets.length === 1 && targets[0]?.role === "homepage") {
    const homepage = targets[0]!;
    const sb = supabaseAdmin();
    const { data: htmlRows, error: htmlErr } = await sb
      .from("audit_artifacts")
      .select("content")
      .eq("audit_target_id", homepage.id)
      .eq("kind", "html")
      .order("created_at", { ascending: false })
      .limit(1);
    if (htmlErr) throw htmlErr;

    const html = ((htmlRows as Array<{ content: string | null }> | null)?.[0]?.content) ?? "";
    const evidence = buildEvidencePack({ html, baseUrl: homepage.url });

    const discovery = await discoverTargets({
      baseUrl: homepage.url,
      evidence,
      homepageScrapeId: null,
    });

    if (discovery.pricing) {
      await insertAuditTarget({
        auditRunId: params.auditRunId,
        role: "pricing",
        url: discovery.pricing.url,
        normalizedUrl: discovery.pricing.url,
      });
    }
    if (discovery.signup) {
      await insertAuditTarget({
        auditRunId: params.auditRunId,
        role: "signup",
        url: discovery.signup.url,
        normalizedUrl: discovery.signup.url,
      });
    }

    targets = await listAuditTargets(params.auditRunId);
  }

  // Stage: capture remaining targets (homepage is already done).
  await updateAuditRun({ id: params.auditRunId, siteSummary: stagePatch("capture") });

  const captured: CapturedTarget[] = [];
  for (const target of targets) {
    if (target.status === "failed" || target.status === "skipped") {
      continue;
    }

    if (target.status === "done") {
      const sb = supabaseAdmin();
      const { data: htmlRows } = await sb
        .from("audit_artifacts")
        .select("content")
        .eq("audit_target_id", target.id)
        .eq("kind", "html")
        .order("created_at", { ascending: false })
        .limit(1);
      const html = ((htmlRows as Array<{ content: string | null }> | null)?.[0]?.content) ?? "";
      const evidence = buildEvidencePack({ html, baseUrl: target.url });

      const shots = await loadExistingScreenshots({ targetId: target.id, auditRunId: params.auditRunId, bucket });

      captured.push({
        targetId: target.id,
        role: target.role as AuditTargetRole,
        url: target.url,
        html,
        evidence,
        ...shots,
      });
      continue;
    }

    try {
      const result = await captureTarget({
        auditRunId: params.auditRunId,
        targetId: target.id,
        role: target.role as AuditTargetRole,
        url: target.url,
        bucket,
      });
      captured.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Capture failed";
      await updateAuditTarget({ id: target.id, status: "failed", error: msg });
    }
  }

  // Pricing extraction for pricing target.
  const pricingTarget = captured.find((t) => t.role === "pricing");
  if (pricingTarget) {
    pricingTarget.evidence.plg.pricingSummary = extractPricingSummary({
      baseUrl: pricingTarget.url,
      pricingUrlCandidates: [pricingTarget.url],
      pricingHtml: pricingTarget.html,
    });
  }

  // Stage: analysis — delete stale findings first (idempotent on retry).
  await updateAuditRun({ id: params.auditRunId, siteSummary: stagePatch("analysis") });
  const sb = supabaseAdmin();
  const { error: delErr } = await sb.from("audit_findings").delete().eq("audit_run_id", params.auditRunId);
  if (delErr) throw delErr;

  for (const t of captured) {
    const heuristic = runHeuristicCroChecks(t.evidence);
    await insertFinding({
      auditRunId: params.auditRunId,
      auditTargetId: t.targetId,
      source: "heuristic",
      summary: `Heuristic checks: ${t.role}`,
      findingsJson: heuristic,
      meta: { evidence: t.evidence, role: t.role },
    });
  }

  const pageEvidences: PageEvidence[] = captured.map((t) => ({
    role: t.role,
    url: t.url,
    evidence: t.evidence,
  }));
  const crossPage = runCrossPageChecks(pageEvidences);
  if (crossPage.length > 0) {
    await insertFinding({
      auditRunId: params.auditRunId,
      source: "heuristic",
      summary: "Cross-page consistency checks",
      findingsJson: crossPage,
      meta: { role: "cross_page", roles: captured.map((t) => t.role) },
    });
  }

  // Stage: Claude vision
  if (process.env.ANTHROPIC_API_KEY) {
    await updateAuditRun({ id: params.auditRunId, siteSummary: stagePatch("claude") });

    const homepageCaptured = captured.find((t) => t.role === "homepage");
    const evidence = homepageCaptured?.evidence ?? captured[0]?.evidence;
    if (!evidence) return;

    const siteSummary = await inferSaaSSiteSummary({ evidence });
    await updateAuditRun({
      id: params.auditRunId,
      siteSummary: {
        ...siteSummary,
        ...stagePatch("claude"),
        targets: captured.map((t) => ({ role: t.role, url: t.url })),
      },
    });

    const primary = homepageCaptured ?? captured[0];
    if (primary) {
      const desktopVision = primary.desktopShotBytes ? await resizeForVision(primary.desktopShotBytes) : null;
      const mobileVision = primary.mobileShotBytes ? await resizeForVision(primary.mobileShotBytes) : null;

      const llm = await generateGroundedRecommendations({
        evidence: primary.evidence,
        siteSummary,
        screenshots: {
          desktop: desktopVision ?? undefined,
          mobile: mobileVision ?? undefined,
        },
      });

      await insertFinding({
        auditRunId: params.auditRunId,
        source: "llm",
        summary: "Claude vision grounded recommendations",
        findingsJson: llm.recommendations,
        meta: { role: "site", siteSummary, roles: captured.map((t) => t.role) },
      });
    }
  }
}
