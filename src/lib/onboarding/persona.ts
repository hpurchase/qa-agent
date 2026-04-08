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
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$";
  const bytes = crypto.randomBytes(20);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
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
