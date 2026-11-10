import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { accountsEnabled, config } from "@/lib/env";
import { safeNext } from "@/lib/redirect";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!accountsEnabled()) return NextResponse.redirect(new URL("/pricing?error=accounts", url));
  const next = safeNext(url.searchParams.get("next"));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${config.appUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) return NextResponse.redirect(new URL("/pricing?error=login", url));
  return NextResponse.redirect(data.url);
}
