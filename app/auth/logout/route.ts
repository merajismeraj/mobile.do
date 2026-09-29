import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { accountsEnabled, config } from "@/lib/env";

export const runtime = "nodejs";

export async function POST() {
  if (accountsEnabled()) await (await supabaseServer()).auth.signOut();
  return NextResponse.redirect(`${config.appUrl()}/`, { status: 303 });
}
