import type { RunResult, StepRecord } from "@/lib/onboarding/runner";
import { anthropicClient, anthropicModel } from "@/lib/ai/anthropic";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import sharp from "sharp";

export type OnboardingMetrics = {
  stepCount: number;
  distinctScreens: number;
  totalDurationMs: number;
  estimatedTimeToValueMs: number;
  formFieldCount: number;
  frictionFlags: string[];
};

export type DashboardFeedback = {
  summary: string;
  nextBestAction: string;
  uiIssues: Array<{ severity: "high" | "med" | "low"; issue: string; fix: string }>;
  activationChecklist: string[];
};

export function computeOnboardingMetrics(steps: StepRecord[]): OnboardingMetrics {
  const actionSteps = steps.filter(
    (s) => s.actionType !== "wait" && s.actionType !== "screenshot",
  );

  // Count distinct screens by URL changes.
  const urls = new Set<string>();
  for (const s of steps) {
    if (s.url) urls.add(s.url);
  }

  // Count form fields filled.
  const fillSteps = steps.filter((s) => s.actionType === "fill");
  const selectSteps = steps.filter((s) => s.actionType === "select");
  const formFieldCount = fillSteps.length + selectSteps.length;

  // Estimated time: actual automation time + estimated human typing time.
  const totalDurationMs = steps.reduce((sum, s) => sum + s.durationMs, 0);
  const estimatedTypingMs = formFieldCount * 3000;
  const estimatedTimeToValueMs = totalDurationMs + estimatedTypingMs;

  // Friction flags.
  const frictionFlags: string[] = [];

  if (actionSteps.length > 10) {
    frictionFlags.push(`Too many steps (${actionSteps.length}) before reaching value`);
  }

  if (formFieldCount > 5) {
    frictionFlags.push(`${formFieldCount} form fields to fill -- consider reducing required fields`);
  }

  const hasPasswordField = fillSteps.some((s) => {
    const detail = s.actionDetail as Record<string, unknown>;
    const instruction = String(detail.instruction ?? detail.prompt ?? "").toLowerCase();
    return instruction.includes("password");
  });
  if (hasPasswordField) {
    frictionFlags.push("Password field required during signup");
  }

  const hasEmailVerify = steps.some((s) => s.actionType === "email_verify");
  if (hasEmailVerify) {
    frictionFlags.push("Email verification step interrupts the flow");
  }

  const hasPhoneField = fillSteps.some((s) => {
    const detail = s.actionDetail as Record<string, unknown>;
    const instruction = String(detail.instruction ?? detail.prompt ?? "").toLowerCase();
    return instruction.includes("phone") || instruction.includes("mobile");
  });
  if (hasPhoneField) {
    frictionFlags.push("Phone number required -- high friction for initial signup");
  }

  const blocked = steps.find((s) => s.actionType === "blocked");
  if (blocked) {
    frictionFlags.push(`Flow blocked: ${blocked.blockedReason ?? "unknown reason"}`);
  }

  return {
    stepCount: actionSteps.length,
    distinctScreens: urls.size,
    totalDurationMs,
    estimatedTimeToValueMs,
    formFieldCount,
    frictionFlags,
  };
}

async function resizeForVision(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const img = sharp(Buffer.from(bytes));
  const meta = await img.metadata();
  const maxEdge = 1568;
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= maxEdge && h <= maxEdge) return bytes;
  const resized = await img
    .resize({
      width: w > h ? maxEdge : undefined,
      height: h >= w ? maxEdge : undefined,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
  const ab = new ArrayBuffer(resized.byteLength);
  new Uint8Array(ab).set(resized);
  return ab;
}

export async function generateDashboardFeedback(params: {
  steps: StepRecord[];
  /** Only review “post-signup first screen” when the flow actually finished. */
  finalStatus: RunResult["finalStatus"];
}): Promise<DashboardFeedback | null> {
  if (params.finalStatus !== "done") return null;

  const doneStep = [...params.steps].reverse().find((s) => s.actionType === "done" && s.screenshotBytes);
  const lastWithShot =
    doneStep ?? [...params.steps].reverse().find((s) => s.screenshotBytes);
  if (!lastWithShot?.screenshotBytes) return null;

  const client = anthropicClient();
  const model = anthropicModel();

  const resized = await resizeForVision(lastWithShot.screenshotBytes);

  const content: MessageParam["content"] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: Buffer.from(resized).toString("base64"),
      },
    },
    {
      type: "text",
      text: [
        "You are a senior SaaS product designer reviewing the FIRST screen a new user lands on after signup (dashboard/app home).",
        "Goal: improve time-to-value and reduce confusion.",
        "",
        "Return ONLY valid JSON with this shape:",
        `{"summary":"string","nextBestAction":"string","uiIssues":[{"severity":"high|med|low","issue":"string","fix":"string"}],"activationChecklist":["string"]}`,
        "",
        "Rules:",
        "- Be concrete. Reference what you see on the screen (labels, layout, empty states).",
        "- Prioritize onboarding/activation: what should the user do in the first 60 seconds?",
        "- Suggest UI copy + placement changes a team can ship quickly.",
      ].join("\n"),
    },
  ];

  const msg = await client.messages.create({
    model,
    max_tokens: 900,
    temperature: 0.2,
    messages: [{ role: "user", content }],
  });

  const text = msg.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1].trim() : text.trim();
    const braceStart = jsonStr.indexOf("{");
    const braceEnd = jsonStr.lastIndexOf("}");
    const clean = braceStart !== -1 ? jsonStr.slice(braceStart, braceEnd + 1) : jsonStr;
    return JSON.parse(clean) as DashboardFeedback;
  } catch {
    return null;
  }
}

export async function generateOnboardingRecommendations(params: {
  steps: StepRecord[];
  metrics: OnboardingMetrics;
  signupUrl: string;
}): Promise<Array<Record<string, unknown>>> {
  const client = anthropicClient();
  const model = anthropicModel();

  const content: MessageParam["content"] = [];

  // Include up to 8 step screenshots (to stay within token budget).
  const stepsWithScreenshots = params.steps.filter((s) => s.screenshotBytes);
  const selectedSteps = stepsWithScreenshots.length <= 8
    ? stepsWithScreenshots
    : stepsWithScreenshots.filter((_, i) => {
        const interval = Math.ceil(stepsWithScreenshots.length / 8);
        return i % interval === 0;
      }).slice(0, 8);

  for (const step of selectedSteps) {
    if (step.screenshotBytes) {
      const resized = await resizeForVision(step.screenshotBytes);
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: Buffer.from(resized).toString("base64"),
        },
      });
      content.push({
        type: "text",
        text: `Step ${step.stepIdx}: ${step.actionType} at ${step.url ?? "unknown URL"} (${step.durationMs}ms) — ${(step.actionDetail as Record<string, unknown>).reason ?? ""}`,
      });
    }
  }

  const stepLog = params.steps.map((s) => ({
    step: s.stepIdx,
    action: s.actionType,
    url: s.url,
    durationMs: s.durationMs,
    reason: (s.actionDetail as Record<string, unknown>).reason,
    blocked: s.blockedReason,
  }));

  content.push({
    type: "text",
    text: [
      "You are a world-class SaaS onboarding consultant. Analyze this signup/onboarding flow and provide specific, actionable recommendations to reduce drop-off.",
      "",
      `Signup URL: ${params.signupUrl}`,
      `Total steps: ${params.metrics.stepCount}`,
      `Distinct screens: ${params.metrics.distinctScreens}`,
      `Form fields filled: ${params.metrics.formFieldCount}`,
      `Estimated time-to-value: ${Math.round(params.metrics.estimatedTimeToValueMs / 1000)}s`,
      `Friction flags: ${params.metrics.frictionFlags.join("; ") || "none"}`,
      "",
      "Step-by-step event log:",
      JSON.stringify(stepLog, null, 2),
      "",
      "RULES:",
      "1. Reference SPECIFIC steps by number (e.g. 'At step 3, the user is asked for...')",
      "2. Every recommendation must be actionable and implementable in under a day.",
      "3. Focus on reducing friction, eliminating unnecessary steps, and getting the user to value faster.",
      "4. Consider: could any fields be deferred? Could steps be combined? Is email verification truly needed upfront?",
      "5. If the flow was blocked, explain what happened and suggest alternatives.",
      "",
      "Return ONLY valid JSON array:",
      '[{"id":"string","severity":"high|med|low","title":"string","recommendation":"string","whyItMatters":"string","step_refs":[1,2,3],"howToTest":"string"}]',
    ].join("\n"),
  });

  const msg = await client.messages.create({
    model,
    max_tokens: 3000,
    temperature: 0.3,
    messages: [{ role: "user", content }],
  });

  const text = msg.content?.find((c) => c.type === "text")?.text ?? "";

  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1].trim() : text.trim();
    const bracketStart = jsonStr.indexOf("[");
    const bracketEnd = jsonStr.lastIndexOf("]");
    if (bracketStart !== -1 && bracketEnd > bracketStart) {
      return JSON.parse(jsonStr.slice(bracketStart, bracketEnd + 1)) as Array<Record<string, unknown>>;
    }
    const braceStart = jsonStr.indexOf("{");
    const braceEnd = jsonStr.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      const parsed = JSON.parse(jsonStr.slice(braceStart, braceEnd + 1)) as Record<string, unknown>;
      if (Array.isArray(parsed.recommendations)) return parsed.recommendations as Array<Record<string, unknown>>;
      return [parsed];
    }
    return [];
  } catch {
    return [];
  }
}
