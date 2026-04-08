import { firecrawlScrape, firecrawlInteract, firecrawlInteractCode, firecrawlInteractStop } from "@/lib/firecrawl";
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

const MAX_STEPS = 10;
const MAX_DURATION_MS = 3 * 60 * 1000;

type ClaudeDecision = {
  action: OnboardingStepAction;
  instruction: string;
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
    "You are an automated QA bot signing up for a SaaS product.",
    "",
    "You are signing up as:",
    `- First name: ${persona.firstName}`,
    `- Last name: ${persona.lastName}`,
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
    "1. Perform ONE action per response.",
    "2. The 'instruction' field must be a plain-English command that a browser agent can execute, e.g.:",
    `   - "Type '${persona.firstName}' into the First Name field"`,
    `   - "Type '${persona.email}' into the Email input"`,
    "   - \"Click the 'Sign Up' button\"",
    "   - \"Select '11-50' from the Company Size dropdown\"",
    "   - \"Check the 'I agree to the Terms' checkbox\"",
    "   - \"Click the 'Skip' link\"",
    `2b. If you see a password field, fill it with "${persona.password}" (unless already filled).`,
    "3. Always agree to terms and conditions.",
    "4. Skip optional steps (invite teammates, add avatar) by clicking Skip/Later/Not now.",
    "5. If you see a CAPTCHA or hCaptcha, return action=blocked.",
    "6. If you see a payment form or Stripe, return action=blocked.",
    "7. If only OAuth/SSO login is available (no email+password), return action=blocked.",
    "8. If you see 'check your email' / 'verify your email' / 'enter code', return action=email_verify.",
    "9. When you reach a dashboard or app home screen, return action=done.",
    "10. If the page is loading, return action=wait.",
    "",
    "Return ONLY valid JSON:",
    '{"action":"fill|click|select|check|wait|skip|email_verify|done|blocked","instruction":"plain English command for the browser","reason":"brief explanation of what you see"}',
  ].join("\n");
}

async function askClaude(params: {
  persona: TestPersona;
  screenshotBytes: ArrayBuffer | null;
  simplifiedDom: string;
  previousSteps: Array<{ action: string; instruction: string; reason: string }>;
}): Promise<ClaudeDecision> {
  const client = anthropicClient();
  const model = anthropicModel();

  const content: MessageParam["content"] = [];

  if (params.screenshotBytes) {
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
  }

  let historyContext = "";
  if (params.previousSteps.length > 0) {
    const recent = params.previousSteps.slice(-5);
    historyContext =
      "\n\nPrevious actions taken:\n" +
      recent.map((s, i) => `${i + 1}. ${s.action}: ${s.instruction || ""} (${s.reason})`).join("\n") +
      "\n";
  }

  content.push({
    type: "text",
    text: [
      "Visible interactive elements on the page:",
      "```json",
      params.simplifiedDom,
      "```",
      historyContext,
      "What is the next single action to take? Return JSON only.",
    ].join("\n"),
  });

  const msg = await client.messages.create({
    model,
    max_tokens: 400,
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
    return JSON.parse(clean) as ClaudeDecision;
  } catch {
    return {
      action: "blocked",
      instruction: "",
      reason: `Failed to parse Claude response: ${text.slice(0, 200)}`,
    };
  }
}

async function askClaudeRecovery(params: {
  persona: TestPersona;
  screenshotBytes: ArrayBuffer | null;
  simplifiedDom: string;
  previousSteps: Array<{ action: string; instruction: string; reason: string }>;
  stuckReason: string;
}): Promise<ClaudeDecision> {
  const client = anthropicClient();
  const model = anthropicModel();

  const content: MessageParam["content"] = [];
  if (params.screenshotBytes) {
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
  }

  const recent = params.previousSteps.slice(-6);
  const last = recent[recent.length - 1];

  content.push({
    type: "text",
    text: [
      "We are stuck in the signup flow.",
      `Stuck reason: ${params.stuckReason}`,
      "",
      "Visible interactive elements on the page:",
      "```json",
      params.simplifiedDom,
      "```",
      "",
      "Recent actions:",
      ...recent.map((s, i) => `${i + 1}. ${s.action} | ${s.instruction} | ${s.reason}`),
      "",
      "RECOVERY RULES:",
      "1) Do NOT repeat the last instruction verbatim.",
      "2) Prefer the smallest plausible unblocker: fill missing required field (often password), click primary submit/continue, scroll to reveal submit, dismiss modal, accept terms, or go back one step if needed.",
      "3) Return ONE action only, as JSON in the normal format.",
      last?.instruction ? `Last instruction (do not repeat): ${last.instruction}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const msg = await client.messages.create({
    model,
    max_tokens: 450,
    temperature: 0.2,
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
    return JSON.parse(clean) as ClaudeDecision;
  } catch {
    return {
      action: "wait",
      instruction: "Wait 2 seconds for the page to finish loading.",
      reason: `Recovery parse failed: ${text.slice(0, 200)}`,
    };
  }
}

/**
 * Capture the current page URL and HTML via a lightweight code exec call.
 * Keeps the response small (no screenshot in this call).
 */
async function capturePageInfo(scrapeId: string): Promise<{ html: string; url: string }> {
  try {
    const result = await firecrawlInteractCode({
      scrapeId,
      code: `
        await page.waitForLoadState('domcontentloaded');
        JSON.stringify({ url: page.url(), html: (await page.content()).substring(0, 30000) });
      `,
    });
    const raw = result.result ?? result.stdout ?? "";
    const parsed = JSON.parse(raw) as { url?: string; html?: string };
    return { html: parsed.html ?? "", url: parsed.url ?? "" };
  } catch {
    return { html: "", url: "" };
  }
}

/**
 * Capture a viewport-only screenshot (not full page) via code exec.
 * Returns base64 JPEG, kept small (~50-150KB).
 */
async function captureScreenshot(scrapeId: string): Promise<ArrayBuffer | null> {
  try {
    const result = await firecrawlInteractCode({
      scrapeId,
      code: `(await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false })).toString('base64');`,
    });
    const b64 = result.result ?? result.stdout ?? "";
    if (!b64 || b64.length < 100) return null;
    const clean = b64.replace(/^["']|["']$/g, "").trim();
    const buf = Buffer.from(clean, "base64");
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return ab;
  } catch {
    return null;
  }
}

type FormInputState = {
  type: string;
  name: string | null;
  id: string | null;
  required: boolean;
  autocomplete: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  valueLength: number;
};

type PasswordState = {
  count: number;
  anyEmpty: boolean;
  allEqual: boolean;
};

async function captureFormState(
  scrapeId: string,
): Promise<{ inputs: FormInputState[]; password: PasswordState }> {
  try {
    const result = await firecrawlInteractCode({
      scrapeId,
      code: `
        const inputs = await page.$$eval('input', (els) => {
          return els.slice(0, 80).map((el) => {
            const i = el;
            const type = (i.getAttribute('type') || 'text').toLowerCase();
            const style = window.getComputedStyle(i);
            const visible =
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              (i.offsetWidth > 0 || i.offsetHeight > 0);
            if (!visible) return null;
            return {
              type,
              name: i.getAttribute('name'),
              id: i.getAttribute('id'),
              required: i.hasAttribute('required') || i.getAttribute('aria-required') === 'true',
              autocomplete: i.getAttribute('autocomplete'),
              placeholder: i.getAttribute('placeholder'),
              ariaLabel: i.getAttribute('aria-label'),
              valueLength: (i.value || '').length
            };
          }).filter(Boolean);
        });
        const pwValues = inputs
          .filter((i) => i.type === 'password')
          .map((i) => i.valueLength);
        // We can't return the actual password values (sensitive), but we can detect "empty" and
        // whether all password fields appear consistent by comparing DOM input values internally.
        const pwDomValues = Array.from(document.querySelectorAll('input[type="password"]'))
          .map((el) => (el && (el).value) || '')
          .filter((v) => v !== null);
        const pwCount = pwDomValues.length;
        const anyEmpty = pwDomValues.some((v) => !v || v.length === 0);
        const allEqual = pwDomValues.every((v) => v === pwDomValues[0]);
        JSON.stringify({ inputs, password: { count: pwCount, anyEmpty, allEqual } });
      `,
    });
    const raw = result.result ?? result.stdout ?? "";
    const parsed = JSON.parse(raw) as { inputs?: FormInputState[]; password?: PasswordState };
    return {
      inputs: Array.isArray(parsed.inputs) ? parsed.inputs : [],
      password: {
        count: Number(parsed.password?.count ?? 0),
        anyEmpty: Boolean(parsed.password?.anyEmpty ?? false),
        allEqual: Boolean(parsed.password?.allEqual ?? true),
      },
    };
  } catch {
    return { inputs: [], password: { count: 0, anyEmpty: false, allEqual: true } };
  }
}

async function fillAllVisiblePasswordInputs(params: {
  scrapeId: string;
  password: string;
}): Promise<{ ok: boolean; filledCount: number }> {
  try {
    const result = await firecrawlInteractCode({
      scrapeId: params.scrapeId,
      code: `
        const pw = ${JSON.stringify(params.password)};
        const handles = await page.$$('input[type="password"]');
        let filled = 0;
        for (const h of handles) {
          const box = await h.boundingBox();
          if (!box || box.width < 2 || box.height < 2) continue;
          try {
            await h.scrollIntoViewIfNeeded();
          } catch {}
          try {
            await h.fill(pw);
            filled++;
          } catch {}
        }
        JSON.stringify({ ok: true, filledCount: filled });
      `,
    });
    const raw = result.result ?? result.stdout ?? "";
    const parsed = JSON.parse(raw) as { ok?: boolean; filledCount?: number };
    return { ok: Boolean(parsed.ok), filledCount: Number(parsed.filledCount ?? 0) };
  } catch {
    return { ok: false, filledCount: 0 };
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

  // Initial scrape to open the page and get a session ID.
  const initial = await firecrawlScrape({
    url: params.signupUrl,
    mobile: false,
    viewport: { width: 1440, height: 900 },
    takeScreenshot: false,
  });

  const scrapeId = initial.scrapeId;
  if (!scrapeId) {
    return {
      steps: [],
      finalStatus: "error",
      blockedReason: "Failed to get Firecrawl session ID",
    };
  }

  const recentHashes: string[] = [];
  const previousActions: Array<{ action: string; instruction: string; reason: string }> = [];
  let consecutiveFailures = 0;
  let recoveryAttempts = 0;
  const recentActionKeys: string[] = [];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (Date.now() - startTime > MAX_DURATION_MS) {
        finalStatus = "timeout";
        blockedReason = `Exceeded ${MAX_DURATION_MS / 1000}s time limit`;
        break;
      }

      // 1. Capture page info (URL + HTML) -- lightweight call.
      const pageInfo = await capturePageInfo(scrapeId);

      // 2. Capture viewport screenshot -- separate call, small payload.
      const screenshotBytes = await captureScreenshot(scrapeId);

      // 3. Capture lightweight form state (helps with password fields).
      const formState = await captureFormState(scrapeId);

      // 4. Simplify DOM for Claude.
      const simplified = simplifyDom(pageInfo.html);
      const simplifiedJson = JSON.stringify({ elements: simplified, form: formState }, null, 0);

      // 5. If a password field exists and appears empty, proactively fill it.
      const hasPassword = formState.inputs.some((i) => i.type === "password") || formState.password.count > 0;
      const emptyPassword =
        formState.inputs.some((i) => i.type === "password" && i.valueLength === 0) || formState.password.anyEmpty;
      const recentlyTriedPassword = previousActions
        .slice(-3)
        .some((a) => (a.instruction || "").toLowerCase().includes("password"));

      // If there are multiple password fields (confirm password), ensure they match.
      const needsPasswordSync = formState.password.count >= 2 && (!formState.password.allEqual || formState.password.anyEmpty);

      if (hasPassword && (emptyPassword || needsPasswordSync) && !recentlyTriedPassword) {
        const stepStart = Date.now();
        try {
          // Use deterministic code fill so password + confirm can't diverge.
          const filled = await fillAllVisiblePasswordInputs({ scrapeId, password: params.persona.password });
          const output =
            filled.ok
              ? `Filled ${filled.filledCount} password input(s) via code.`
              : "Attempted to fill password inputs via code, but it may not have applied.";
          steps.push({
            stepIdx: step,
            url: pageInfo.url,
            actionType: "fill",
            actionDetail: { instruction: "Auto-fill password", output },
            durationMs: Date.now() - stepStart,
            screenshotBytes,
            blockedReason: null,
          });
          previousActions.push({
            action: "fill",
            instruction: "Auto-fill password",
            reason: "Detected empty password field; filled deterministically",
          });
          continue;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Password fill failed";
          steps.push({
            stepIdx: step,
            url: pageInfo.url,
            actionType: "fill",
            actionDetail: { instruction: "Auto-fill password", error: errMsg },
            durationMs: Date.now() - stepStart,
            screenshotBytes,
            blockedReason: null,
          });
          previousActions.push({
            action: "fill",
            instruction: "Auto-fill password",
            reason: `Password autofill failed: ${errMsg}`,
          });
          // fall through to Claude decision
        }
      }

      // 6. Stuck loop detection.
      const hash = domHash(pageInfo.html || "empty");
      recentHashes.push(hash);
      if (recentHashes.length > 3) recentHashes.shift();

      // 7. Ask Claude what to do next.
      const stepStart = Date.now();
      let decision = await askClaude({
        persona: params.persona,
        screenshotBytes,
        simplifiedDom: simplifiedJson,
        previousSteps: previousActions,
      });

      previousActions.push({
        action: decision.action,
        instruction: decision.instruction,
        reason: decision.reason,
      });

      const actionKey = `${decision.action}|${decision.instruction}`.slice(0, 300);
      recentActionKeys.push(actionKey);
      if (recentActionKeys.length > 3) recentActionKeys.shift();

      // If we appear to be stuck (same DOM + repeated action),
      // ask Claude to "step back" and choose a different unblocker action.
      if (
        recentHashes.length >= 3 &&
        recentHashes.every((h) => h === recentHashes[0]) &&
        recentActionKeys.length >= 2 &&
        recentActionKeys[recentActionKeys.length - 1] === recentActionKeys[recentActionKeys.length - 2] &&
        recoveryAttempts < 2
      ) {
        recoveryAttempts++;
        const recovery = await askClaudeRecovery({
          persona: params.persona,
          screenshotBytes,
          simplifiedDom: simplifiedJson,
          previousSteps: previousActions,
          stuckReason: "Same page content and repeated action without progress",
        });
        decision = recovery;
        previousActions.push({
          action: decision.action,
          instruction: decision.instruction,
          reason: `RECOVERY: ${decision.reason}`,
        });
      }

      // --- Terminal actions ---

      if (decision.action === "done") {
        steps.push({
          stepIdx: step,
          url: pageInfo.url,
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
          url: pageInfo.url,
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

      // --- Email verification ---

      if (decision.action === "email_verify") {
        steps.push({
          stepIdx: step,
          url: pageInfo.url,
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
          break;
        }

        // Use prompt mode to enter the OTP or navigate to the magic link.
        if (verification.kind === "otp") {
          await firecrawlInteract({
            scrapeId,
            prompt: `Type the verification code "${verification.value}" into the code input field and click the submit/verify button.`,
          });
        } else {
          await firecrawlInteractCode({
            scrapeId,
            code: `await page.goto('${verification.value.replace(/'/g, "\\'")}'); await page.waitForLoadState('networkidle'); 'navigated';`,
          });
        }
        continue;
      }

      // --- Wait ---

      if (decision.action === "wait") {
        steps.push({
          stepIdx: step,
          url: pageInfo.url,
          actionType: "wait",
          actionDetail: { reason: decision.reason },
          durationMs: 3000,
          screenshotBytes,
          blockedReason: null,
        });
        await firecrawlInteractCode({
          scrapeId,
          code: "await page.waitForTimeout(3000); 'waited';",
        });
        continue;
      }

      // --- Execute action via Firecrawl prompt mode ---
      // Claude provides a natural language instruction; Firecrawl's AI agent
      // sees the real browser and executes it (finds elements, clicks, types).

      const instruction = decision.instruction || decision.reason;

      try {
        const { output } = await firecrawlInteract({ scrapeId, prompt: instruction });
        consecutiveFailures = 0;
        steps.push({
          stepIdx: step,
          url: pageInfo.url,
          actionType: decision.action as OnboardingStepAction,
          actionDetail: { instruction, reason: decision.reason, output },
          durationMs: Date.now() - stepStart,
          screenshotBytes,
          blockedReason: null,
        });
      } catch (err) {
        consecutiveFailures++;
        const errMsg = err instanceof Error ? err.message : "Interact failed";
        steps.push({
          stepIdx: step,
          url: pageInfo.url,
          actionType: decision.action as OnboardingStepAction,
          actionDetail: { instruction, reason: decision.reason, error: errMsg },
          durationMs: Date.now() - stepStart,
          screenshotBytes,
          blockedReason: null,
        });
        if (consecutiveFailures >= 3) {
          finalStatus = "error";
          blockedReason = `3 consecutive action failures. Last: ${errMsg}`;
          break;
        }
        continue;
      }
    }

    if (finalStatus === "error" && !blockedReason && steps.length >= MAX_STEPS) {
      finalStatus = "timeout";
      blockedReason = `Reached maximum ${MAX_STEPS} steps`;
    }
  } finally {
    await firecrawlInteractStop(scrapeId);
  }

  return { steps, finalStatus, blockedReason };
}
