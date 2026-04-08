type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: { scrapeId?: string };
    actions?: { screenshots?: string[] };
  };
  error?: string;
};

type FirecrawlMapResponse = {
  success?: boolean;
  links?: Array<{ url: string; title?: string; description?: string } | string>;
  error?: string;
};

type FirecrawlInteractResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: { url?: string; scrapeId?: string };
    actions?: { screenshots?: string[] };
  };
  error?: string;
};

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function firecrawlHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${requiredEnv("FIRECRAWL_API_KEY")}`,
  };
}

export async function firecrawlScrape(params: {
  url: string;
  mobile: boolean;
  viewport: { width: number; height: number };
}) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: firecrawlHeaders(),
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
  const scrapeId = json.data?.metadata?.scrapeId ?? null;

  return { html, markdown, screenshotUrl, scrapeId };
}

export async function firecrawlMap(params: {
  url: string;
  limit?: number;
  includeSubdomains?: boolean;
}): Promise<string[]> {
  const res = await fetch("https://api.firecrawl.dev/v2/map", {
    method: "POST",
    headers: firecrawlHeaders(),
    body: JSON.stringify({
      url: params.url,
      limit: params.limit ?? 100,
      includeSubdomains: params.includeSubdomains ?? true,
      ignoreQueryParameters: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl map error: ${res.status} ${res.statusText} ${text}`);
  }

  const json = (await res.json()) as FirecrawlMapResponse;
  if (json.success === false) throw new Error(json.error || "Firecrawl map failed");

  return (json.links ?? []).map((l) => (typeof l === "string" ? l : l.url));
}

export async function firecrawlInteract(params: {
  scrapeId: string;
  prompt: string;
}): Promise<{ url: string | null; html: string; screenshotUrl: string | null }> {
  const res = await fetch(
    `https://api.firecrawl.dev/v2/scrape/${params.scrapeId}/interact`,
    {
      method: "POST",
      headers: firecrawlHeaders(),
      body: JSON.stringify({ prompt: params.prompt }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl interact error: ${res.status} ${res.statusText} ${text}`);
  }

  const json = (await res.json()) as FirecrawlInteractResponse;
  if (json.success === false) throw new Error(json.error || "Firecrawl interact failed");

  return {
    url: json.data?.metadata?.url ?? null,
    html: json.data?.html ?? "",
    screenshotUrl: json.data?.actions?.screenshots?.[0] ?? null,
  };
}

export async function firecrawlInteractStop(scrapeId: string) {
  await fetch(`https://api.firecrawl.dev/v2/scrape/${scrapeId}/interact`, {
    method: "DELETE",
    headers: firecrawlHeaders(),
  }).catch(() => {});
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
