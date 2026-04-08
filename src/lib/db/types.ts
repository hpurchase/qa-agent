export type AuditRunStatus = "queued" | "running" | "done" | "failed";
export type OnboardingStatus = "pending" | "running" | "done" | "failed" | "blocked";
export type AuditArtifactKind =
  | "html"
  | "markdown"
  | "screenshot_desktop"
  | "screenshot_mobile"
  | "pricing_html"
  | "pricing_markdown"
  | "onboarding_screenshot"
  | "onboarding_summary";
export type AuditFindingSource = "heuristic" | "llm";
export type AuditJobStatus = "queued" | "running" | "done" | "failed";
export type AuditJobType = "cro_audit" | "onboarding_audit";
export type AuditTargetRole = "homepage" | "pricing" | "signup" | "unknown";
export type AuditTargetStatus = "queued" | "running" | "done" | "failed" | "skipped";

export type OnboardingStepAction =
  | "fill"
  | "click"
  | "select"
  | "check"
  | "wait"
  | "skip"
  | "email_verify"
  | "done"
  | "blocked"
  | "screenshot";
