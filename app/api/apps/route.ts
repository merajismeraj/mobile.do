import { requireUser, supabaseAdmin, errorResponse } from "@/lib/supabase/server";
import { getAccount } from "@/lib/account";
import { APP_LIST_COLUMNS, appColumns, availableSlug, dbError } from "@/lib/apps";
import { appPublicUrl } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const account = await getAccount(user.id);
    const { data, error } = await supabaseAdmin()
      .from("apps")
      .select(APP_LIST_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw dbError(error);
    const apps = (data ?? []).map((a, i) => ({
      ...a,
      url: appPublicUrl(a.slug),
      domainUrl: a.custom_domain ? appPublicUrl(a.slug, a.custom_domain) : null,
      running: i < account.limit,
    }));
    return Response.json({ apps, plan: account.plan, limit: Number.isFinite(account.limit) ? account.limit : null, used: account.used });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const cols = appColumns(body);
    const slug = await availableSlug(body.slug, cols.name!);
    const { data, error } = await supabaseAdmin()
      .from("apps")
      .insert({ ...cols, slug, user_id: user.id })
      .select(APP_LIST_COLUMNS)
      .single();
    if (error) throw dbError(error);
    return Response.json({ app: { ...data, url: appPublicUrl(data.slug) } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
