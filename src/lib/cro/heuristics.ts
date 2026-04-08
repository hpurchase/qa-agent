import type { EvidencePack } from "@/lib/cro/evidence";

export type CroFinding = {
  id: string;
  severity: "low" | "med" | "high";
  title: string;
  recommendation: string;
  whyItMatters: string;
  evidence: Record<string, unknown>;
  howToTest: string;
};

function uniqByLower(xs: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

const NOISE_CTA = /^(skip|open|close|menu|toggle|×|x|→|←|↓|↑|\d+|0)$/i;
const NOISE_PREFIX = /^(skip to|open menu|close menu)/i;
const PRIMARY_CTA = /trial|sign\s?up|signup|get\s?started|start\s?now|start\s?free|create\s?account|register/i;
const WAITLIST_CTA = /waitlist|early access|rsvp|notify|coming soon|join.*list/i;
const SALES_CTA = /request.*demo|book.*demo|book.*call|talk.*sales|contact.*sales|schedule.*demo/i;

function isRealCta(label: string): boolean {
  const t = label.trim();
  if (t.length < 3 || t.length > 50) return false;
  if (NOISE_CTA.test(t) || NOISE_PREFIX.test(t)) return false;
  return true;
}

function q(s: string) {
  return `"${s}"`;
}

export function runHeuristicCroChecks(e: EvidencePack): CroFinding[] {
  const findings: CroFinding[] = [];

  const realCtas = e.ctas.filter((c) => isRealCta(c.label));
  const primaryCtas = realCtas.filter((c) => PRIMARY_CTA.test(c.label));
  const waitlistCtas = realCtas.filter((c) => WAITLIST_CTA.test(c.label));
  const salesCtas = realCtas.filter((c) => SALES_CTA.test(c.label));

  const isPreLaunch = waitlistCtas.length > 0 || /coming soon|beta|early access|waitlist|launching/i.test(
    [...e.headings.h1, ...e.headings.h2].join(" "),
  );
  const isLive = primaryCtas.length > 0 || e.plg.signupLinkHrefs.length > 0;

  // --- FORM FRICTION (objective, high impact) ---
  const longForms = e.forms.filter((f) => f.fields >= 5);
  if (longForms.length > 0) {
    const worst = longForms.sort((a, b) => b.fields - a.fields)[0];
    const fieldList = worst.labels.length > 0
      ? worst.labels.slice(0, 5).map(q).join(", ")
      : `${worst.fields} input fields`;
    findings.push({
      id: "high_form_friction",
      severity: "high",
      title: `Signup form has ${worst.fields} fields — reduce to 1-3`,
      recommendation: `Found a form with ${worst.fields} fields (${fieldList}). Best-in-class PLG signup uses email-only or email + password. Move everything else to post-signup onboarding.`,
      whyItMatters: `Each additional form field drops completion rate by ~10-15%. A ${worst.fields}-field form likely loses 40%+ of potential signups.`,
      evidence: { fieldCount: worst.fields, labels: worst.labels, hasPassword: worst.hasPassword },
      howToTest: "A/B test: current form vs email-only signup. Track form completion rate and 7-day activation.",
    });
  }

  // --- SALES-LED MISMATCH (objective — page has demo but no trial) ---
  if (!isPreLaunch && salesCtas.length > 0 && primaryCtas.length === 0) {
    const salesLabels = uniqByLower(salesCtas.map((c) => c.label));
    findings.push({
      id: "sales_led_no_selfserve",
      severity: "high",
      title: `Only sales CTAs found: ${salesLabels.slice(0, 3).map(q).join(", ")} — no self-serve option`,
      recommendation: `The page has ${salesLabels.length} sales-oriented CTA(s) (${salesLabels.map(q).join(", ")}) but zero self-serve signup/trial options. Add a "Start free trial" button alongside the demo CTA to capture PLG-intent visitors.`,
      whyItMatters: "~60% of SaaS buyers prefer to try before talking to sales. Without a self-serve path, you lose them to competitors that offer one.",
      evidence: { salesLabels, primaryCtaCount: 0, signupLinks: e.plg.signupLinkHrefs.length },
      howToTest: "Add a free trial CTA next to the demo CTA. Measure: trial starts vs demo requests, and which converts to paid faster.",
    });
  }

  // --- CTA LABEL INCONSISTENCY (objective — count and list the variants) ---
  if (isLive) {
    const primaryLabels = uniqByLower(primaryCtas.map((c) => c.label));
    if (primaryLabels.length >= 3) {
      findings.push({
        id: "cta_inconsistency",
        severity: "med",
        title: `${primaryLabels.length} different signup CTA labels: ${primaryLabels.slice(0, 4).map(q).join(", ")}`,
        recommendation: `The page uses ${primaryLabels.length} different labels for the same action: ${primaryLabels.map(q).join(", ")}. Pick one (recommend ${q(primaryLabels[0])}) and use it everywhere — hero, nav, pricing table, sticky header.`,
        whyItMatters: "Inconsistent CTA labels make visitors second-guess whether each button does the same thing. Consistency increases click-through.",
        evidence: { labels: primaryLabels, locations: primaryCtas.map((c) => ({ label: c.label, location: c.locationHint })) },
        howToTest: "Unify all signup CTAs to one label. Measure: overall CTA CTR and homepage-to-signup conversion.",
      });
    }
  }

  // --- PRICING VISIBILITY (objective — check nav + page links) ---
  const hasPricingNav = e.navLabels.some((l) => /pricing|plans/i.test(l));
  const hasPricingLinks = e.plg.pricingLinkHrefs.length > 0;
  if (!hasPricingNav && !hasPricingLinks && !isPreLaunch) {
    findings.push({
      id: "no_pricing",
      severity: "med",
      title: "No pricing link found in navigation or page body",
      recommendation: `Checked ${e.navLabels.length} nav items (${e.navLabels.slice(0, 6).map(q).join(", ")}) and ${e.ctas.length} page links — none point to pricing. Add a "Pricing" link in the main nav.`,
      whyItMatters: "PLG buyers evaluate pricing early. If they can't find it, they assume it's expensive or enterprise-only and leave.",
      evidence: { navLabels: e.navLabels.slice(0, 15), pricingLinksFound: 0 },
      howToTest: "Add a Pricing nav link. Track: pricing page visits, and pricing→signup conversion.",
    });
  }

  // --- PRICING TABLE QUALITY (if we have pricing data) ---
  const ps = e.plg.pricingSummary;
  if (ps && ps.plans.length > 0) {
    const missingPrices = ps.plans.filter((p) => !p.priceText);
    if (missingPrices.length > 0) {
      findings.push({
        id: "pricing_unclear",
        severity: "med",
        title: `${missingPrices.length} of ${ps.plans.length} pricing plans have no visible price`,
        recommendation: `Plans without clear pricing: ${missingPrices.map((p) => q(p.name)).join(", ")}. Show exact prices for all plans. "Contact us" pricing signals enterprise and scares away SMB/PLG buyers.`,
        whyItMatters: "Transparent pricing builds trust and lets visitors self-qualify. Hidden pricing increases bounce.",
        evidence: { plans: ps.plans.map((p) => ({ name: p.name, price: p.priceText })) },
        howToTest: "Show prices for all plans. Measure: pricing page bounce rate and plan selection rate.",
      });
    }

    const noneRecommended = ps.plans.every((p) => !p.isMostPopular);
    if (noneRecommended && ps.plans.length >= 2) {
      findings.push({
        id: "no_recommended_plan",
        severity: "low",
        title: `${ps.plans.length} plans shown but none highlighted as recommended`,
        recommendation: `Plans: ${ps.plans.map((p) => q(p.name)).join(", ")}. Highlight one as "Most Popular" or "Recommended" to reduce decision paralysis.`,
        whyItMatters: "A recommended plan acts as an anchor and increases conversion by 15-25% vs equal-weight options.",
        evidence: { planNames: ps.plans.map((p) => p.name) },
        howToTest: "Add a 'Most Popular' badge to one plan. Measure: plan selection distribution and overall signup rate.",
      });
    }
  }

  // --- TRUST SIGNALS (objective presence check) ---
  if (!e.trustSignals.hasTestimonials && !e.trustSignals.hasLogoStrip && !isPreLaunch) {
    findings.push({
      id: "no_social_proof",
      severity: "low",
      title: "No customer logos, testimonials, or case studies detected",
      recommendation: "Add social proof: customer logos, a testimonial quote, or a case study stat (e.g. '2,000+ teams use [product]'). Place it below the hero section.",
      whyItMatters: "Social proof is the #1 trust builder for unknown SaaS brands. Without it, visitors rely solely on your copy.",
      evidence: { hasTestimonials: false, hasLogoStrip: false, mentionsSOC2: e.trustSignals.mentionsSOC2, mentionsGDPR: e.trustSignals.mentionsGDPR },
      howToTest: "Add a logo strip below the hero. Measure: scroll depth past the hero and CTA CTR.",
    });
  }

  return findings;
}
