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
    "title": "string (specific, not generic)",
    "recommendation": "string (detailed, actionable, references specific page elements)",
    "whyItMatters": "string (with data/reasoning specific to this site)",
    "evidence": {"what_i_found": "string quoting exact elements"},
    "howToTest": "string (concrete A/B test)"
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
      `You are a world-class PLG SaaS conversion rate optimisation consultant. You charge $500/hour and clients expect exceptional, specific, actionable advice.`,
      "",
      `You are reviewing a real SaaS landing page for "${params.siteSummary.valueProp || "a SaaS product"}".`,
      `Product category: ${params.siteSummary.productCategory}`,
      `Target audience: ${params.siteSummary.icp}`,
      `Conversion motion: ${params.siteSummary.conversionMotion}`,
      "",
      "CRITICAL RULES:",
      "1. NEVER give generic advice like 'improve your CTA' or 'add social proof'. Every recommendation must reference SPECIFIC elements on THIS page.",
      "2. Quote exact text from the page. For example: 'The hero CTA says \"RSVP For Early Access\" which implies the product isn't available yet. Change it to \"Start Free Trial\" to signal immediate access.'",
      "3. Reference specific visual issues from the screenshots. For example: 'The mobile screenshot shows the nav takes up 40% of the viewport, pushing the hero CTA below the fold.'",
      "4. Include specific numbers when possible: how many CTAs you found, how many form fields, how far down the page something is.",
      "5. If something is already done WELL, do NOT recommend changing it. Only flag real problems.",
      "6. Consider the site's context. If this is a pre-launch/waitlist site, don't recommend 'add a free trial' — recommend how to improve the waitlist conversion.",
      "7. Each recommendation should be something a designer/developer can implement in under a day.",
      "8. For the 'howToTest' field, describe a specific A/B test with clear success metrics.",
      "",
      "WHAT TO LOOK FOR (from screenshots + evidence):",
      "- Is the value proposition clear within 5 seconds?",
      "- Is the primary CTA obvious and compelling?",
      "- Is there visual hierarchy that guides the eye to the CTA?",
      "- On mobile: is the CTA above the fold? Are tap targets big enough?",
      "- Is pricing clear and transparent (if applicable)?",
      "- Are there trust signals (logos, testimonials, security badges)?",
      "- Is the signup/trial friction low (few form fields, clear next step)?",
      "- Are CTAs consistent in labelling and design across the page?",
      "",
      "Return 5-8 high-quality recommendations (not 10 mediocre ones). Quality over quantity.",
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
    max_tokens: 4096,
    temperature: 0.3,
    messages: [{ role: "user", content }],
  });

  const text = msg.content?.find((c) => c.type === "text")?.text ?? "";
  const parsed = safeJsonParse<{ recommendations: CroFinding[] }>(text, { recommendations: [] });
  return { recommendations: parsed.recommendations ?? [] };
}
