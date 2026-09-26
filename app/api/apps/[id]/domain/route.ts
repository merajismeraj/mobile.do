import { requireUser, supabaseAdmin, errorResponse, HttpError } from "@/lib/supabase/server";
import { dbError, ownedApp } from "@/lib/apps";
import { domainsEnabled } from "@/lib/env";
import { addDomain, domainStatus, normalizeDomain, removeDomain } from "@/lib/domains";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function assertEnabled() {
  if (!domainsEnabled()) throw new HttpError(503, "Custom domains are not configured on this deployment.");
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    assertEnabled();
    const app = await ownedApp(user.id, (await params).id);
    if (!app.custom_domain) return Response.json({ status: null });
    return Response.json({ status: await domainStatus(app.custom_domain) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    assertEnabled();
    const app = await ownedApp(user.id, (await params).id);
    const { domain: raw } = await req.json().catch(() => ({}));
    const domain = normalizeDomain(String(raw ?? ""));
    if (!domain) throw new HttpError(400, "Enter a valid domain like app.example.com.");
    if (app.custom_domain === domain) return Response.json({ status: await domainStatus(domain) });

    const db = supabaseAdmin();
    const { data: taken } = await db.from("apps").select("id").eq("custom_domain", domain).maybeSingle();
    if (taken) throw new HttpError(409, "That domain is already connected to another app.");

    try {
      await addDomain(domain);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not add domain.");
    }
    const { error } = await db.from("apps").update({ custom_domain: domain }).eq("id", app.id).eq("user_id", user.id);
    if (error) {
      await removeDomain(domain).catch(() => {});
      throw dbError(error);
    }
    if (app.custom_domain) await removeDomain(app.custom_domain).catch(() => {});
    return Response.json({ status: await domainStatus(domain) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    assertEnabled();
    const app = await ownedApp(user.id, (await params).id);
    if (app.custom_domain) {
      await removeDomain(app.custom_domain);
      await supabaseAdmin().from("apps").update({ custom_domain: null }).eq("id", app.id).eq("user_id", user.id);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
