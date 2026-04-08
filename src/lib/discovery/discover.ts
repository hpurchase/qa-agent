import type { EvidencePack } from "@/lib/cro/evidence";
import {
  extractCandidatesFromEvidence,
  scoreCandidatesFromMapUrls,
  pickBestCandidate,
  type DiscoveredCandidate,
} from "@/lib/discovery/candidates";
import { firecrawlMap, firecrawlInteractCode, firecrawlInteractStop } from "@/lib/firecrawl";

export type DiscoveryResult = {
  pricing: DiscoveredCandidate | null;
  signup: DiscoveredCandidate | null;
  allCandidates: DiscoveredCandidate[];
};

const SIGNUP_PROBE_PATHS = ["/signup", "/sign-up", "/register", "/login", "/start"];

async function probeUrl(url: string): Promise<boolean> {
  // Some apps reject HEAD (405) or redirect (302) before landing on HTML.
  // We treat any <400 response as "exists" and prefer GET as a fallback.
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "manual" });
    if (head.status > 0 && head.status < 400) return true;
    // If HEAD isn't allowed (or otherwise inconclusive), try a lightweight GET.
    if (head.status === 405 || head.status === 403 || head.status === 0) {
      const get = await fetch(url, { method: "GET", redirect: "manual" });
      return get.status > 0 && get.status < 400;
    }
    return false;
  } catch {
    try {
      const get = await fetch(url, { method: "GET", redirect: "manual" });
      return get.status > 0 && get.status < 400;
    } catch {
      return false;
    }
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

  // Step D: if signup still missing and we have a scrapeId, use Interact code (last resort).
  if (!signup && params.homepageScrapeId) {
    try {
      const code = `
        const links = await page.locator('a').all();
        for (const link of links) {
          const text = (await link.textContent() || '').toLowerCase().trim();
          if (/sign\\s?up|start\\s?(free\\s)?trial|get\\s?started|create\\s?account/.test(text)) {
            const href = await link.getAttribute('href');
            if (href) {
              await link.click();
              await page.waitForTimeout(2000);
              JSON.stringify({ url: page.url() });
              break;
            }
          }
        }
        JSON.stringify({ url: page.url() });
      `;
      const result = await firecrawlInteractCode({
        scrapeId: params.homepageScrapeId,
        code,
      });

      const raw = result.result ?? result.stdout ?? "";
      try {
        const parsed = JSON.parse(raw) as { url?: string };
        const resultNorm = parsed.url?.replace(/\/+$/, "").toLowerCase();
        const baseNorm = params.baseUrl.replace(/\/+$/, "").toLowerCase();
        if (resultNorm && resultNorm !== baseNorm && parsed.url) {
          const candidate: DiscoveredCandidate = {
            url: parsed.url,
            role: "signup",
            confidence: "medium",
            source: "interact",
          };
          all.push(candidate);
          signup = candidate;
        }
      } catch {
        // Parse failure is non-fatal.
      }

      await firecrawlInteractStop(params.homepageScrapeId);
    } catch {
      // Interact failure is non-fatal.
    }
  }

  return { pricing, signup, allCandidates: all };
}
