// Outbound-request guard. mobile.do fetches user-supplied URLs (sites to convert,
// custom LLM base URLs), so every hop is checked against private address space.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      /^f[cd]/.test(lower) || // unique local fc00::/7
      /^fe[89ab]/.test(lower) || // link local fe80::/10
      /^ff/.test(lower) // multicast
    );
  }
  return true;
}

/** Private targets are allowed in local dev or when the operator opts in. */
export function privateNetworkAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_NETWORK === "true" || process.env.NODE_ENV === "development";
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http(s) URLs are supported");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  if (privateNetworkAllowed()) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("Private hosts are not allowed");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new UnsafeUrlError(`Could not resolve ${host}`);
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new UnsafeUrlError("Private or internal network addresses are not allowed");
  }
  return url;
}

/** fetch() that re-validates every redirect hop and caps body size. */
export async function safeFetchText(
  raw: string,
  { maxBytes = 3_000_000, timeoutMs = 15_000, maxRedirects = 5 } = {},
): Promise<{ url: string; status: number; contentType: string; body: string }> {
  let current = raw;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Mobile Safari/537.36 mobile.do",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en;q=0.9,*;q=0.5",
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        chunks.push(value);
        if (size >= maxBytes) {
          await reader.cancel();
          break;
        }
      }
    }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    return { url: url.toString(), status: res.status, contentType, body };
  }
  throw new UnsafeUrlError("Too many redirects");
}
