type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    actions?: { screenshots?: string[] };
  };
  error?: string;
};

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

export async function firecrawlScrape(params: {
  url: string;
  mobile: boolean;
  viewport: { width: number; height: number };
}) {
  const apiKey = requiredEnv("FIRECRAWL_API_KEY");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url: params.url,
      mobile: params.mobile,
      formats: ["markdown", "html"],
      onlyMainContent: false,
      actions: [
        {
          type: "screenshot",
          fullPage: true,
          quality: 90,
          viewport: params.viewport,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl error: ${res.status} ${res.statusText} ${text}`);
  }

  const json = (await res.json()) as FirecrawlScrapeResponse;
  if (json.success === false) {
    throw new Error(json.error || "Firecrawl scrape failed");
  }

  const html = json.data?.html ?? "";
  const markdown = json.data?.markdown ?? "";
  const screenshotUrl = json.data?.actions?.screenshots?.[0] ?? null;

  return { html, markdown, screenshotUrl };
}

export async function downloadBytes(url: string): Promise<{
  bytes: ArrayBuffer;
  contentType: string;
}> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const bytes = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes, contentType };
}

