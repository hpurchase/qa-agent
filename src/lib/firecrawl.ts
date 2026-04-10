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
  output?: string;
  result?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
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

/** Fetch with an AbortController timeout. */
function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 60_000, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...fetchInit, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/** Retry a function with exponential backoff. */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 2_000, label = "operation" } = opts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isTimeout =
        err instanceof DOMException && err.name === "AbortError";
      const isTransient =
        isTimeout ||
        (err instanceof Error &&
          /ECONNRESET|ETIMEDOUT|socket hang up|network|fetch failed|502|503|429/i.test(
            err.message,
          ));
      if (!isTransient || attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[firecrawl] ${label} attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms: ${err instanceof Error ? err.message : err}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export async function firecrawlScrape(params: {
  url: string;
  mobile: boolean;
  viewport: { width: number; height: number };
  takeScreenshot?: boolean;
}) {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: firecrawlHeaders(),
        timeoutMs: 90_000,
        body: JSON.stringify({
          url: params.url,
          mobile: params.mobile,
          formats: ["markdown", "html"],
          onlyMainContent: false,
          actions: params.takeScreenshot
            ? [
                {
                  type: "screenshot",
                  fullPage: true,
                  quality: 90,
                  viewport: params.viewport,
                },
              ]
            : [],
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
    },
    { maxAttempts: 2, label: `scrape ${params.url}` },
  );
}

export async function firecrawlMap(params: {
  url: string;
  limit?: number;
  includeSubdomains?: boolean;
}): Promise<string[]> {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout("https://api.firecrawl.dev/v2/map", {
        method: "POST",
        headers: firecrawlHeaders(),
        timeoutMs: 30_000,
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
    },
    { maxAttempts: 2, label: `map ${params.url}` },
  );
}

export async function firecrawlInteract(params: {
  scrapeId: string;
  prompt: string;
}): Promise<{ output: string | null }> {
  const res = await fetchWithTimeout(
    `https://api.firecrawl.dev/v2/scrape/${params.scrapeId}/interact`,
    {
      method: "POST",
      headers: firecrawlHeaders(),
      timeoutMs: 45_000,
      body: JSON.stringify({ prompt: params.prompt }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl interact error: ${res.status} ${res.statusText} ${text}`);
  }

  const json = (await res.json()) as FirecrawlInteractResponse;
  if (json.success === false) throw new Error(json.error || "Firecrawl interact failed");

  return { output: json.output ?? null };
}

export type InteractCodeResult = {
  result: string | null;
  stdout: string | null;
  exitCode: number;
};

/**
 * Execute Playwright code in an existing Firecrawl session.
 * Returns the code's result/stdout and exit code.
 */
export async function firecrawlInteractCode(params: {
  scrapeId: string;
  code: string;
}): Promise<InteractCodeResult> {
  const res = await fetchWithTimeout(
    `https://api.firecrawl.dev/v2/scrape/${params.scrapeId}/interact`,
    {
      method: "POST",
      headers: firecrawlHeaders(),
      timeoutMs: 30_000,
      body: JSON.stringify({ code: params.code }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl interact code error: ${res.status} ${res.statusText} ${text}`);
  }

  const json = (await res.json()) as FirecrawlInteractResponse;
  if (json.success === false) throw new Error(json.error || "Firecrawl interact code failed");

  return {
    result: json.result ?? null,
    stdout: json.stdout ?? null,
    exitCode: json.exitCode ?? 0,
  };
}

export async function firecrawlInteractStop(scrapeId: string) {
  await fetchWithTimeout(`https://api.firecrawl.dev/v2/scrape/${scrapeId}/interact`, {
    method: "DELETE",
    headers: firecrawlHeaders(),
    timeoutMs: 10_000,
  }).catch(() => {});
}

export async function downloadBytes(url: string): Promise<{
  bytes: ArrayBuffer;
  contentType: string;
}> {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(url, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      const bytes = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      return { bytes, contentType };
    },
    { maxAttempts: 2, label: `download ${url.slice(0, 80)}` },
  );
}

/** Probe if a URL exists (HEAD then GET fallback). Bounded by timeout. */
export async function probeUrlExists(url: string, timeoutMs = 10_000): Promise<boolean> {
  try {
    const head = await fetchWithTimeout(url, { method: "HEAD", redirect: "manual", timeoutMs });
    if (head.status > 0 && head.status < 400) return true;
    if (head.status === 405 || head.status === 403 || head.status === 0) {
      const get = await fetchWithTimeout(url, { method: "GET", redirect: "manual", timeoutMs });
      return get.status > 0 && get.status < 400;
    }
    return false;
  } catch {
    try {
      const get = await fetchWithTimeout(url, { method: "GET", redirect: "manual", timeoutMs });
      return get.status > 0 && get.status < 400;
    } catch {
      return false;
    }
  }
}
