import type { EvidencePack } from "@/lib/cro/evidence";
import type { CroFinding } from "@/lib/cro/heuristics";
import type { AuditTargetRole } from "@/lib/db/types";

export type PageEvidence = {
  role: AuditTargetRole;
  url: string;
  evidence: EvidencePack;
};

function uniqLower(xs: string[]) {
  return [...new Set(xs.map((x) => x.toLowerCase().trim()).filter(Boolean))];
}

function q(s: string) {
  return `"${s}"`;
}

const PRIMARY_CTA = /trial|sign\s?up|signup|get\s?started|start\s?now|start\s?free|create\s?account|register/i;
const SALES_CTA = /request.*demo|book.*demo|book.*call|talk.*sales|contact.*sales|schedule.*demo/i;

export function runCrossPageChecks(pages: PageEvidence[]): CroFinding[] {
  const findings: CroFinding[] = [];
  if (pages.length < 2) return findings;

  const homepage = pages.find((p) => p.role === "homepage");
  const pricing = pages.find((p) => p.role === "pricing");
  const signup = pages.find((p) => p.role === "signup");

  // CTA consistency across pages — only flag with specific evidence.
  const ctasByPage = pages.map((p) => {
    const labels = p.evidence.ctas
      .filter((c) => PRIMARY_CTA.test(c.label) || SALES_CTA.test(c.label))
      .map((c) => c.label.trim());
    return { role: p.role, labels: uniqLower(labels), raw: labels };
  });

  const allLabels = uniqLower(ctasByPage.flatMap((p) => p.labels));
  if (allLabels.length >= 4) {
    const perPage = ctasByPage.map((p) => `${p.role}: ${p.raw.slice(0, 3).map(q).join(", ") || "(none)"}`).join("; ");
    findings.push({
      id: "cross_cta_drift",
      severity: "high",
      title: `${allLabels.length} different CTA labels across ${pages.length} pages`,
      recommendation: `Each page uses different CTAs: ${perPage}. Pick one primary label and use it on every page.`,
      whyItMatters: "When CTAs change between pages, visitors lose confidence about what action they're taking.",
      evidence: { allLabels, perPage: ctasByPage },
      howToTest: "Unify all primary CTAs to one label. Measure full-funnel conversion (landing → signup).",
    });
  }

  // Motion mismatch: homepage is PLG but pricing is sales-led.
  if (homepage && pricing) {
    const hpHasTrial = homepage.evidence.ctas.some((c) => PRIMARY_CTA.test(c.label));
    const prHasTrial = pricing.evidence.ctas.some((c) => PRIMARY_CTA.test(c.label));
    const prHasSales = pricing.evidence.ctas.some((c) => SALES_CTA.test(c.label));

    if (hpHasTrial && !prHasTrial && prHasSales) {
      const hpLabels = homepage.evidence.ctas.filter((c) => PRIMARY_CTA.test(c.label)).map((c) => c.label);
      const prLabels = pricing.evidence.ctas.filter((c) => SALES_CTA.test(c.label)).map((c) => c.label);
      findings.push({
        id: "cross_motion_mismatch",
        severity: "high",
        title: `Homepage offers self-serve (${q(hpLabels[0])}) but pricing page only has sales CTAs (${q(prLabels[0])})`,
        recommendation: `Homepage has ${q(hpLabels[0])} but the pricing page switches to ${q(prLabels[0])}. Add a self-serve trial CTA on the pricing page so visitors who evaluated pricing can start immediately.`,
        whyItMatters: "Visitors who click 'Pricing' are high intent. If the next step is 'Book a demo' instead of 'Start trial', many will bounce.",
        evidence: { homepageTrialCtas: hpLabels.slice(0, 3), pricingSalesCtas: prLabels.slice(0, 3) },
        howToTest: "Add a trial CTA to the pricing page. Measure pricing→signup conversion.",
      });
    }
  }

  // Signup page friction — specific field counts and labels.
  if (signup) {
    const forms = signup.evidence.forms;
    const longForms = forms.filter((f) => f.fields >= 4);
    if (longForms.length > 0) {
      const worst = longForms[0];
      const fieldDesc = worst.labels.length > 0
        ? worst.labels.slice(0, 5).map(q).join(", ")
        : `${worst.fields} fields`;
      findings.push({
        id: "signup_friction",
        severity: "high",
        title: `Signup page asks for ${worst.fields} fields — too many for PLG`,
        recommendation: `The signup form has: ${fieldDesc}. Reduce to email (+ optional password). Collect company name, phone, etc. during onboarding — not before signup.`,
        whyItMatters: `A ${worst.fields}-field form likely loses 30-50% of visitors who were ready to sign up.`,
        evidence: { fields: worst.fields, labels: worst.labels, url: signup.url },
        howToTest: "Test email-only signup vs current form. Measure: form completion rate and 7-day activation.",
      });
    }

    if (!signup.evidence.plg.mentionsNoCreditCard && !signup.evidence.plg.mentionsFreeForever && !signup.evidence.plg.mentionsCancelAnytime) {
      findings.push({
        id: "signup_no_reassurance",
        severity: "med",
        title: "Signup page has no reassurance copy (no 'free', 'no credit card', or 'cancel anytime')",
        recommendation: `Add reassurance text next to the signup form: "No credit card required", "Free plan available", or "Cancel anytime". This is missing from ${signup.url}.`,
        whyItMatters: "Reassurance copy removes the #1 hesitation ('will I be charged?') and typically lifts form completion by 10-30%.",
        evidence: { mentionsNoCreditCard: false, mentionsFreeForever: false, mentionsCancelAnytime: false },
        howToTest: "Add 'No credit card required' below the submit button. Measure form completion rate.",
      });
    }
  }

  // Pricing page has no direct link to signup.
  if (pricing && signup) {
    const pricingSignupLinks = pricing.evidence.plg.signupLinkHrefs;
    const pricingPrimaryCtas = pricing.evidence.ctas.filter((c) => PRIMARY_CTA.test(c.label));
    if (pricingSignupLinks.length === 0 && pricingPrimaryCtas.length === 0) {
      findings.push({
        id: "pricing_no_signup_link",
        severity: "high",
        title: "Pricing page has no link or CTA to the signup page",
        recommendation: `The pricing page at ${pricing.url} has no signup/trial CTAs or links to ${signup.url}. Add a clear "Start Free Trial" or "Get Started" button to each pricing tier.`,
        whyItMatters: "Pricing page visitors are the highest-intent users. If they can't immediately start, they bounce — you lose your best leads.",
        evidence: { pricingUrl: pricing.url, signupUrl: signup.url, pricingCtaCount: pricingPrimaryCtas.length, signupLinkCount: pricingSignupLinks.length },
        howToTest: "Add trial CTAs to each pricing tier. Measure: pricing→signup conversion rate.",
      });
    }
  }

  // Value prop inconsistency: homepage H1 vs pricing page H1.
  if (homepage && pricing) {
    const hpH1 = homepage.evidence.headings.h1[0]?.toLowerCase().trim() ?? "";
    const prH1 = pricing.evidence.headings.h1[0]?.toLowerCase().trim() ?? "";
    if (hpH1 && prH1) {
      // Check if they share zero meaningful words (ignore short/common words)
      const stop = new Set(["the", "a", "an", "and", "or", "for", "to", "of", "is", "in", "on", "with", "your", "our", "by", "it", "its", "that", "this", "we"]);
      const hpWords = new Set(hpH1.split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
      const prWords = prH1.split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
      const overlap = prWords.filter((w) => hpWords.has(w)).length;

      if (hpWords.size > 0 && prWords.length > 0 && overlap === 0) {
        findings.push({
          id: "cross_value_prop_mismatch",
          severity: "med",
          title: "Homepage and pricing page headings share no common messaging",
          recommendation: `Homepage H1: ${q(homepage.evidence.headings.h1[0])}. Pricing H1: ${q(pricing.evidence.headings.h1[0])}. These feel like different products. Align the messaging so visitors feel continuity as they navigate.`,
          whyItMatters: "Inconsistent messaging between pages breaks the visitor's mental model and reduces trust in the product story.",
          evidence: { homepageH1: homepage.evidence.headings.h1[0], pricingH1: pricing.evidence.headings.h1[0], overlapWords: overlap },
          howToTest: "Align pricing page heading with homepage value prop. Measure: pricing page bounce rate.",
        });
      }
    }
  }

  // Homepage has CTA to signup but signup page is on a different domain.
  if (homepage && signup) {
    try {
      const hpDomain = new URL(homepage.url).hostname;
      const suDomain = new URL(signup.url).hostname;
      if (hpDomain !== suDomain) {
        findings.push({
          id: "cross_domain_signup",
          severity: "low",
          title: `Signup is on a different domain (${suDomain}) from homepage (${hpDomain})`,
          recommendation: `Your homepage is on ${hpDomain} but signup redirects to ${suDomain}. This domain switch can trigger trust concerns. Consider using a subdomain of your main domain or embedding signup on the main site.`,
          whyItMatters: "Domain changes during signup make visitors wonder if they're on a legitimate site, especially if the design differs.",
          evidence: { homepageDomain: hpDomain, signupDomain: suDomain },
          howToTest: "Monitor drop-off at the domain transition point. Consider moving signup to a subdomain.",
        });
      }
    } catch {
      // URL parsing failure is non-fatal.
    }
  }

  return findings.slice(0, 10);
}
