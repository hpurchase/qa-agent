import { NextResponse } from "next/server";
import { createAuditRun } from "@/lib/db/auditRuns";
import { enqueueAuditJob } from "@/lib/db/auditJobs";
import { validatePublicHttpUrl } from "@/lib/url";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { url?: string } | null;
    const rawUrl = body?.url;
    if (!rawUrl) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const normalizedUrl = await validatePublicHttpUrl(rawUrl);
    const { id } = await createAuditRun({ url: rawUrl, normalizedUrl });

    await enqueueAuditJob({ auditRunId: id, jobType: "cro_audit" });
    await enqueueAuditJob({ auditRunId: id, jobType: "onboarding_audit" });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

