import type { CroFinding } from "@/lib/cro/heuristics";

export type AuditGrade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";

export type AuditScores = {
  croScore: number; // 0-100
  onboardingScore: number; // 0-100
  overall: number; // 0-100
  grade: AuditGrade;
  highCount: number;
  medCount: number;
  lowCount: number;
};

const SEVERITY_PENALTY: Record<string, number> = {
  high: 15,
  med: 8,
  low: 3,
};

function gradeFromScore(score: number): AuditGrade {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  if (score >= 55) return "C+";
  if (score >= 45) return "C";
  if (score >= 30) return "D";
  return "F";
}

export function computeCroScore(findings: CroFinding[]): number {
  let score = 100;
  for (const f of findings) {
    score -= SEVERITY_PENALTY[f.severity] ?? 5;
  }
  return Math.max(0, Math.min(100, score));
}

export type OnboardingInput = {
  stepCount: number;
  formFieldCount: number;
  frictionFlags: string[];
  finalStatus: string; // "done" | "blocked" | "failed" | "timeout" | etc.
  estimatedTimeToValueMs: number;
};

export function computeOnboardingScore(input: OnboardingInput): number {
  let score = 100;

  // Penalize high step counts (ideal: 3-5 steps)
  if (input.stepCount > 8) score -= 20;
  else if (input.stepCount > 5) score -= 10;
  else if (input.stepCount > 3) score -= 5;

  // Penalize form field count (ideal: 1-2)
  if (input.formFieldCount > 6) score -= 20;
  else if (input.formFieldCount > 4) score -= 12;
  else if (input.formFieldCount > 2) score -= 5;

  // Penalize each friction flag
  score -= input.frictionFlags.length * 8;

  // Penalize slow time to value (ideal: < 60s)
  const seconds = input.estimatedTimeToValueMs / 1000;
  if (seconds > 180) score -= 15;
  else if (seconds > 120) score -= 10;
  else if (seconds > 60) score -= 5;

  // Penalize non-completion
  if (input.finalStatus === "blocked") score -= 15;
  else if (input.finalStatus === "failed" || input.finalStatus === "timeout") score -= 25;

  return Math.max(0, Math.min(100, score));
}

export function computeAuditScores(
  findings: CroFinding[],
  onboarding: OnboardingInput | null,
): AuditScores {
  const croScore = computeCroScore(findings);
  const onboardingScore = onboarding ? computeOnboardingScore(onboarding) : -1;

  const overall =
    onboardingScore >= 0
      ? Math.round(croScore * 0.6 + onboardingScore * 0.4)
      : croScore;

  return {
    croScore,
    onboardingScore,
    overall,
    grade: gradeFromScore(overall),
    highCount: findings.filter((f) => f.severity === "high").length,
    medCount: findings.filter((f) => f.severity === "med").length,
    lowCount: findings.filter((f) => f.severity === "low").length,
  };
}

export function gradeColor(grade: AuditGrade): { text: string; bg: string; ring: string } {
  switch (grade) {
    case "A+":
    case "A":
      return { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950", ring: "stroke-emerald-500" };
    case "B+":
    case "B":
      return { text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950", ring: "stroke-blue-500" };
    case "C+":
    case "C":
      return { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950", ring: "stroke-amber-500" };
    default:
      return { text: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950", ring: "stroke-red-500" };
  }
}
