// Browser-only helpers: settings persistence, preview sandboxing, packaging.

import type { SiteSummary } from "./extract.ts";
import {
  capacitorConfig, claudeMd, deriveMeta, iconSvg, injectPwa, manifest, projectPackageJson, projectReadme,
  serviceWorker, type AppMeta,
} from "./pack.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { createZip, type ZipEntry } from "./zip.ts";

export interface Settings {
  providerId: string;
  keys: Record<string, string>;
  models: Record<string, string>;
  baseUrls: Record<string, string>;
  maxTokens: number;
}

export interface Project {
  id: string;
  name: string;
  html: string;
  brief: string;
  source: string;
  createdAt: number;
  /** Hosted app id once published. */
  appId?: string;
  appUrl?: string;
}

const SETTINGS_KEY = "mobiledo.settings.v1";
const PROJECTS_KEY = "mobiledo.projects.v1";

export const DEFAULT_SETTINGS: Settings = { providerId: "anthropic", keys: {}, models: {}, baseUrls: {}, maxTokens: 16000 };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadSettings = () => readJson<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => writeJson(SETTINGS_KEY, s);

export function loadProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveProject(p: Project): Project[] {
  const list = [p, ...loadProjects().filter((x) => x.id !== p.id)];
  // Drop the oldest projects until the list fits in storage quota.
  for (let n = Math.min(list.length, 12); n > 0; n--) {
    if (writeJson(PROJECTS_KEY, list.slice(0, n))) return list.slice(0, n);
  }
  return [];
}

export function deleteProject(id: string): Project[] {
  const list = loadProjects().filter((x) => x.id !== id);
  writeJson(PROJECTS_KEY, list);
  return list;
}

/**
 * The preview iframe is sandboxed without allow-same-origin so generated code can
 * never read this origin's storage (where API keys live). That makes localStorage
 * throw inside the preview, so we swap in an in-memory implementation.
 */
const PREVIEW_SHIM = `<script>(function(){try{window.localStorage.getItem("x")}catch(e){var m=function(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};try{Object.defineProperty(window,"localStorage",{value:m(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:m(),configurable:true})}catch(_){}}})();</script>`;

export function previewDoc(html: string): string {
  if (!html) return "";
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${PREVIEW_SHIM}`);
  return PREVIEW_SHIM + html;
}

export async function svgToPng(svg: string, size: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("icon render failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d")!.drawImage(img, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return new Uint8Array(await blob!.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pwaFiles(meta: AppMeta): Promise<ZipEntry[]> {
  const svg = iconSvg(meta);
  const [p192, p512] = await Promise.all([svgToPng(svg, 192), svgToPng(svg, 512)]);
  return [
    { path: "www/manifest.webmanifest", data: manifest(meta) },
    { path: "www/sw.js", data: serviceWorker(meta) },
    { path: "www/icons/icon.svg", data: svg },
    { path: "www/icons/icon-192.png", data: p192 },
    { path: "www/icons/icon-512.png", data: p512 },
    { path: "capacitor.config.json", data: capacitorConfig(meta) },
    { path: "package.json", data: projectPackageJson(meta) },
    { path: ".gitignore", data: "node_modules/\n.DS_Store\n" },
  ];
}

export function download(name: string, data: Uint8Array | string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function buildProjectZip(opts: {
  html: string;
  appName?: string;
  brief: string;
  source: string;
  site?: SiteSummary | null;
}): Promise<{ zip: Uint8Array; meta: AppMeta }> {
  const meta = deriveMeta(opts.html, opts.appName);
  const entries: ZipEntry[] = [
    { path: "www/index.html", data: injectPwa(opts.html, meta) },
    ...(await pwaFiles(meta)),
    { path: "README.md", data: projectReadme(meta, opts.source) },
    { path: "CLAUDE.md", data: claudeMd(meta, opts.brief) },
  ];
  if (opts.site) entries.push({ path: "site.json", data: JSON.stringify(opts.site, null, 2) });
  return { zip: createZip(entries.map((e) => ({ ...e, path: `${meta.slug}/${e.path}` }))), meta };
}

export const CLAUDE_CODE_COMMAND = `claude "Read CLAUDE.md and build the app described there into www/index.html. Serve www/ and self-review at 390x844 before finishing."`;

/** Claude Code handoff: everything except index.html, plus a build task in CLAUDE.md. */
export async function buildClaudeCodeKit(opts: {
  appName?: string;
  brief: string;
  source: string;
  site?: SiteSummary | null;
}): Promise<{ zip: Uint8Array; meta: AppMeta }> {
  const seedTitle = opts.appName || opts.site?.title || "My App";
  const themeColor = opts.site?.themeColor || opts.site?.palette[0] || "";
  const seed = `<html><head><title>${seedTitle}</title>${themeColor ? `<meta name="theme-color" content="${themeColor}">` : ""}</head></html>`;
  const meta = deriveMeta(seed, opts.appName || opts.site?.title?.split(/\s[|–—-]\s/)[0]);
  const task = `
## Task
Build \`www/index.html\` from the brief above.${opts.site ? " Use `site.json` as the source of truth for content, brand and images." : ""}
In <head>, link \`manifest.webmanifest\`, \`icons/icon.svg\` (rel=icon) and \`icons/icon-192.png\` (apple-touch-icon),
and register \`sw.js\` on load. Everything else below is the quality bar.

## Quality bar (from mobile.do)
${SYSTEM_PROMPT.replace(/^[\s\S]*?MOBILE APP QUALITY BAR\n/, "")}
`;
  const entries: ZipEntry[] = [
    ...(await pwaFiles(meta)),
    { path: "README.md", data: projectReadme(meta, opts.source) },
    { path: "CLAUDE.md", data: claudeMd(meta, opts.brief) + task },
  ];
  if (opts.site) entries.push({ path: "site.json", data: JSON.stringify(opts.site, null, 2) });
  return { zip: createZip(entries.map((e) => ({ ...e, path: `${meta.slug}/${e.path}` }))), meta };
}

export interface Me {
  user: { email: string; name: string | null; avatar: string | null } | null;
  plan?: "free" | "pro" | "scale";
  limit?: number;
  used?: number;
  subscription?: { status: string | null; periodEnd: string | null; plan: string };
  features: { accounts: boolean; billing: boolean; domains: boolean };
}

export async function fetchMe(): Promise<Me> {
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (res.ok) return await res.json();
  } catch {
    /* offline */
  }
  return { user: null, features: { accounts: false, billing: false, domains: false } };
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Payload for POST/PATCH /api/apps, including rendered PNG icons. */
export async function publishPayload(html: string, appName: string | undefined, brief: string, source: string) {
  const meta = deriveMeta(html, appName);
  const svg = iconSvg(meta);
  const [p192, p512] = await Promise.all([svgToPng(svg, 192), svgToPng(svg, 512)]);
  return {
    name: meta.name,
    html,
    themeColor: meta.themeColor,
    icon192: toBase64(p192),
    icon512: toBase64(p512),
    brief,
    source,
  };
}

let cashfreeScript: Promise<void> | null = null;

/** Opens Cashfree's hosted subscription checkout for a session from /api/billing/subscribe. */
export async function openCashfreeCheckout(sessionId: string, mode: "sandbox" | "production") {
  cashfreeScript ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.onload = () => resolve();
    s.onerror = () => {
      cashfreeScript = null;
      reject(new Error("Could not load Cashfree checkout. Check your connection or ad blocker."));
    };
    document.head.appendChild(s);
  });
  await cashfreeScript;
  const factory = (window as unknown as { Cashfree?: (o: { mode: string }) => { subscriptionsCheckout?: (o: object) => Promise<unknown> } }).Cashfree;
  const cashfree = factory?.({ mode });
  if (!cashfree?.subscriptionsCheckout) throw new Error("Cashfree checkout is unavailable.");
  await cashfree.subscriptionsCheckout({ subsSessionId: sessionId, redirectTarget: "_self" });
}
