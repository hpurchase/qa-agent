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

  // --- VALUE PROP CLARITY (dynamic — only fires when we can say something specific) ---
  if (e.headings.h1.length === 1) {
    const h1 = e.headings.h1[0];
    const wordCount = h1.split(/\s+/).length;
    // Detect feature-dump H1s ("AI-powered collaboration platform for remote teams that helps you...")
    const hasBuzzwords = /\b(ai[- ]powered|next[- ]gen|revolutionary|cutting[- ]edge|world[- ]class|enterprise[- ]grade)\b/i.test(h1);
    const benefitWords = /\b(save|reduce|grow|increase|boost|simplify|automate|faster|easier|cheaper)\b/i;
    const hasBenefit = benefitWords.test(h1);

    if (wordCount > 12 && !hasBenefit) {
      findings.push({
        id: "h1_no_benefit",
        severity: "med",
        title: `H1 describes the product but not the benefit: ${q(h1.length > 70 ? h1.slice(0, 67) + "…" : h1)}`,
        recommendation: `Your H1 is ${wordCount} words: ${q(h1)}. It describes what the product IS, not what it DOES for the visitor. Rewrite to lead with the outcome: "Reduce [pain] by X%" or "Get [benefit] in minutes."`,
        whyItMatters: "Visitors care about outcomes, not capabilities. Feature-first H1s require mental work to translate into 'why should I care?'",
        evidence: { h1, wordCount, hasBenefit: false },
        howToTest: "A/B test: current H1 vs outcome-first version. Measure: scroll depth past hero and CTA clicks.",
      });
    } else if (hasBuzzwords && wordCount > 6) {
      const buzzFound = h1.match(/\b(ai[- ]powered|next[- ]gen|revolutionary|cutting[- ]edge|world[- ]class|enterprise[- ]grade)\b/gi) ?? [];
      findings.push({
        id: "h1_buzzword_heavy",
        severity: "low",
        title: `H1 relies on buzzwords (${buzzFound.map(q).join(", ")}) instead of specifics`,
        recommendation: `Your H1 ${q(h1)} uses ${buzzFound.map(q).join(", ")}. Replace buzzwords with concrete specifics: what exactly does it do, for whom, and what result? E.g., "Deploy ML models in 5 minutes" beats "AI-powered deployment platform."`,
        whyItMatters: "Everyone says 'AI-powered' — it means nothing to visitors. Specificity builds credibility and differentiates.",
        evidence: { h1, buzzwords: buzzFound },
        howToTest: "Replace buzzwords with specifics. Measure: bounce rate and signup rate from homepage.",
      });
    }
  }

  // --- CTA PLACEMENT (dynamic — only when we can map the specific CTAs) ---
  if (isLive && !isPreLaunch && primaryCtas.length > 0) {
    const heroCtas = realCtas.filter((c) => c.locationHint === "hero" || c.locationHint === "nav");
    const primaryInHero = heroCtas.filter((c) => PRIMARY_CTA.test(c.label));
    const bodyCtas = primaryCtas.filter((c) => c.locationHint === "body");
    const footerCtas = primaryCtas.filter((c) => c.locationHint === "footer");

    if (primaryInHero.length === 0 && bodyCtas.length > 0) {
      // CTA exists but only in the body — specific about where it is
      const bodyLabels = uniqByLower(bodyCtas.map((c) => c.label));
      findings.push({
        id: "cta_below_fold",
        severity: "high",
        title: `Signup CTA (${bodyLabels.slice(0, 2).map(q).join(", ")}) only appears in the page body, not above the fold`,
        recommendation: `Found ${primaryCtas.length} signup CTA(s) but they're all in the body: ${bodyLabels.map(q).join(", ")}. Duplicate your primary CTA into the hero section. Keep the body CTAs too — visitors who scroll past need another chance.`,
        whyItMatters: "50%+ of visitors never scroll past the first viewport. A CTA only in the body section is invisible to most visitors.",
        evidence: { bodyCtaLabels: bodyLabels, heroCtaCount: primaryInHero.length, totalPrimaryCount: primaryCtas.length },
        howToTest: "Add hero CTA. Measure: total CTA clicks (hero + body) and signup conversion.",
      });
    } else if (primaryInHero.length === 0 && footerCtas.length > 0 && bodyCtas.length === 0) {
      // CTA only in footer — even worse
      findings.push({
        id: "cta_only_footer",
        severity: "high",
        title: `Signup CTA only appears in the footer — most visitors will never see it`,
        recommendation: `The only signup CTA (${q(footerCtas[0].label)}) is in the footer. Move it to the hero section and add repeating CTAs after key content sections (features, testimonials, pricing).`,
        whyItMatters: "Footer CTAs convert 5-10x worse than hero CTAs because only 10-20% of visitors reach the footer.",
        evidence: { footerCtaLabel: footerCtas[0].label, heroCtaCount: 0, bodyCtaCount: 0 },
        howToTest: "Add hero CTA + mid-page CTA. Measure: total signup conversion.",
      });
    }
  }

  // --- REASSURANCE GAP (dynamic — adapts to what type of signup the site has) ---
  if (isLive && !isPreLaunch && primaryCtas.length > 0) {
    const hasReassurance = e.plg.mentionsNoCreditCard || e.plg.mentionsFreeForever || e.plg.mentionsCancelAnytime;
    if (!hasReassurance && e.forms.some((f) => f.hasPassword)) {
      // Site has a signup form with a password field but no reassurance — high confidence this matters
      const formLabels = e.forms.filter((f) => f.hasPassword).flatMap((f) => f.labels);
      findings.push({
        id: "no_reassurance_with_form",
        severity: "med",
        title: `Signup form asks for a password but page has no "free" or "no credit card" messaging`,
        recommendation: `The signup form (fields: ${formLabels.slice(0, 4).map(q).join(", ") || "email + password"}) asks for commitment (password = account creation) but there's no reassurance that it's free or risk-free. Add "No credit card required" or "Free plan available" directly above or below the form.`,
        whyItMatters: "A password field signals 'creating an account' which triggers loss aversion. Reassurance text reduces that friction by 10-30%.",
        evidence: { hasPassword: true, formLabels: formLabels.slice(0, 6), mentionsNoCreditCard: false, mentionsFreeForever: false },
        howToTest: "Add 'No credit card required' below the form submit button. Measure: form start rate and completion rate.",
      });
    }
  }

  // --- MIXED CONVERSION MOTIONS (dynamic — specific about which CTAs conflict) ---
  if (!isPreLaunch && primaryCtas.length > 0 && salesCtas.length > 0) {
    const primaryInHero = primaryCtas.filter((c) => c.locationHint === "hero");
    const salesInHero = salesCtas.filter((c) => c.locationHint === "hero");
    if (primaryInHero.length > 0 && salesInHero.length > 0) {
      findings.push({
        id: "mixed_motions_hero",
        severity: "med",
        title: `Hero has competing CTAs: ${q(primaryInHero[0].label)} vs ${q(salesInHero[0].label)}`,
        recommendation: `The hero area has both ${q(primaryInHero[0].label)} (self-serve) and ${q(salesInHero[0].label)} (sales). Pick your primary motion based on your ICP: if most customers are <50 employees, lead with the trial. Make the secondary one a text link, not a button.`,
        whyItMatters: "Two equal-weight CTAs in the hero split attention. Visitors who can't decide which to click often click neither.",
        evidence: { heroPrimary: primaryInHero.map((c) => c.label), heroSales: salesInHero.map((c) => c.label) },
        howToTest: "Make one CTA visually primary (filled button) and the other secondary (outlined or text link). Measure: total hero CTA clicks.",
      });
    }
  }

  // --- CTA-TO-FORM MISMATCH (dynamic — detects when CTA says "free trial" but form asks for payment info) ---
  if (primaryCtas.length > 0 && e.forms.length > 0) {
    const ctaSaysFree = primaryCtas.some((c) => /free|trial|no.?credit/i.test(c.label));
    const formHasPayment = e.forms.some((f) =>
      f.labels.some((l) => /card|payment|billing|cvv|expir/i.test(l)),
    );
    if (ctaSaysFree && formHasPayment) {
      const freeCta = primaryCtas.find((c) => /free|trial|no.?credit/i.test(c.label));
      const paymentLabels = e.forms.flatMap((f) => f.labels).filter((l) => /card|payment|billing|cvv|expir/i.test(l));
      findings.push({
        id: "cta_form_mismatch",
        severity: "high",
        title: `CTA says ${q(freeCta?.label ?? "free trial")} but the form asks for payment info (${paymentLabels.slice(0, 2).map(q).join(", ")})`,
        recommendation: `Your CTA promises ${q(freeCta?.label ?? "free")} but the signup form includes payment fields: ${paymentLabels.map(q).join(", ")}. This breaks trust. Either remove payment fields from initial signup or change the CTA to be honest about what's required.`,
        whyItMatters: "Bait-and-switch from 'free' to 'enter payment' is the #1 cause of signup abandonment. 60-80% of users drop off at this point.",
        evidence: { ctaLabel: freeCta?.label, paymentFields: paymentLabels },
        howToTest: "Remove payment from initial signup (charge later). Measure: signup completion rate.",
      });
    }
  }

  return findings;
}
