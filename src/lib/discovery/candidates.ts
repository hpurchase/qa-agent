import type { EvidencePack } from "@/lib/cro/evidence";
import type { AuditTargetRole } from "@/lib/db/types";

export type DiscoveredCandidate = {
  url: string;
  role: AuditTargetRole;
  confidence: "high" | "medium" | "low";
  source: "nav" | "cta" | "href_pattern" | "map" | "interact";
};

const PRICING_LABELS = /pricing|plans|billing|cost|compare/i;
const PRICING_PATHS = /\/(pricing|plans|billing|compare)/i;

const SIGNUP_LABELS = /sign\s?up|signup|start\s?(free\s)?trial|free\s?trial|get\s?started|register|create\s?account|start\s?now/i;
const SIGNUP_PATHS = /\/(signup|sign-up|register|start-trial|trial|get-started|onboarding|create-account)/i;

function rootDomain(hostname: string): string {
  const parts = hostname.split(".");
  return parts.slice(-2).join(".");
}

function isSameSite(base: string, candidate: string): boolean {
  try {
    const bHost = new URL(base).hostname;
    const cHost = new URL(candidate).hostname;
    return rootDomain(bHost) === rootDomain(cHost);
  } catch {
    return false;
  }
}

export function extractCandidatesFromEvidence(
  evidence: EvidencePack,
  baseUrl: string,
): DiscoveredCandidate[] {
  const candidates: DiscoveredCandidate[] = [];
  const seen = new Set<string>();

  function add(url: string, role: AuditTargetRole, confidence: DiscoveredCandidate["confidence"], source: DiscoveredCandidate["source"]) {
    const normalized = url.split("#")[0]?.split("?")[0] ?? url;
    if (seen.has(normalized) || !isSameSite(baseUrl, normalized)) return;
    seen.add(normalized);
    candidates.push({ url: normalized, role, confidence, source });
  }

  for (const cta of evidence.ctas) {
    if (!cta.href) continue;
    const label = cta.label.toLowerCase();
    const href = cta.href.toLowerCase();

    if (PRICING_LABELS.test(label) || PRICING_PATHS.test(href)) {
      add(cta.href, "pricing", "high", cta.locationHint === "nav" ? "nav" : "cta");
    }
    if (SIGNUP_LABELS.test(label) || SIGNUP_PATHS.test(href)) {
      add(cta.href, "signup", "high", cta.locationHint === "nav" ? "nav" : "cta");
    }
  }

  for (const href of evidence.plg.pricingLinkHrefs) {
    add(href, "pricing", "medium", "href_pattern");
  }
  for (const href of evidence.plg.signupLinkHrefs) {
    add(href, "signup", "medium", "href_pattern");
  }

  for (const navLabel of evidence.navLabels) {
    if (PRICING_LABELS.test(navLabel)) {
      const match = evidence.ctas.find(
        (c) => c.href && c.label.toLowerCase() === navLabel.toLowerCase(),
      );
      if (match?.href) add(match.href, "pricing", "high", "nav");
    }
    if (SIGNUP_LABELS.test(navLabel)) {
      const match = evidence.ctas.find(
        (c) => c.href && c.label.toLowerCase() === navLabel.toLowerCase(),
      );
      if (match?.href) add(match.href, "signup", "high", "nav");
    }
  }

  return candidates;
}

export function scoreCandidatesFromMapUrls(
  urls: string[],
  baseUrl: string,
): DiscoveredCandidate[] {
  const candidates: DiscoveredCandidate[] = [];

  for (const url of urls) {
    try {
      if (!isSameSite(baseUrl, url)) continue;
      const path = new URL(url).pathname.toLowerCase();

      if (PRICING_PATHS.test(path)) {
        candidates.push({ url, role: "pricing", confidence: "medium", source: "map" });
      }
      if (SIGNUP_PATHS.test(path)) {
        candidates.push({ url, role: "signup", confidence: "medium", source: "map" });
      }
    } catch {
      // Skip malformed URLs from map results.
    }
  }

  return candidates;
}

export function pickBestCandidate(
  candidates: DiscoveredCandidate[],
  role: AuditTargetRole,
): DiscoveredCandidate | null {
  const matching = candidates
    .filter((c) => c.role === role)
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.confidence] - order[b.confidence];
    });
  return matching[0] ?? null;
}
