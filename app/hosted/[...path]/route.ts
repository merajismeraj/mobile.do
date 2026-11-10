// Serves hosted apps. Reached only via proxy.ts rewrites from APPS_HOST or a
// customer's custom domain — never on the studio origin (except local dev).

import { supabaseAdmin } from "@/lib/supabase/server";
import { accountsEnabled, config } from "@/lib/env";
import { deriveMeta, iconSvg, injectPwa, manifest, serviceWorker, type AppMeta } from "@/lib/pack";
import type { AppRow } from "@/lib/apps";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300" };

function page(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;padding:24px}a{color:#3fb950}h1{font-size:18px}</style>
</head><body><main><h1>${title}</h1><p>${body}</p><p><a href="${config.appUrl()}">mobile.do</a></p></main></body></html>`,
    { status, headers: { ...HTML_HEADERS, "cache-control": "no-store" } },
  );
}

export async function GET(req: Request, { params }: Ctx) {
  if (!accountsEnabled()) return page(503, "Hosting unavailable", "This deployment has no database configured.");
  const [kind, key, ...rest] = (await params).path.map(decodeURIComponent);
  if (!key || (kind !== "apps" && kind !== "domain")) return page(404, "App not found", "There's no app at this address.");

  const db = supabaseAdmin();
  const { data: app } = await db
    .from("apps")
    .select("*")
    .eq(kind === "apps" ? "slug" : "custom_domain", key.toLowerCase())
    .maybeSingle<AppRow>();
  if (!app) return page(404, "App not found", "There's no app at this address.");

  // Path-based apps need a trailing slash so relative asset URLs resolve under the slug.
  const url = new URL(req.url);
  if (kind === "apps" && rest.length === 0 && !url.pathname.endsWith("/")) {
    const base = config.appsHost() ? `/${app.slug}/` : `/hosted/apps/${app.slug}/`;
    return new Response(null, { status: 308, headers: { location: base } });
  }

  const { data: running } = await db.rpc("app_is_running", { app: app.id });
  if (!running) {
    return page(402, `${escapeHtml(app.name)} is paused`, "This app is over its owner's plan limit. The owner can upgrade or free a slot to bring it back online.");
  }

  const meta: AppMeta = { ...deriveMeta(app.html, app.name), ...(app.theme_color ? { themeColor: app.theme_color } : {}) };
  const version = new Date(app.updated_at).getTime();
  const file = rest.join("/");

  switch (file) {
    case "":
    case "index.html":
      return new Response(injectPwa(app.html, meta), { headers: HTML_HEADERS });
    case "manifest.webmanifest":
      return new Response(manifest(meta), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=300" } });
    case "sw.js":
      return new Response(serviceWorker(meta, version), {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "./" },
      });
    case "icons/icon.svg":
      return new Response(iconSvg(meta), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    case "icons/icon-192.png":
    case "icons/icon-512.png": {
      const b64 = file.endsWith("192.png") ? app.icon_192 : app.icon_512;
      if (!b64) return new Response(iconSvg(meta), { headers: { "content-type": "image/svg+xml" } });
      return new Response(Buffer.from(b64, "base64"), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }
    default:
      // Single-file apps use hash routing; anything else is a miss.
      return page(404, "Not found", "That file isn't part of this app.");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}
