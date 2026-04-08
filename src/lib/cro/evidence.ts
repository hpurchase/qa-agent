import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

export type EvidencePack = {
  title: string | null;
  metaDescription: string | null;
  headings: { h1: string[]; h2: string[] };
  navLabels: string[];
  ctas: Array<{
    label: string;
    href: string | null;
    kind: "button" | "link";
    locationHint: "nav" | "hero" | "body" | "footer" | "unknown";
  }>;
  forms: Array<{ fields: number; labels: string[]; hasPassword: boolean }>;
  trustSignals: {
    hasTestimonials: boolean;
    hasLogoStrip: boolean;
    mentionsSOC2: boolean;
    mentionsGDPR: boolean;
  };
  plg: {
    pricingLinkHrefs: string[];
    pricingSummary?: {
      sourceUrl: string;
      plans: Array<{
        name: string;
        priceText: string | null;
        billingPeriod: string | null;
        isMostPopular: boolean;
        topFeatures: string[];
      }>;
    } | null;
    mentionsNoCreditCard: boolean;
    mentionsFreeForever: boolean;
    mentionsCancelAnytime: boolean;
    signupLinkHrefs: string[];
    demoOnlyCues: boolean;
  };
};

const CTA_VERBS = [
  "start",
  "try",
  "get started",
  "sign up",
  "signup",
  "register",
  "book",
  "request",
  "talk",
  "contact",
  "schedule",
  "join",
  "create",
];

function textOf(el: cheerio.Cheerio<AnyNode>): string {
  return el.text().replace(/\s+/g, " ").trim();
}

function locationHintFor(
  $: cheerio.CheerioAPI,
  el: Element,
): EvidencePack["ctas"][number]["locationHint"] {
  const $el = $(el);
  if ($el.closest("nav").length) return "nav";
  if ($el.closest("footer").length) return "footer";

  // Very rough “hero” heuristic: first screen container-ish elements.
  if ($el.closest("header, [data-hero], .hero, #hero").length) return "hero";
  return "body";
}

export function buildEvidencePack(params: { html: string; baseUrl: string }): EvidencePack {
  const $ = cheerio.load(params.html);

  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? null;

  const h1 = $("h1")
    .map((_, el) => textOf($(el)))
    .get()
    .filter(Boolean);
  const h2 = $("h2")
    .map((_, el) => textOf($(el)))
    .get()
    .filter(Boolean);

  const navLabels = $("nav a, nav button")
    .map((_, el) => textOf($(el)))
    .get()
    .filter(Boolean)
    .slice(0, 50);

  const ctas: EvidencePack["ctas"] = [];

  $("a, button").each((_, el) => {
    const $el = $(el);
    const label = textOf($el);
    if (!label) return;

    const lower = label.toLowerCase();
    const looksLikeCTA = CTA_VERBS.some((v) => lower.includes(v));
    const isButtonish =
      el.tagName === "button" ||
      ($el.attr("role") ?? "").toLowerCase() === "button" ||
      ($el.attr("class") ?? "").toLowerCase().includes("button");

    if (!looksLikeCTA && !isButtonish) return;

    let href: string | null = null;
    if (el.tagName === "a") {
      const raw = $el.attr("href") ?? null;
      try {
        href = raw ? new URL(raw, params.baseUrl).toString() : null;
      } catch {
        href = raw;
      }
    }

    ctas.push({
      label,
      href,
      kind: el.tagName === "button" ? "button" : "link",
      locationHint: locationHintFor($, el as unknown as Element),
    });
  });

  const forms: EvidencePack["forms"] = [];
  $("form").each((_, form) => {
    const $form = $(form);
    const inputs = $form.find("input, select, textarea");
    const labels = $form
      .find("label")
      .map((_, l) => textOf($(l)))
      .get()
      .filter(Boolean);
    const hasPassword = inputs.toArray().some((i) => ($(i).attr("type") ?? "").toLowerCase() === "password");
    forms.push({ fields: inputs.length, labels: labels.slice(0, 30), hasPassword });
  });

  const pageText = $("body").text().replace(/\s+/g, " ").toLowerCase();
  const trustSignals: EvidencePack["trustSignals"] = {
    hasTestimonials: /testimonial|customers say|case study|reviews/.test(pageText),
    hasLogoStrip: /trusted by|customers include|logos? of/.test(pageText),
    mentionsSOC2: /soc\s*2/.test(pageText),
    mentionsGDPR: /gdpr/.test(pageText),
  };

  const pricingLinks = $("a")
    .map((_, a) => {
      const $a = $(a);
      const t = textOf($a).toLowerCase();
      const href = $a.attr("href") ?? "";
      if (!t.includes("pricing") && !href.toLowerCase().includes("pricing")) return null;
      try {
        return new URL(href, params.baseUrl).toString();
      } catch {
        return href || null;
      }
    })
    .get()
    .filter((x): x is string => Boolean(x));

  const signupLinks = $("a")
    .map((_, a) => {
      const $a = $(a);
      const href = $a.attr("href") ?? "";
      const t = textOf($a).toLowerCase();
      const looks =
        /sign\s?up|signup|register|start\s?trial|free\s?trial|get\s?started/.test(t) ||
        /signup|register|start-trial|trial|onboarding/.test(href.toLowerCase());
      if (!looks) return null;
      try {
        return new URL(href, params.baseUrl).toString();
      } catch {
        return href || null;
      }
    })
    .get()
    .filter((x): x is string => Boolean(x));

  const demoOnlyCues = /request a demo|book a demo|talk to sales|contact sales/.test(pageText) && !/free trial|start trial|sign up/.test(pageText);

  return {
    title,
    metaDescription,
    headings: { h1, h2 },
    navLabels,
    ctas: ctas.slice(0, 80),
    forms: forms.slice(0, 10),
    trustSignals,
    plg: {
      pricingLinkHrefs: Array.from(new Set(pricingLinks)).slice(0, 20),
      pricingSummary: null,
      mentionsNoCreditCard: /no credit card|no cc required/.test(pageText),
      mentionsFreeForever: /free forever/.test(pageText),
      mentionsCancelAnytime: /cancel anytime/.test(pageText),
      signupLinkHrefs: Array.from(new Set(signupLinks)).slice(0, 20),
      demoOnlyCues,
    },
  };
}

