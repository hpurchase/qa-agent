import type { EvidencePack } from "@/lib/cro/evidence";
import type { CroFinding } from "@/lib/cro/heuristics";
import type { AuditTargetRole } from "@/lib/db/types";

export type PageEvidence = {
  role: AuditTargetRole;
  url: string;
  evidence: EvidencePack;
};

export function runCrossPageChecks(pages: PageEvidence[]): CroFinding[] {
  const findings: CroFinding[] = [];
  if (pages.length < 2) return findings;

  const homepage = pages.find((p) => p.role === "homepage");
  const pricing = pages.find((p) => p.role === "pricing");
  const signup = pages.find((p) => p.role === "signup");

  // CTA label consistency across pages.
  const ctaLabelsPerPage = pages.map((p) => ({
    role: p.role,
    labels: p.evidence.ctas
      .filter((c) => /trial|sign|start|get started|demo|book/i.test(c.label))
      .map((c) => c.label.toLowerCase().trim()),
  }));

  const allPrimaryLabels = ctaLabelsPerPage.flatMap((p) => p.labels);
  const unique = [...new Set(allPrimaryLabels)];
  if (unique.length >= 4) {
    findings.push({
      id: "cross_cta_inconsistency",
      severity: "high",
      title: "Primary CTA labels are inconsistent across pages",
      recommendation:
        "Standardize to one primary CTA label (e.g. 'Start free trial') across homepage, pricing, and signup pages.",
      whyItMatters:
        "Inconsistent CTAs confuse visitors about the next step and fragment the conversion funnel.",
      evidence: { uniqueLabels: unique.slice(0, 10), perPage: ctaLabelsPerPage },
      howToTest: "Unify CTA copy, then measure full-funnel conversion rate vs control.",
    });
  }

  // Motion mismatch: homepage says trial but pricing says demo (or vice versa).
  if (homepage && pricing) {
    const homepageHasTrial = homepage.evidence.ctas.some((c) =>
      /trial|sign\s?up|get started/i.test(c.label),
    );
    const pricingHasTrial = pricing.evidence.ctas.some((c) =>
      /trial|sign\s?up|get started/i.test(c.label),
    );
    const pricingHasDemo = pricing.evidence.ctas.some((c) =>
      /demo|book|contact|talk/i.test(c.label),
    );

    if (homepageHasTrial && !pricingHasTrial && pricingHasDemo) {
      findings.push({
        id: "cross_motion_mismatch",
        severity: "high",
        title: "Conversion motion mismatch: homepage is PLG but pricing is sales-led",
        recommendation:
          "Add a self-serve trial/signup CTA on the pricing page to match the homepage PLG motion.",
        whyItMatters:
          "Visitors who come to pricing expecting to start a trial get funneled into a demo flow, increasing drop-off.",
        evidence: { homepageHasTrial, pricingHasTrial, pricingHasDemo },
        howToTest:
          "Add a trial CTA to pricing page and measure pricing-to-signup conversion rate.",
      });
    }
  }

  // Nav consistency: check if nav items match across pages.
  if (pages.length >= 2) {
    const navSets = pages.map((p) => ({
      role: p.role,
      nav: p.evidence.navLabels.slice(0, 20).map((l) => l.toLowerCase()),
    }));
    const base = navSets[0];
    for (const other of navSets.slice(1)) {
      const missing = base.nav.filter((l) => !other.nav.includes(l));
      if (missing.length > 3) {
        findings.push({
          id: `cross_nav_drift_${other.role}`,
          severity: "low",
          title: `Navigation differs between ${base.role} and ${other.role}`,
          recommendation: "Keep navigation consistent across all marketing pages.",
          whyItMatters:
            "Inconsistent nav makes the site feel fragmented and can reduce trust.",
          evidence: { baseNav: base.nav, otherNav: other.nav, missing },
          howToTest:
            "Standardize nav and measure bounce rate on the affected page.",
        });
      }
    }
  }

  // H1/messaging drift.
  if (homepage && pricing) {
    const homepageH1 = homepage.evidence.headings.h1[0]?.toLowerCase() ?? "";
    const pricingH1 = pricing.evidence.headings.h1[0]?.toLowerCase() ?? "";
    if (homepageH1 && pricingH1 && !pricingH1.includes("pric") && !pricingH1.includes("plan")) {
      findings.push({
        id: "cross_pricing_h1_unclear",
        severity: "med",
        title: "Pricing page H1 does not clearly indicate pricing",
        recommendation:
          "Use a clear pricing-related heading (e.g. 'Simple, transparent pricing') so visitors know they are on the right page.",
        whyItMatters:
          "Visitors arriving from a 'Pricing' nav link expect to immediately see plan/pricing info.",
        evidence: { homepageH1, pricingH1 },
        howToTest: "A/B test a clearer pricing H1 and measure scroll depth + signup rate.",
      });
    }
  }

  // Signup friction check (if signup page exists).
  if (signup) {
    const forms = signup.evidence.forms;
    const hasLongForm = forms.some((f) => f.fields >= 5);
    if (hasLongForm) {
      findings.push({
        id: "cross_signup_high_friction",
        severity: "high",
        title: "Signup page has a long form",
        recommendation:
          "Reduce signup to email + password (or just email with magic link). Defer other fields to onboarding.",
        whyItMatters:
          "Every additional field on a PLG signup form reduces conversion. Best-in-class PLG asks for 1-2 fields.",
        evidence: { forms },
        howToTest:
          "A/B test a shorter signup form and measure signup completion + activation.",
      });
    }
    if (!signup.evidence.plg.mentionsNoCreditCard && !signup.evidence.plg.mentionsFreeForever) {
      findings.push({
        id: "cross_signup_no_reassurance",
        severity: "med",
        title: "Signup page is missing trial reassurance",
        recommendation:
          "Add 'No credit card required' or 'Free forever' copy near the signup form.",
        whyItMatters: "Reassurance copy reduces perceived risk and increases form submissions.",
        evidence: {
          mentionsNoCreditCard: signup.evidence.plg.mentionsNoCreditCard,
          mentionsFreeForever: signup.evidence.plg.mentionsFreeForever,
        },
        howToTest: "Add reassurance text and measure form completion rate.",
      });
    }
  }

  return findings.slice(0, 10);
}
