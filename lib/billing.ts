import "server-only";
import { supabaseAdmin } from "./supabase/server";
import { entitlementFor, getSubscription, planFromId } from "./cashfree";
import { PLANS, isPaidPlan } from "./plans";

const DAY = 86400_000;

interface SubRow {
  id: string;
  user_id: string;
  plan: "pro";
  status: string;
}

/**
 * Pulls the live state of one of our subscriptions from Cashfree and applies it to
 * the subscriptions row and the owner's profile. Safe to call repeatedly.
 */
export async function syncSubscription(subscriptionId: string): Promise<{ status: string } | null> {
  const db = supabaseAdmin();
  const { data: row } = await db.from("subscriptions").select("*").eq("id", subscriptionId).maybeSingle<SubRow>();
  if (!row) return null; // not ours

  const live = await getSubscription(subscriptionId);
  const status = (live.subscription_status ?? "UNKNOWN").toUpperCase();
  const plan = planFromId(live.plan_details?.plan_id)?.id ?? row.plan;
  const nextCharge = live.next_schedule_date ? new Date(live.next_schedule_date) : null;

  await db
    .from("subscriptions")
    .update({
      status,
      plan: isPaidPlan(plan) ? plan : row.plan,
      cf_subscription_id: live.cf_subscription_id ?? null,
      next_charge_at: nextCharge?.toISOString() ?? null,
    })
    .eq("id", row.id);

  const { data: profile } = await db.from("profiles").select("subscription_id").eq("id", row.user_id).single();
  const isCurrent = profile?.subscription_id === row.id;
  const ent = entitlementFor(status);

  if (ent.kind === "grant") {
    // Paid through the next charge date, plus a short grace for retries.
    const periodEnd = new Date((nextCharge?.getTime() ?? Date.now() + 31 * DAY) + 3 * DAY);
    await db
      .from("profiles")
      .update({ plan, subscription_id: row.id, subscription_status: status, period_end: periodEnd.toISOString() })
      .eq("id", row.user_id);
  } else if (isCurrent && ent.kind === "grace") {
    // Keep period_end: access continues until the end of the paid month.
    await db.from("profiles").update({ subscription_status: status }).eq("id", row.user_id);
  } else if (isCurrent && ent.kind === "revoke") {
    await db
      .from("profiles")
      .update({ subscription_status: status, period_end: new Date().toISOString() })
      .eq("id", row.user_id);
  }
  return { status };
}

export const planLabel = (p: string) => (isPaidPlan(p) ? PLANS[p].name : PLANS.free.name);
