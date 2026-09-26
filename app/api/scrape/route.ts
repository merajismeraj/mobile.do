import { extractSite } from "@/lib/extract.ts";
import { safeFetchText, UnsafeUrlError } from "@/lib/net.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let url = "";
  try {
    ({ url } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) return Response.json({ error: "Enter a URL" }, { status: 400 });
  const target = /^[a-z][a-z0-9+.-]*:(\/\/|\D)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;

  try {
    const page = await safeFetchText(target);
    if (page.status >= 400) {
      return Response.json({ error: `The site responded with HTTP ${page.status}` }, { status: 502 });
    }
    if (page.contentType && !/html|xml|text\/plain/i.test(page.contentType)) {
      return Response.json({ error: `Not an HTML page (${page.contentType})` }, { status: 422 });
    }
    const site = extractSite(page.body, page.url);
    const thin = site.text.length < 200;
    return Response.json({
      site,
      warning: thin
        ? "Very little server-rendered content was found (likely a JavaScript-rendered site). Add a description of the app in the prompt box for best results."
        : undefined,
    });
  } catch (err) {
    const message =
      err instanceof UnsafeUrlError
        ? err.message
        : err instanceof Error && err.name === "TimeoutError"
          ? "The site took too long to respond"
          : "Could not fetch that URL";
    return Response.json({ error: message }, { status: err instanceof UnsafeUrlError ? 400 : 502 });
  }
}
