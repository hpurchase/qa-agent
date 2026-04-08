import { firecrawlScrape, firecrawlInteract, firecrawlInteractStop, downloadBytes } from "@/lib/firecrawl";
import { anthropicClient, anthropicModel } from "@/lib/ai/anthropic";
import { simplifyDom } from "@/lib/onboarding/domSimplifier";
import type { TestPersona } from "@/lib/onboarding/persona";
import { waitForVerificationEmail } from "@/lib/onboarding/inbox";
import type { OnboardingStepAction } from "@/lib/db/types";
import sharp from "sharp";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import crypto from "crypto";

export type StepRecord = {
  stepIdx: number;
  url: string | null;
  actionType: OnboardingStepAction;
  actionDetail: Record<string, unknown>;
  durationMs: number;
  screenshotBytes: ArrayBuffer | null;
  blockedReason: string | null;
};

export type RunResult = {
  steps: StepRecord[];
  finalStatus: "done" | "blocked" | "timeout" | "stuck" | "error";
  blockedReason: string | null;
};

const MAX_STEPS = 25;
const MAX_DURATION_MS = 5 * 60 * 1000;

type ClaudeAction = {
  action: OnboardingStepAction;
  prompt: string;
  value?: string;
  selector?: string;
  reason: string;
};

function domHash(html: string): string {
  return crypto.createHash("md5").update(html).digest("hex").slice(0, 12);
}

async function resizeScreenshot(bytes: ArrayBuffer): Promise<ArrayBuffer> {
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

function buildSystemPrompt(persona: TestPersona): string {
  return [
    "You are an automated QA bot signing up for a SaaS product. Your job is to complete the signup and onboarding flow.",
    "",
    "You are signing up as:",
    `- Name: ${persona.fullName}`,
    `- Email: ${persona.email}`,
    `- Password: ${persona.password}`,
    `- Company: ${persona.company}`,
    `- Website: ${persona.website}`,
    `- Role: ${persona.role}`,
    `- Company size: ${persona.companySize}`,
    `- Phone: ${persona.phone}`,
    `- Use case: ${persona.useCase}`,
    "",
    "RULES:",
    "1. Complete the signup form step by step. Fill one field or click one button per response.",
    "2. Always agree to terms and conditions.",
    '3. Skip optional steps like "invite teammates" by clicking Skip/Later/Not now.',
    "4. If you see a CAPTCHA, reCAPTCHA, or hCaptcha, return action=blocked.",
    "5. If you see a payment/billing form or Stripe checkout, return action=blocked.",
    "6. If the page only offers Google/GitHub/SSO login with no email option, return action=blocked.",
    "7. If you see 'check your email' or 'verify your email' or 'enter the code we sent', return action=email_verify.",
    "8. When you reach a dashboard, app home screen, or onboarding-complete page, return action=done.",
    '9. If the page seems broken or nothing is happening, return action=wait (up to 2 times), then action=blocked with reason="page_unresponsive".',
    "10. For dropdowns, pick the closest matching option from the visible choices.",
    "",
    "Return ONLY valid JSON with this shape:",
    '{"action":"fill|click|select|check|wait|skip|email_verify|done|blocked","prompt":"natural language instruction for the browser to execute (e.g. Fill the email field with jordan@...)","value":"the value to fill (if action=fill or select)","reason":"brief explanation of what you see and why you chose this action"}',
  ].join("\n");
}

async function askClaude(params: {
  persona: TestPersona;
  screenshotBytes: ArrayBuffer;
  simplifiedDom: string;
  previousSteps: Array<{ action: string; reason: string }>;
}): Promise<ClaudeAction> {
  const client = anthropicClient();
  const model = anthropicModel();

  const content: MessageParam["content"] = [];

  const resized = await resizeScreenshot(params.screenshotBytes);
  content.push({
    type: "image",
    source: {
      type: "base64",
      media_type: "image/jpeg",
      data: Buffer.from(resized).toString("base64"),
    },
  });
  content.push({ type: "text", text: "Above: current screenshot of the page." });

  let historyContext = "";
  if (params.previousSteps.length > 0) {
    const recent = params.previousSteps.slice(-5);
    historyContext =
      "\n\nPrevious actions taken:\n" +
      recent.map((s, i) => `${i + 1}. ${s.action}: ${s.reason}`).join("\n") +
      "\n";
  }

  content.push({
    type: "text",
    text: [
      `Visible interactive elements on the page:`,
      "```json",
      params.simplifiedDom,
      "```",
      historyContext,
      "What is the next single action to take? Return JSON only.",
    ].join("\n"),
  });

  const msg = await client.messages.create({
    model,
    max_tokens: 500,
    temperature: 0.1,
    system: buildSystemPrompt(params.persona),
    messages: [{ role: "user", content }],
  });

  const text = msg.content?.find((c) => c.type === "text")?.text ?? "";

  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1].trim() : text.trim();
    const braceStart = jsonStr.indexOf("{");
    const braceEnd = jsonStr.lastIndexOf("}");
    const clean = braceStart !== -1 ? jsonStr.slice(braceStart, braceEnd + 1) : jsonStr;
    return JSON.parse(clean) as ClaudeAction;
  } catch {
    return {
      action: "blocked",
      prompt: "",
      reason: `Failed to parse Claude response: ${text.slice(0, 200)}`,
    };
  }
}

export async function runOnboardingFlow(params: {
  signupUrl: string;
  persona: TestPersona;
}): Promise<RunResult> {
  const steps: StepRecord[] = [];
  const startTime = Date.now();
  let finalStatus: RunResult["finalStatus"] = "error";
  let blockedReason: string | null = null;

  // Initial scrape to get a session.
  const initial = await firecrawlScrape({
    url: params.signupUrl,
    mobile: false,
    viewport: { width: 1440, height: 900 },
  });

  const scrapeId = initial.scrapeId;
  if (!scrapeId) {
    return {
      steps: [],
      finalStatus: "error",
      blockedReason: "Failed to get Firecrawl session ID",
    };
  }

  let currentHtml = initial.html;
  let currentUrl: string | null = params.signupUrl;
  let screenshotUrl = initial.screenshotUrl;

  // Track for stuck detection.
  const recentHashes: string[] = [];
  const previousActions: Array<{ action: string; reason: string }> = [];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (Date.now() - startTime > MAX_DURATION_MS) {
        finalStatus = "timeout";
        break;
      }

      // Download screenshot.
      let screenshotBytes: ArrayBuffer | null = null;
      if (screenshotUrl) {
        try {
          const dl = await downloadBytes(screenshotUrl);
          screenshotBytes = dl.bytes;
        } catch {
          // Non-fatal.
        }
      }

      // Simplify DOM.
      const simplified = simplifyDom(currentHtml);
      const simplifiedJson = JSON.stringify(simplified, null, 0);

      // Check for stuck loop.
      const hash = domHash(currentHtml);
      recentHashes.push(hash);
      if (recentHashes.length > 3) recentHashes.shift();
      if (recentHashes.length >= 3 && recentHashes.every((h) => h === recentHashes[0])) {
        steps.push({
          stepIdx: step,
          url: currentUrl,
          actionType: "blocked",
          actionDetail: { reason: "Stuck loop detected: same page 3 times" },
          durationMs: Date.now() - startTime,
          screenshotBytes,
          blockedReason: "stuck_loop",
        });
        finalStatus = "stuck";
        blockedReason = "Stuck loop: same page content 3 times in a row";
        break;
      }

      // Ask Claude what to do.
      if (!screenshotBytes) {
        // If we couldn't get a screenshot, try one more interact to get one.
        try {
          const snap = await firecrawlInteract({
            scrapeId,
            prompt: "Take a screenshot of the current page without clicking anything.",
          });
          currentHtml = snap.html || currentHtml;
          currentUrl = snap.url || currentUrl;
          if (snap.screenshotUrl) {
            const dl = await downloadBytes(snap.screenshotUrl);
            screenshotBytes = dl.bytes;
          }
        } catch {
          // Continue without screenshot.
        }
      }

      if (!screenshotBytes) {
        // Can't continue without visual input.
        finalStatus = "error";
        blockedReason = "No screenshot available";
        break;
      }

      const stepStart = Date.now();
      const decision = await askClaude({
        persona: params.persona,
        screenshotBytes,
        simplifiedDom: simplifiedJson,
        previousSteps: previousActions,
      });

      previousActions.push({ action: decision.action, reason: decision.reason });

      // Terminal actions.
      if (decision.action === "done") {
        steps.push({
          stepIdx: step,
          url: currentUrl,
          actionType: "done",
          actionDetail: { reason: decision.reason },
          durationMs: Date.now() - stepStart,
          screenshotBytes,
          blockedReason: null,
        });
        finalStatus = "done";
        break;
      }

      if (decision.action === "blocked") {
        steps.push({
          stepIdx: step,
          url: currentUrl,
          actionType: "blocked",
          actionDetail: { reason: decision.reason },
          durationMs: Date.now() - stepStart,
          screenshotBytes,
          blockedReason: decision.reason,
        });
        finalStatus = "blocked";
        blockedReason = decision.reason;
        break;
      }

      // Email verification: poll Mailosaur.
      if (decision.action === "email_verify") {
        steps.push({
          stepIdx: step,
          url: currentUrl,
          actionType: "email_verify",
          actionDetail: { reason: decision.reason },
          durationMs: Date.now() - stepStart,
          screenshotBytes,
          blockedReason: null,
        });

        const verification = await waitForVerificationEmail({
          email: params.persona.email,
          timeoutMs: 60_000,
        });

        if (!verification) {
          finalStatus = "blocked";
          blockedReason = "Email verification required but no email received within 60s";
          steps.push({
            stepIdx: step + 1,
            url: currentUrl,
            actionType: "blocked",
            actionDetail: { reason: "No verification email received" },
            durationMs: 60_000,
            screenshotBytes: null,
            blockedReason: "no_verification_email",
          });
          break;
        }

        if (verification.kind === "otp") {
          // Fill in the OTP code.
          try {
            const result = await firecrawlInteract({
              scrapeId,
              prompt: `Type the verification code "${verification.value}" into the code/OTP input field and submit.`,
            });
            currentHtml = result.html || currentHtml;
            currentUrl = result.url || currentUrl;
            screenshotUrl = result.screenshotUrl;
          } catch {
            finalStatus = "error";
            blockedReason = "Failed to enter OTP code";
            break;
          }
        } else {
          // Magic link: navigate to it.
          try {
            const result = await firecrawlInteract({
              scrapeId,
              prompt: `Navigate to this URL: ${verification.value}`,
            });
            currentHtml = result.html || currentHtml;
            currentUrl = result.url || currentUrl;
            screenshotUrl = result.screenshotUrl;
          } catch {
            finalStatus = "error";
            blockedReason = "Failed to follow magic link";
            break;
          }
        }
        continue;
      }

      // Wait action.
      if (decision.action === "wait") {
        steps.push({
          stepIdx: step,
          url: currentUrl,
          actionType: "wait",
          actionDetail: { reason: decision.reason },
          durationMs: 3000,
          screenshotBytes,
          blockedReason: null,
        });
        await new Promise((r) => setTimeout(r, 3000));

        // Re-observe the page.
        try {
          const snap = await firecrawlInteract({
            scrapeId,
            prompt: "Take a screenshot of the current page without clicking anything.",
          });
          currentHtml = snap.html || currentHtml;
          currentUrl = snap.url || currentUrl;
          screenshotUrl = snap.screenshotUrl;
        } catch {
          // Continue.
        }
        continue;
      }

      // Execute the action via Firecrawl interact.
      try {
        const result = await firecrawlInteract({
          scrapeId,
          prompt: decision.prompt,
        });

        steps.push({
          stepIdx: step,
          url: currentUrl,
          actionType: decision.action as OnboardingStepAction,
          actionDetail: {
            prompt: decision.prompt,
            value: decision.value,
            reason: decision.reason,
          },
          durationMs: Date.now() - stepStart,
          screenshotBytes,
          blockedReason: null,
        });

        currentHtml = result.html || currentHtml;
        currentUrl = result.url || currentUrl;
        screenshotUrl = result.screenshotUrl;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Interact failed";
        steps.push({
          stepIdx: step,
          url: currentUrl,
          actionType: decision.action as OnboardingStepAction,
          actionDetail: { prompt: decision.prompt, error: msg },
          durationMs: Date.now() - stepStart,
          screenshotBytes,
          blockedReason: null,
        });
        // Non-fatal: continue to next step (Claude might recover).
      }
    }

    if (finalStatus === "error" && steps.length >= MAX_STEPS) {
      finalStatus = "timeout";
      blockedReason = `Reached maximum ${MAX_STEPS} steps`;
    }
  } finally {
    // Always clean up the Firecrawl session.
    await firecrawlInteractStop(scrapeId);
  }

  return { steps, finalStatus, blockedReason };
}
