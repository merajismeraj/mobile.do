import "server-only";
import { supabaseAdmin } from "./supabase/server";
import { PLANS, type PlanId } from "./plans";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  plan: PlanId;
  subscription_id: string | null;
  subscription_status: string | null;
  period_end: string | null;
}

export interface Account {
  profile: Profile;
  /** Plan the user is entitled to right now (paid plans lapse to free). */
  plan: PlanId;
  limit: number;
  used: number;
}

export async function getAccount(userId: string): Promise<Account> {
  const db = supabaseAdmin();
  const [{ data: profile, error }, { data: plan }, { count }] = await Promise.all([
    db.from("profiles").select("*").eq("id", userId).single<Profile>(),
    db.rpc("effective_plan", { uid: userId }),
    db.from("apps").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if (error || !profile) throw new Error(`profile missing for ${userId}: ${error?.message}`);
  const effective = ((plan as string) ?? "free") as PlanId;
  return { profile, plan: effective, limit: PLANS[effective].apps, used: count ?? 0 };
}
