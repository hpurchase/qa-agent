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
    "",
    "Return ONLY valid JSON with this shape:",
    `{"conversionMotion":"start_trial|signup|request_demo|contact_sales","productCategory":"string","valueProp":"string","icp":"string","plgMismatch":true|false}`,
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
    "title": "string",
    "recommendation": "string",
    "whyItMatters": "string",
    "evidence": "object (must cite evidence pack keys)",
    "screenshotEvidence": "object (desktop/mobile notes)",
    "howToTest": "string"
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
    content.push({ type: "text", text: "Desktop full-page screenshot." });
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
    content.push({ type: "text", text: "Mobile full-page screenshot." });
  }

  content.push({
    type: "text",
    text: [
      "You are a PLG SaaS CRO analyst.",
      "Output only recommendations supported by evidence. Do not invent.",
      "Prioritize pricing clarity, signup motion clarity, and reducing friction to start.",
      "Return max 10 recommendations.",
      "",
      "Return ONLY valid JSON matching this schema:",
      schemaHint,
      "",
      "Site summary JSON:",
      JSON.stringify(params.siteSummary),
      "",
      "Evidence pack JSON:",
      JSON.stringify(params.evidence),
    ].join("\n"),
  });

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.2,
    messages: [{ role: "user", content }],
  });

  const text = msg.content?.find((c) => c.type === "text")?.text ?? "";
  const parsed = safeJsonParse<{ recommendations: CroFinding[] }>(text, { recommendations: [] });
  return { recommendations: parsed.recommendations ?? [] };
}
