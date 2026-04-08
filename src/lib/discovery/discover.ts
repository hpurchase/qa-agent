import type { EvidencePack } from "@/lib/cro/evidence";
import {
  extractCandidatesFromEvidence,
  scoreCandidatesFromMapUrls,
  pickBestCandidate,
  type DiscoveredCandidate,
} from "@/lib/discovery/candidates";
import { firecrawlMap, firecrawlInteract, firecrawlInteractStop } from "@/lib/firecrawl";

export type DiscoveryResult = {
  pricing: DiscoveredCandidate | null;
  signup: DiscoveredCandidate | null;
  allCandidates: DiscoveredCandidate[];
};

const SIGNUP_PROBE_PATHS = ["/signup", "/sign-up", "/register", "/login", "/start"];

async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.ok;
  } catch {
    return false;
  }
}

function rootDomain(hostname: string): string {
  const parts = hostname.split(".");
  return parts.slice(-2).join(".");
}

async function probeSubdomainSignup(baseUrl: string): Promise<DiscoveredCandidate | null> {
  const base = new URL(baseUrl);
  const root = rootDomain(base.hostname);
  const subdomains = [`app.${root}`, `dashboard.${root}`];

  for (const subdomain of subdomains) {
    for (const path of SIGNUP_PROBE_PATHS) {
      const candidate = `https://${subdomain}${path}`;
      if (await probeUrl(candidate)) {
        return { url: candidate, role: "signup", confidence: "medium", source: "href_pattern" };
      }
    }
    // Also try the bare subdomain root.
    const bare = `https://${subdomain}`;
    if (await probeUrl(bare)) {
      return { url: bare, role: "signup", confidence: "low", source: "href_pattern" };
    }
  }

  // Also probe same-domain signup paths.
  for (const path of SIGNUP_PROBE_PATHS) {
    const candidate = `${base.origin}${path}`;
    if (await probeUrl(candidate)) {
      return { url: candidate, role: "signup", confidence: "medium", source: "href_pattern" };
    }
  }

  return null;
}

export async function discoverTargets(params: {
  baseUrl: string;
  evidence: EvidencePack;
  homepageScrapeId: string | null;
}): Promise<DiscoveryResult> {
  const all: DiscoveredCandidate[] = [];

  // Step A: extract from homepage evidence (free).
  const fromEvidence = extractCandidatesFromEvidence(params.evidence, params.baseUrl);
  all.push(...fromEvidence);

  let pricing = pickBestCandidate(all, "pricing");
  let signup = pickBestCandidate(all, "signup");

  // Step B: if missing, use Firecrawl map (bounded, 1 credit).
  if (!pricing || !signup) {
    try {
      const urls = await firecrawlMap({ url: params.baseUrl, limit: 100, includeSubdomains: true });
      const fromMap = scoreCandidatesFromMapUrls(urls, params.baseUrl);
      all.push(...fromMap);

      if (!pricing) pricing = pickBestCandidate(all, "pricing");
      if (!signup) signup = pickBestCandidate(all, "signup");
    } catch {
      // Map failure is non-fatal.
    }
  }

  // Step C: if signup still missing, probe common subdomain + path combinations (free HTTP HEAD).
  if (!signup) {
    const probed = await probeSubdomainSignup(params.baseUrl);
    if (probed) {
      all.push(probed);
      signup = probed;
    }
  }

  // Step D: if signup still missing and we have a scrapeId, use Interact (last resort).
  if (!signup && params.homepageScrapeId) {
    try {
      const result = await firecrawlInteract({
        scrapeId: params.homepageScrapeId,
        prompt:
          "Find and click the primary Sign up, Start free trial, or Get started button. Do not submit any forms. Return the URL of the page you land on.",
      });

      const resultNorm = result.url?.replace(/\/+$/, "").toLowerCase();
      const baseNorm = params.baseUrl.replace(/\/+$/, "").toLowerCase();
      if (resultNorm && resultNorm !== baseNorm) {
        const candidate: DiscoveredCandidate = {
          url: result.url!,
          role: "signup",
          confidence: "medium",
          source: "interact",
        };
        all.push(candidate);
        signup = candidate;
      }

      await firecrawlInteractStop(params.homepageScrapeId);
    } catch {
      // Interact failure is non-fatal.
    }
  }

  return { pricing, signup, allCandidates: all };
}
