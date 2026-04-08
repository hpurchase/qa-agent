function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

type MailosaurMessage = {
  id: string;
  subject?: string;
  text?: { body?: string };
  html?: { body?: string; links?: Array<{ href?: string }> };
};

type MailosaurSearchResponse = {
  items?: MailosaurMessage[];
};

export type VerificationResult = {
  kind: "otp" | "magic_link";
  value: string;
};

const OTP_RE = /\b(\d{4,8})\b/;
const MAGIC_LINK_RE = /https?:\/\/\S+/g;

function extractOtp(text: string): string | null {
  const match = text.match(OTP_RE);
  return match ? match[1] : null;
}

function extractMagicLink(html: string, links: Array<{ href?: string }>): string | null {
  for (const link of links) {
    const href = link.href ?? "";
    if (/verify|confirm|magic|token|activate|auth|callback/i.test(href)) {
      return href;
    }
  }
  const allLinks = html.match(MAGIC_LINK_RE) ?? [];
  for (const url of allLinks) {
    if (/verify|confirm|magic|token|activate|auth|callback/i.test(url)) {
      return url;
    }
  }
  return allLinks[0] ?? null;
}

/**
 * Polls Mailosaur for a verification email sent to the given address.
 * Returns an OTP code or magic link, or null if nothing arrives in time.
 */
export async function waitForVerificationEmail(params: {
  email: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<VerificationResult | null> {
  const apiKey = requiredEnv("MAILOSAUR_API_KEY");
  const serverId = requiredEnv("MAILOSAUR_SERVER_ID");
  const timeout = params.timeoutMs ?? 60_000;
  const interval = params.pollIntervalMs ?? 5_000;

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const res = await fetch(
      `https://mailosaur.com/api/messages/search/${serverId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        },
        body: JSON.stringify({
          sentTo: params.email,
          match: "ALL",
          timeout: 0,
        }),
      },
    );

    if (res.ok) {
      const json = (await res.json()) as MailosaurSearchResponse;
      const msg = json.items?.[0];
      if (msg) {
        const textBody = msg.text?.body ?? "";
        const htmlBody = msg.html?.body ?? "";
        const links = msg.html?.links ?? [];

        const otp = extractOtp(textBody) ?? extractOtp(htmlBody);
        if (otp) return { kind: "otp", value: otp };

        const magicLink = extractMagicLink(htmlBody, links);
        if (magicLink) return { kind: "magic_link", value: magicLink };
      }
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  return null;
}
