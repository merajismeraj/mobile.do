import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isStudioHost } from "./lib/hosts";

// Host routing:
//  - APPS_HOST (e.g. mobile-do-apps.vercel.app/<slug>/...) → hosted apps by slug
//  - any unknown host (a customer's custom domain)        → hosted app by domain
//  - everything else                                       → the mobile.do studio
// Hosted apps run on a different origin from the studio, so their code can never
// read the studio's session cookies or the API keys kept in its localStorage.

export async function proxy(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  const { pathname } = req.nextUrl;
  const appsHost = process.env.APPS_HOST?.toLowerCase();

  if (appsHost && host === appsHost) {
    const url = req.nextUrl.clone();
    url.pathname = `/hosted/apps${pathname}`;
    return NextResponse.rewrite(url);
  }
  if (!isStudioHost(host, process.env.APP_URL, appsHost)) {
    const url = req.nextUrl.clone();
    url.pathname = `/hosted/domain/${encodeURIComponent(host)}${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Studio host. Path-based hosting (/hosted/apps/...) is only for local dev without APPS_HOST.
  if (pathname.startsWith("/hosted") && (appsHost || !host.startsWith("localhost"))) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Refresh the Supabase session cookie on studio requests.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return res;
}

export const config = {
  // Skip Next internals and static files; webhooks don't need session refresh.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/billing/webhook).*)"],
};
