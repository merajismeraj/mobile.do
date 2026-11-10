import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { syncSubscription } from "@/lib/billing";
import { config } from "@/lib/env";

export const runtime = "nodejs";

/** Cashfree sends the customer back here after authorising the mandate. */
export async function GET(req: Request) {
  const sid = new URL(req.url).searchParams.get("sid") ?? "";
  const dest = new URL("/dashboard", config.appUrl());
  const user = await currentUser();
  if (user && /^mdo_[a-f0-9]{24}$/.test(sid)) {
    const { data } = await supabaseAdmin().from("subscriptions").select("user_id").eq("id", sid).maybeSingle();
    if (data?.user_id === user.id) {
      const res = await syncSubscription(sid).catch(() => null);
      dest.searchParams.set("billing", res?.status === "ACTIVE" ? "active" : "pending");
    }
  }
  return NextResponse.redirect(dest);
}
