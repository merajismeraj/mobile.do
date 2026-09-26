import { randomUUID } from "node:crypto";
import { requireUser, supabaseAdmin, errorResponse, HttpError } from "@/lib/supabase/server";
import { billingEnabled, config } from "@/lib/env";
import { PLANS, isPaidPlan } from "@/lib/plans";
import { CashfreeError, cashfreePlanId, createSubscription, ensurePlan, manageSubscription } from "@/lib/cashfree";
import { getAccount } from "@/lib/account";
import { syncSubscription } from "@/lib/billing";

export const runtime = "nodejs";

const PHONE = /^[6-9]\d{9}$/;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!billingEnabled()) throw new HttpError(503, "Payments are not configured on this deployment.");
    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan ?? "");
    if (!isPaidPlan(planId)) throw new HttpError(400, "Choose the Pro or Scale plan.");
    const plan = PLANS[planId];

    const account = await getAccount(user.id);
    const db = supabaseAdmin();

    // Already subscribed: switch plans on the existing mandate instead of opening a new one.
    if (account.profile.subscription_status === "ACTIVE" && account.profile.subscription_id) {
      if (account.profile.plan === planId) throw new HttpError(409, `You're already on ${plan.name}.`);
      await ensurePlan(plan);
      await manageSubscription(account.profile.subscription_id, "CHANGE_PLAN", cashfreePlanId(plan));
      await db.from("subscriptions").update({ plan: planId }).eq("id", account.profile.subscription_id);
      await db.from("profiles").update({ plan: planId }).eq("id", user.id);
      await syncSubscription(account.profile.subscription_id).catch(() => {});
      return Response.json({ changed: true, plan: planId });
    }

    const phone = String(body.phone ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!PHONE.test(phone)) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.");

    const subscriptionId = `mdo_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const { error } = await db.from("subscriptions").insert({ id: subscriptionId, user_id: user.id, plan: planId });
    if (error) throw new HttpError(500, "Could not start checkout.");

    const sub = await createSubscription({
      subscriptionId,
      plan,
      customer: { name: account.profile.full_name || user.email!.split("@")[0], email: user.email!, phone },
      returnUrl: `${config.appUrl()}/billing/return?sid=${subscriptionId}`,
    });
    if (!sub.subscription_session_id) throw new HttpError(502, "Cashfree did not return a checkout session.");
    return Response.json({ sessionId: sub.subscription_session_id, mode: config.cashfreeEnv(), subscriptionId });
  } catch (err) {
    if (err instanceof CashfreeError) return Response.json({ error: `Payment provider: ${err.message}` }, { status: 502 });
    return errorResponse(err);
  }
}
