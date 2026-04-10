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

  // --- MISSING OR MULTIPLE H1 (SEO + messaging clarity) ---
  if (e.headings.h1.length === 0) {
    findings.push({
      id: "missing_h1",
      severity: "high",
      title: "No H1 heading found on the page",
      recommendation: "Every landing page needs exactly one H1 that clearly states the product's value proposition. Add an H1 to the hero section that answers 'What does this product do for me?'",
      whyItMatters: "The H1 is the first thing both visitors and search engines read. Without one, visitors lack a clear anchor for what your product does.",
      evidence: { h1Count: 0, h2Count: e.headings.h2.length },
      howToTest: "Add a clear, benefit-oriented H1. Measure: bounce rate and time on page.",
    });
  } else if (e.headings.h1.length > 1) {
    findings.push({
      id: "multiple_h1",
      severity: "low",
      title: `${e.headings.h1.length} H1 headings found — should be exactly 1`,
      recommendation: `Found ${e.headings.h1.length} H1s: ${e.headings.h1.slice(0, 3).map(q).join(", ")}. Use one H1 for the main value prop, change the rest to H2s.`,
      whyItMatters: "Multiple H1s dilute both the page's message hierarchy and SEO signal.",
      evidence: { h1s: e.headings.h1.slice(0, 5) },
      howToTest: "Reduce to one H1. Measure: organic traffic changes after 2 weeks.",
    });
  }

  // --- WEAK VALUE PROP (H1 too long or too vague) ---
  if (e.headings.h1.length === 1) {
    const h1 = e.headings.h1[0];
    const wordCount = h1.split(/\s+/).length;
    if (wordCount > 15) {
      findings.push({
        id: "h1_too_long",
        severity: "med",
        title: `H1 is ${wordCount} words long — too wordy to scan`,
        recommendation: `Your H1 is: ${q(h1)}. Shorten it to under 10 words. A good H1 communicates the core benefit in the time it takes to glance at the page (~3 seconds).`,
        whyItMatters: "Visitors decide within 5 seconds if a page is relevant. A long H1 doesn't get read — it gets skipped.",
        evidence: { h1, wordCount },
        howToTest: "A/B test: current H1 vs a shorter, benefit-focused version. Measure: scroll depth and CTA clicks.",
      });
    } else if (wordCount <= 2 && !/\w/.test(h1)) {
      findings.push({
        id: "h1_too_short",
        severity: "med",
        title: "H1 is too short to communicate value",
        recommendation: `Your H1 is: ${q(h1)}. This doesn't tell visitors what your product does or why they should care. Write an H1 that includes the benefit and the target audience.`,
        whyItMatters: "A vague or brand-only H1 forces visitors to hunt for what the product actually does, increasing bounce.",
        evidence: { h1, wordCount },
        howToTest: "Replace with a benefit-oriented H1. Measure: bounce rate and scroll depth.",
      });
    }
  }

  // --- NO ABOVE-THE-FOLD CTA ---
  if (isLive && !isPreLaunch) {
    const heroCtas = realCtas.filter((c) => c.locationHint === "hero" || c.locationHint === "nav");
    const primaryInHero = heroCtas.filter((c) => PRIMARY_CTA.test(c.label));
    if (primaryInHero.length === 0 && primaryCtas.length > 0) {
      findings.push({
        id: "no_hero_cta",
        severity: "high",
        title: "Primary signup CTA is not in the hero section or navigation",
        recommendation: `Found ${primaryCtas.length} signup CTA(s) but none in the hero or nav area. The primary CTA (${q(primaryCtas[0].label)}) should be visible without scrolling — place it in the hero section and/or sticky nav.`,
        whyItMatters: "If visitors have to scroll to find the signup button, 30-50% will leave before seeing it. Above-the-fold CTAs convert 2-3x better.",
        evidence: { primaryCtaLocations: primaryCtas.slice(0, 5).map((c) => ({ label: c.label, location: c.locationHint })) },
        howToTest: "Move the primary CTA into the hero section. Measure: CTA visibility (scroll depth) and click-through rate.",
      });
    }
  }

  // --- MISSING META DESCRIPTION (SEO) ---
  if (!e.metaDescription) {
    findings.push({
      id: "missing_meta_description",
      severity: "low",
      title: "No meta description found",
      recommendation: "Add a meta description (150-160 characters) that summarizes what your product does and includes a call-to-action. This appears in Google search results and affects click-through rate.",
      whyItMatters: "Pages without a meta description let Google auto-generate one from page content, which is often incoherent and hurts CTR from search.",
      evidence: { metaDescription: null, title: e.title },
      howToTest: "Add a meta description. Monitor: Google Search Console CTR for branded queries.",
    });
  }

  // --- NO FREE TRIAL REASSURANCE ---
  if (isLive && !isPreLaunch && primaryCtas.length > 0) {
    const hasReassurance = e.plg.mentionsNoCreditCard || e.plg.mentionsFreeForever || e.plg.mentionsCancelAnytime;
    if (!hasReassurance) {
      findings.push({
        id: "no_reassurance",
        severity: "med",
        title: "No reassurance copy found near signup CTAs",
        recommendation: `Your page has signup CTAs but doesn't mention "no credit card required", "free forever", or "cancel anytime". Add reassurance text directly below or next to the primary CTA.`,
        whyItMatters: "Reassurance copy addresses the #1 signup objection ('will I be charged?'). Adding it typically lifts form starts by 10-30%.",
        evidence: { mentionsNoCreditCard: false, mentionsFreeForever: false, mentionsCancelAnytime: false },
        howToTest: "Add 'No credit card required' below your hero CTA. Measure: CTA click-through rate.",
      });
    }
  }

  // --- TOO MANY NAV ITEMS (cognitive overload) ---
  const meaningfulNav = e.navLabels.filter((l) => l.length > 1 && l.length < 30);
  if (meaningfulNav.length > 8) {
    findings.push({
      id: "nav_overload",
      severity: "low",
      title: `${meaningfulNav.length} navigation items — consider simplifying`,
      recommendation: `Found ${meaningfulNav.length} nav items: ${meaningfulNav.slice(0, 8).map(q).join(", ")}${meaningfulNav.length > 8 ? "…" : ""}. Best-practice SaaS navs have 5-7 items. Group secondary items under a dropdown or move to the footer.`,
      whyItMatters: "Too many nav choices create decision paralysis. Hick's Law: decision time increases logarithmically with the number of options.",
      evidence: { navCount: meaningfulNav.length, labels: meaningfulNav.slice(0, 15) },
      howToTest: "Reduce nav to 5-7 core items. Measure: nav click distribution and homepage-to-signup conversion.",
    });
  }

  // --- MIXED CONVERSION MOTIONS (confusing — both trial AND demo, no clear primary) ---
  if (!isPreLaunch && primaryCtas.length > 0 && salesCtas.length > 0) {
    const primaryInHero = primaryCtas.filter((c) => c.locationHint === "hero");
    const salesInHero = salesCtas.filter((c) => c.locationHint === "hero");
    if (primaryInHero.length > 0 && salesInHero.length > 0) {
      findings.push({
        id: "mixed_motions_hero",
        severity: "med",
        title: "Hero section has both self-serve and sales CTAs competing",
        recommendation: `The hero area has both ${q(primaryInHero[0].label)} and ${q(salesInHero[0].label)}. Pick a primary motion and make the secondary one visually subordinate (e.g., text link vs button).`,
        whyItMatters: "Two equal-weight CTAs in the hero split attention and reduce overall click-through. Users freeze when asked to choose.",
        evidence: { heroPrimary: primaryInHero.map((c) => c.label), heroSales: salesInHero.map((c) => c.label) },
        howToTest: "Make one CTA primary (filled button) and the other secondary (text link). Measure: total hero CTA clicks.",
      });
    }
  }

  return findings;
}
