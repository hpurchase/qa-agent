import type { EvidencePack } from "@/lib/cro/evidence";
import type { CroFinding } from "@/lib/cro/heuristics";
import { anthropicClient, anthropicModel } from "@/lib/ai/anthropic";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export type SaaSSiteSummary = {
  conversionMotion: "start_trial" | "signup" | "request_demo" | "contact_sales";
  productCategory: string;
  valueProp: string;
  icp: string;
  plgMismatch: boolean;
};

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }
  return raw.trim();
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(extractJson(raw)) as T;
  } catch {
    return fallback;
  }
}

function isOauthRelated(r: CroFinding): boolean {
  const t = `${r.title}\n${r.recommendation}\n${r.whyItMatters}`.toLowerCase();
  return /(oauth|sso|social sign|sign in with|sign up with|continue with|google|microsoft|apple|github|okta|auth0|squarespace)/i.test(
    t,
  );
}

function isAddOauth(r: CroFinding): boolean {
  const t = `${r.title}\n${r.recommendation}`.toLowerCase();
  return /(add|introduce|include|offer).*(oauth|sso|social|google|microsoft|apple|github)/i.test(t);
}

function isRemoveOauth(r: CroFinding): boolean {
  const t = `${r.title}\n${r.recommendation}`.toLowerCase();
  return /(remove|delete|drop).*(oauth|sso|social|continue with|sign in with|google|microsoft|apple|github|squarespace)/i.test(t);
}

function filterContradictoryOauthRecs(params: { evidence: EvidencePack; recs: CroFinding[] }): CroFinding[] {
  const recs = [...params.recs];
  const oauthRecs = recs.filter(isOauthRelated);
  if (oauthRecs.length === 0) return recs;

  // If the page doesn't show any OAuth buttons in evidence, don't let the model talk about removing them.
  const oauthButtons = params.evidence.plg.oauthButtons ?? [];
  if (oauthButtons.length === 0) {
    return recs.filter((r) => !(isOauthRelated(r) && isRemoveOauth(r)));
  }

  // If OAuth exists, avoid contradictory "add social login" advice.
  const hasAdd = oauthRecs.some(isAddOauth);
  const hasRemove = oauthRecs.some(isRemoveOauth);
  if (hasAdd && hasRemove) {
    return recs.filter((r) => !(isOauthRelated(r) && isAddOauth(r)));
  }

  return recs;
}

export async function inferSaaSSiteSummary(params: { evidence: EvidencePack }): Promise<SaaSSiteSummary> {
  const client = anthropicClient();
  const model = anthropicModel();

  const prompt = [
    "You are a PLG SaaS CRO analyst.",
    "Be conservative; do not guess beyond evidence.",
    "Assume the site is SaaS. Bias toward PLG motions (start_trial/signup).",
    "If the site is demo/contact-only, set plgMismatch=true.",
    "If this is a pre-launch/waitlist site, set conversionMotion to 'signup' and note it in valueProp.",
    "",
    "Return ONLY valid JSON with this shape:",
    `{"conversionMotion":"start_trial|signup|request_demo|contact_sales","productCategory":"string","valueProp":"string (<=200 chars)","icp":"string (<=200 chars)","plgMismatch":true|false}`,
    "",
    "Evidence pack JSON:",
    JSON.stringify(params.evidence),
  ].join("\n");

  const msg = await client.messages.create({
    model,
    max_tokens: 600,
    temperature: 0.2,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });

  const text = msg.content?.find((c) => c.type === "text")?.text ?? "";

  const fallback: SaaSSiteSummary = {
    conversionMotion: "signup",
    productCategory: "unknown",
    valueProp: "",
    icp: "",
    plgMismatch: false,
  };
  return safeJsonParse<SaaSSiteSummary>(text, fallback);
}

export async function generateGroundedRecommendations(params: {
  evidence: EvidencePack;
  siteSummary: SaaSSiteSummary;
  screenshots: {
    desktop?: { bytes: ArrayBuffer; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
    mobile?: { bytes: ArrayBuffer; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
  };
}): Promise<{ recommendations: CroFinding[] }> {
  const client = anthropicClient();
  const model = anthropicModel();

  const schemaHint = `{
  "recommendations": [{
    "id": "string",
    "severity": "low|med|high",
    "title": "string (specific, not generic — quote page elements)",
    "recommendation": "string (detailed, actionable, references specific page elements with quoted text)",
    "whyItMatters": "string (with data/reasoning specific to THIS site and ICP, not generic CRO advice)",
    "evidence": {"what_i_found": "string quoting exact elements from the page"},
    "howToTest": "string (concrete A/B test with specific success metric)",
    "confidence": "high|medium (how sure are you this matters for THIS site?)",
    "estimatedLift": "string (e.g. '5-15% signup conversion', '10-20% CTA clicks')"
  }]
}`;

  const content: MessageParam["content"] = [];

  if (params.screenshots.desktop) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: params.screenshots.desktop.mediaType,
        data: Buffer.from(params.screenshots.desktop.bytes).toString("base64"),
      },
    });
    content.push({ type: "text", text: "Above: Desktop full-page screenshot of this SaaS landing page." });
  }
  if (params.screenshots.mobile) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: params.screenshots.mobile.mediaType,
        data: Buffer.from(params.screenshots.mobile.bytes).toString("base64"),
      },
    });
    content.push({ type: "text", text: "Above: Mobile full-page screenshot of this SaaS landing page." });
  }

  content.push({
    type: "text",
    text: [
      `You are a world-class PLG SaaS conversion rate optimisation consultant. You charge $500/hour and clients expect exceptional, specific, actionable advice that makes them say "I would never have thought of that."`,
      "",
      `You are reviewing a real SaaS landing page for "${params.siteSummary.valueProp || "a SaaS product"}".`,
      `Product category: ${params.siteSummary.productCategory}`,
      `Target audience (ICP): ${params.siteSummary.icp}`,
      `Conversion motion: ${params.siteSummary.conversionMotion}`,
      `PLG mismatch detected: ${params.siteSummary.plgMismatch}`,
      params.evidence.competitors.length > 0 ? `Competitor mentions on page: ${params.evidence.competitors.join(", ")}` : "",
      params.evidence.trustSignals.customerCountText ? `Customer count claim: ${params.evidence.trustSignals.customerCountText}` : "",
      params.evidence.urgency.trialLengthText ? `Trial length: ${params.evidence.urgency.trialLengthText}` : "",
      "",
      "YOUR JOB: Find the 5-8 things that, if fixed, would have the BIGGEST impact on this specific site's conversion rate. Not generic CRO tips — insights that are only true for THIS page, THIS product, THIS audience.",
      "",
      "RULES (non-negotiable):",
      "1. Every recommendation MUST quote specific text or visual elements from the page. If you can't quote it, don't recommend it.",
      "2. Never give advice that applies to any SaaS site generically. Ask: 'would this recommendation change if I saw a different site?' If no, it's too generic.",
      "3. Consider the ICP deeply. A developer-tools page should feel technical and credible. A SMB HR tool should feel approachable and simple. Is there a mismatch?",
      "4. If something is working well, don't recommend changing it.",
      "5. For pre-launch/waitlist sites, focus on waitlist conversion — don't recommend 'add a free trial.'",
      "6. Each recommendation must be implementable by a designer/developer in under a day.",
      "7. Include estimated conversion lift for each recommendation (be specific: '5-15% more signups' not just 'more conversions').",
      "",
      "ANALYSIS DIMENSIONS (go beyond basic CRO):",
      "",
      "Messaging & Psychology:",
      "- Does the H1 communicate a *benefit* or just describe *features*? Quote it.",
      "- Is the page framing problems (loss aversion: 'stop wasting time') or gains ('save 10 hours/week')? Which is better for this ICP?",
      "- Does the copy address the top 3 objections this ICP would have? (cost, complexity, risk, switching cost)",
      "- Is there specificity that builds credibility? ('Used by 2,847 teams' > 'Trusted by thousands')",
      "",
      "Visual & Layout (from screenshots):",
      "- Does the visual hierarchy guide the eye from headline → value prop → CTA?",
      "- On mobile: is the CTA above the fold? Is the form usable with a thumb?",
      "- Does the page feel premium/modern or outdated? Does the design match the price point?",
      "- Is there visual clutter competing with the primary action?",
      "",
      "Conversion Funnel:",
      "- Is the path from landing to signup clear and frictionless?",
      "- Are there unnecessary steps or distractions before the CTA?",
      "- Does the pricing (if visible) have a clear recommended tier?",
      "- Is there a mismatch between what the CTA promises and what the form asks for?",
      "",
      "Competitive Positioning:",
      "- Based on the product category, is this page differentiated or generic?",
      "- Would a visitor know in 5 seconds why this is better than alternatives?",
      "- If competitors are mentioned, is the comparison effective?",
      "",
      "OAuth / Social signup: only mention if you can quote exact button text from evidence. Never recommend both adding AND removing social signup.",
      "",
      "RANKING: Return recommendations sorted by expected impact. The first recommendation should be the single highest-impact change. Include confidence level and estimated conversion lift for each.",
      "",
      "Return 5-8 high-quality recommendations. Quality over quantity.",
      "",
      "Return ONLY valid JSON matching this schema:",
      schemaHint,
      "",
      "EVIDENCE DATA (extracted from the page DOM):",
      JSON.stringify(params.evidence, null, 0),
    ].join("\n"),
  });

  const msg = await client.messages.create({
    model,
    max_tokens: 6000,
    temperature: 0.3,
    messages: [{ role: "user", content }],
  });

  const text = msg.content?.find((c) => c.type === "text")?.text ?? "";
  const parsed = safeJsonParse<{ recommendations: CroFinding[] }>(text, { recommendations: [] });
  const filtered = filterContradictoryOauthRecs({
    evidence: params.evidence,
    recs: parsed.recommendations ?? [],
  });
  return { recommendations: filtered };
}
