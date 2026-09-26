import { currentUser, errorResponse } from "@/lib/supabase/server";
import { getAccount } from "@/lib/account";
import { accountsEnabled, billingEnabled, domainsEnabled } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const features = { accounts: accountsEnabled(), billing: billingEnabled(), domains: domainsEnabled() };
  try {
    const user = await currentUser();
    if (!user) return Response.json({ user: null, features });
    const account = await getAccount(user.id);
    return Response.json({
      user: {
        email: user.email,
        name: account.profile.full_name,
        avatar: account.profile.avatar_url,
      },
      plan: account.plan,
      limit: account.limit,
      used: account.used,
      subscription: {
        status: account.profile.subscription_status,
        periodEnd: account.profile.period_end,
        plan: account.profile.plan,
      },
      features,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
