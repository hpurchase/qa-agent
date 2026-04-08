export type AuditRunStatus = "queued" | "running" | "done" | "failed";
export type AuditArtifactKind =
  | "html"
  | "markdown"
  | "screenshot_desktop"
  | "screenshot_mobile"
  | "pricing_html"
  | "pricing_markdown";
export type AuditFindingSource = "heuristic" | "llm";

export type AuditJobStatus = "queued" | "running" | "done" | "failed";

