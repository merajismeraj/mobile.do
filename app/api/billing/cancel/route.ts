import { requireUser, errorResponse, HttpError } from "@/lib/supabase/server";
import { billingEnabled } from "@/lib/env";
import { CashfreeError, manageSubscription } from "@/lib/cashfree";
import { getAccount } from "@/lib/account";
import { syncSubscription } from "@/lib/billing";

export const runtime = "nodejs";

export async function POST() {
  try {
    const user = await requireUser();
    if (!billingEnabled()) throw new HttpError(503, "Payments are not configured on this deployment.");
    const { profile } = await getAccount(user.id);
    if (!profile.subscription_id || profile.subscription_status !== "ACTIVE") {
      throw new HttpError(409, "You don't have an active subscription.");
    }
    await manageSubscription(profile.subscription_id, "CANCEL");
    const synced = await syncSubscription(profile.subscription_id);
    return Response.json({ ok: true, status: synced?.status, accessUntil: profile.period_end });
  } catch (err) {
    if (err instanceof CashfreeError) return Response.json({ error: `Payment provider: ${err.message}` }, { status: 502 });
    return errorResponse(err);
  }
}
