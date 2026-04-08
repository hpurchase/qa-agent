import * as cheerio from "cheerio";
import type { EvidencePack } from "@/lib/cro/evidence";
import type { Element } from "domhandler";

function textOf($: cheerio.CheerioAPI, el: Element) {
  return $(el).text().replace(/\s+/g, " ").trim();
}

function pickBestPricingUrl(baseUrl: string, candidates: string[]): string | null {
  const base = new URL(baseUrl);
  const sameDomain = candidates.filter((c) => {
    try {
      const u = new URL(c);
      return u.hostname === base.hostname;
    } catch {
      return false;
    }
  });

  const sorted = sameDomain
    .map((u) => new URL(u))
    .sort((a, b) => {
      const aScore = (a.pathname.includes("pricing") ? -10 : 0) + a.pathname.length;
      const bScore = (b.pathname.includes("pricing") ? -10 : 0) + b.pathname.length;
      return aScore - bScore;
    });

  return sorted[0]?.toString() ?? null;
}

export function extractPricingSummary(params: {
  baseUrl: string;
  pricingUrlCandidates: string[];
  pricingHtml: string;
}): EvidencePack["plg"]["pricingSummary"] {
  const pricingUrl = pickBestPricingUrl(params.baseUrl, params.pricingUrlCandidates);
  if (!pricingUrl) return null;

  const $ = cheerio.load(params.pricingHtml);

  // Heuristic: plans are often in repeated cards; find elements with a price-ish token.
  const priceRegex = /\$|€|£|\bper\s+(month|mo|year|yr)\b|\b\/(mo|month|yr|year)\b/i;

  const planEls = $("body *")
    .toArray()
    .filter((el) => priceRegex.test(textOf($, el)));

  const plans: Array<{
    name: string;
    priceText: string | null;
    billingPeriod: string | null;
    isMostPopular: boolean;
    topFeatures: string[];
  }> = [];

  for (const el of planEls.slice(0, 40)) {
    const $el = $(el);
    const container = $el.closest("section, article, div");
    const chunkText = container.text().replace(/\s+/g, " ").trim();
    if (chunkText.length < 30 || chunkText.length > 2000) continue;

    const lines = chunkText.split(" ").slice(0, 200).join(" ");
    const isMostPopular = /most popular|recommended|best value/i.test(lines);

    // Guess plan name: nearest heading.
    const name =
      container.find("h3, h2, h4").first().text().replace(/\s+/g, " ").trim() ||
      "Plan";

    // Guess price line: first match.
    const priceTextMatch =
      chunkText.match(/(\$|€|£)\s?\d+[^\n]{0,30}/)?.[0] ??
      chunkText.match(/\b\d+\s?(\/(mo|month|yr|year)|per\s+(month|year))\b/i)?.[0] ??
      null;

    const billingPeriod =
      chunkText.match(/\b(per\s+month|\/mo|\/month)\b/i)?.[0] ??
      chunkText.match(/\b(per\s+year|\/yr|\/year|annual)\b/i)?.[0] ??
      null;

    const topFeatures = container
      .find("li")
      .map((_, li) => textOf($, li))
      .get()
      .filter(Boolean)
      .slice(0, 8);

    plans.push({
      name,
      priceText: priceTextMatch,
      billingPeriod,
      isMostPopular,
      topFeatures,
    });

    if (plans.length >= 6) break;
  }

  // Deduplicate by plan name.
  const seen = new Set<string>();
  const deduped = plans.filter((p) => {
    const k = p.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { sourceUrl: pricingUrl, plans: deduped.slice(0, 4) };
}

