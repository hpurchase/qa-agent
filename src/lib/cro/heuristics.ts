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
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

export function runHeuristicCroChecks(e: EvidencePack): CroFinding[] {
  const findings: CroFinding[] = [];

  const h1Count = e.headings.h1.length;
  if (h1Count === 0) {
    findings.push({
      id: "missing_h1",
      severity: "high",
      title: "Missing H1 headline",
      recommendation: "Add a single, specific H1 that clearly states the product outcome.",
      whyItMatters: "For PLG SaaS, unclear above-the-fold messaging lowers trial/signup conversion.",
      evidence: { h1: e.headings.h1 },
      howToTest: "A/B test a benefit-led H1 vs your current headline.",
    });
  } else if (h1Count > 1) {
    findings.push({
      id: "multiple_h1",
      severity: "med",
      title: "Multiple H1s competing",
      recommendation: "Reduce to one dominant H1 and demote others to H2/H3.",
      whyItMatters: "A single clear value prop improves scanning and CTA comprehension.",
      evidence: { h1: e.headings.h1.slice(0, 5) },
      howToTest: "Measure click-through to primary CTA and scroll depth after simplifying the hero.",
    });
  }

  const ctaLabels = e.ctas.map((c) => c.label);
  const uniqueCtas = uniqByLower(ctaLabels).slice(0, 20);
  if (uniqueCtas.length >= 6) {
    findings.push({
      id: "too_many_ctas",
      severity: "med",
      title: "Too many competing CTAs",
      recommendation: "Pick 1 primary PLG action (Start trial / Sign up) and 1 secondary action.",
      whyItMatters: "PLG landing pages convert better when the decision is obvious.",
      evidence: { uniqueCtas },
      howToTest: "A/B test reducing CTA variants and standardizing labels across the page.",
    });
  }

  const navCtas = e.ctas.filter((c) => c.locationHint === "nav").map((c) => c.label);
  const navUnique = uniqByLower(navCtas);
  const hasTrialish = navUnique.some((x) => /trial|sign\s?up|get started/i.test(x));
  if (!hasTrialish) {
    findings.push({
      id: "nav_missing_primary_cta",
      severity: "low",
      title: "Nav lacks a clear primary PLG CTA",
      recommendation: "Add a consistent “Start free trial” or “Sign up” button in the top navigation.",
      whyItMatters: "Visitors often decide without scrolling; a visible CTA improves conversion.",
      evidence: { navLabels: e.navLabels.slice(0, 20) },
      howToTest: "Track CTR on nav CTA and downstream signup completion rate.",
    });
  }

  if (e.plg.pricingLinkHrefs.length === 0) {
    findings.push({
      id: "missing_pricing_path",
      severity: "med",
      title: "No obvious path to pricing",
      recommendation: "Add a clear “Pricing” link in nav and/or in the hero to support self-serve evaluation.",
      whyItMatters: "PLG buyers often need pricing clarity before starting a trial.",
      evidence: { navLabels: e.navLabels.slice(0, 20) },
      howToTest: "Add a pricing link and measure impact on trial starts and pricing-page engagement.",
    });
  }

  if (e.forms.some((f) => f.fields >= 7)) {
    findings.push({
      id: "high_form_friction",
      severity: "high",
      title: "High signup/contact friction detected",
      recommendation: "Reduce required fields for initial signup; defer non-essential fields until after activation.",
      whyItMatters: "PLG conversion drops sharply as form friction increases.",
      evidence: { forms: e.forms },
      howToTest: "A/B test a shorter signup form and measure completion + activation rate.",
    });
  }

  if (e.plg.demoOnlyCues) {
    findings.push({
      id: "plg_motion_mismatch",
      severity: "high",
      title: "Page appears sales-led (demo-first) rather than PLG",
      recommendation: "If PLG is the goal, introduce a self-serve trial/signup path alongside demo for larger teams.",
      whyItMatters: "A PLG landing page should make the self-serve path unmissable.",
      evidence: { demoOnlyCues: true },
      howToTest: "Add a trial path and compare signups by segment vs demo requests.",
    });
  }

  if (!e.plg.mentionsNoCreditCard && (e.plg.signupLinkHrefs.length > 0 || e.ctas.some((c) => /trial|sign\s?up/i.test(c.label)))) {
    findings.push({
      id: "missing_reassurance",
      severity: "low",
      title: "Trial reassurance may be missing",
      recommendation: "Add reassurance near the primary CTA (e.g. “No credit card required”, “Cancel anytime”).",
      whyItMatters: "Reducing perceived risk increases PLG CTA clicks.",
      evidence: { mentionsNoCreditCard: e.plg.mentionsNoCreditCard, mentionsCancelAnytime: e.plg.mentionsCancelAnytime },
      howToTest: "A/B test reassurance copy near the hero CTA and measure CTA CTR.",
    });
  }

  return findings.slice(0, 10);
}

