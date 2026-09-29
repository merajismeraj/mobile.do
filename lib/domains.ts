// Custom domains for hosted apps, attached to this Vercel project via the REST API.

import { config } from "./env.ts";

const DOMAIN_RE = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

/** Normalizes user input like "https://App.Example.com/" → "app.example.com"; null if invalid. */
export function normalizeDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
  if (!DOMAIN_RE.test(d)) return null;
  if (d.endsWith(".vercel.app") || d.endsWith(".vercel.sh") || d === "localhost") return null;
  return d;
}

export interface DnsRecord {
  type: "A" | "CNAME" | "TXT";
  name: string;
  value: string;
}

export interface DomainStatus {
  domain: string;
  verified: boolean;
  configured: boolean;
  records: DnsRecord[];
}

async function vercel(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (config.vercelTeamId()) url.searchParams.set("teamId", config.vercelTeamId());
  return fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${config.vercelToken()}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
}

async function vercelError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body?.error?.message ?? `Vercel API ${res.status}`);
}

const apexOf = (d: string) => d.split(".").slice(-2).join(".");

export async function addDomain(domain: string): Promise<void> {
  const res = await vercel(`/v10/projects/${config.vercelProjectId()}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  if (res.ok) return;
  const body = await res.json().catch(() => ({}));
  if (body?.error?.code === "domain_already_in_use" || body?.error?.code === "domain_already_exists") {
    // Already on this project (e.g. retry) is fine; owned by someone else is not.
    const check = await vercel(`/v9/projects/${config.vercelProjectId()}/domains/${domain}`);
    if (check.ok) return;
  }
  throw new Error(body?.error?.message ?? `Could not add ${domain}`);
}

export async function removeDomain(domain: string): Promise<void> {
  const res = await vercel(`/v9/projects/${config.vercelProjectId()}/domains/${domain}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw await vercelError(res);
}

export async function domainStatus(domain: string): Promise<DomainStatus> {
  const [projRes, cfgRes] = await Promise.all([
    vercel(`/v9/projects/${config.vercelProjectId()}/domains/${domain}`),
    vercel(`/v6/domains/${domain}/config`),
  ]);
  if (!projRes.ok) throw await vercelError(projRes);
  const proj = await projRes.json();
  const cfg = cfgRes.ok ? await cfgRes.json() : { misconfigured: true };

  const isApex = domain === apexOf(domain);
  const records: DnsRecord[] = [
    isApex
      ? { type: "A", name: "@", value: "76.76.21.21" }
      : { type: "CNAME", name: domain.slice(0, -apexOf(domain).length - 1), value: "cname.vercel-dns.com" },
  ];
  for (const v of (proj.verification ?? []) as Array<{ type: string; domain: string; value: string }>) {
    if (v.type === "TXT") records.push({ type: "TXT", name: v.domain.replace(`.${apexOf(domain)}`, ""), value: v.value });
  }
  return { domain, verified: !!proj.verified, configured: !cfg.misconfigured, records };
}
