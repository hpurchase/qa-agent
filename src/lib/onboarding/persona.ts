import crypto from "crypto";

export type TestPersona = {
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  email: string;
  password: string;
  website: string;
  role: string;
  companySize: string;
  phone: string;
  useCase: string;
};

function generatePassword(): string {
  // Meet common SaaS password rules deterministically:
  // - at least 12 chars
  // - includes lowercase, uppercase, number, and symbol
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$";
  const all = lower + upper + digits + symbols;

  const length = 16;
  const bytes = crypto.randomBytes(length);

  const out: string[] = [];
  // Ensure required character classes exist.
  out.push(lower[bytes[0] % lower.length]!);
  out.push(upper[bytes[1] % upper.length]!);
  out.push(digits[bytes[2] % digits.length]!);
  out.push(symbols[bytes[3] % symbols.length]!);

  for (let i = 4; i < length; i++) {
    out.push(all[bytes[i] % all.length]!);
  }

  // Shuffle to avoid predictable prefix.
  for (let i = out.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }

  return out.join("");
}

export function buildTestPersona(runId: string): TestPersona {
  const serverId = process.env.MAILOSAUR_SERVER_ID ?? "MISSING";
  const shortId = runId.replace(/-/g, "").slice(0, 8);

  return {
    firstName: "Jordan",
    lastName: "Rivera",
    fullName: "Jordan Rivera",
    company: "Northlight Labs",
    email: `jordan+${shortId}@${serverId}.mailosaur.net`,
    password: generatePassword(),
    website: "northlightlabs.com",
    role: "Product Manager",
    companySize: "11-50",
    phone: "+15550123456",
    useCase: "Evaluating tools for our product team",
  };
}
