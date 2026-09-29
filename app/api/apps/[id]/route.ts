import { requireUser, supabaseAdmin, errorResponse } from "@/lib/supabase/server";
import { APP_LIST_COLUMNS, appColumns, dbError, ownedApp } from "@/lib/apps";
import { appPublicUrl, domainsEnabled } from "@/lib/env";
import { removeDomain } from "@/lib/domains";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await ownedApp(user.id, id);
    const cols = appColumns(await req.json().catch(() => ({})), { partial: true });
    const { data, error } = await supabaseAdmin()
      .from("apps")
      .update(cols)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(APP_LIST_COLUMNS)
      .single();
    if (error) throw dbError(error);
    return Response.json({ app: { ...data, url: appPublicUrl(data.slug) } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const app = await ownedApp(user.id, id);
    if (app.custom_domain && domainsEnabled()) await removeDomain(app.custom_domain).catch(() => {});
    const { error } = await supabaseAdmin().from("apps").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw dbError(error);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
