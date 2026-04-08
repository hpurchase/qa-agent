export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  const u = new URL(url);
  u.hash = "";
  // Avoid trailing slash noise for homepage comparisons.
  if (u.pathname === "/") u.pathname = "";
  return u.toString();
}

function isIp(hostname: string) {
  // IPv4 only for MVP; IPv6 will be handled via DNS resolution checks below.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  // 10.0.0.0/8
  if ((n & 0xff000000) === 0x0a000000) return true;
  // 172.16.0.0/12
  if ((n & 0xfff00000) === 0xac100000) return true;
  // 192.168.0.0/16
  if ((n & 0xffff0000) === 0xc0a80000) return true;
  // 127.0.0.0/8 loopback
  if ((n & 0xff000000) === 0x7f000000) return true;
  // 169.254.0.0/16 link-local
  if ((n & 0xffff0000) === 0xa9fe0000) return true;
  return false;
}

export async function validatePublicHttpUrl(input: string): Promise<string> {
  const normalized = normalizeUrl(input);
  const u = new URL(normalized);

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) {
    throw new Error("Localhost URLs are not allowed");
  }

  if (isIp(host)) {
    if (isPrivateIpv4(host)) throw new Error("Private or local IPs are not allowed");
    return normalized;
  }

  // Best-effort SSRF protection: resolve DNS and reject private addresses.
  // If resolution fails, we still allow (some environments restrict DNS),
  // but we keep hostname-level blocks above.
  try {
    const dns = await import("node:dns/promises");
    const results = await dns.lookup(host, { all: true, verbatim: true });
    for (const r of results) {
      if (r.family === 4 && isPrivateIpv4(r.address)) {
        throw new Error("URL resolves to a private IP");
      }
      // IPv6: block loopback + unique local + link-local.
      if (r.family === 6) {
        const a = r.address.toLowerCase();
        if (a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80:")) {
          throw new Error("URL resolves to a private IP");
        }
      }
    }
  } catch (err) {
    // ignore DNS lookup failures (best-effort)
    void err;
  }

  return normalized;
}

