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

export async function discoverTargets(params: {
  baseUrl: string;
  evidence: EvidencePack;
  homepageScrapeId: string | null;
}): Promise<DiscoveryResult> {
  const all: DiscoveredCandidate[] = [];

  // Step A: extract from homepage evidence (free — already scraped).
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
      // Map failure is non-fatal; continue with what we have.
    }
  }

  // Step C: if signup still missing and we have a scrapeId, use Interact.
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
