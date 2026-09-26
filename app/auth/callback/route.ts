import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { config } from "@/lib/env";
import { safeNext } from "@/lib/redirect";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (code) {
    const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${config.appUrl()}${next}`);
  }
  return NextResponse.redirect(`${config.appUrl()}/pricing?error=login`);
}
