import Anthropic from "@anthropic-ai/sdk";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

export function anthropicClient() {
  return new Anthropic({ apiKey: requiredEnv("ANTHROPIC_API_KEY") });
}

export function anthropicModel() {
  return process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";
}

