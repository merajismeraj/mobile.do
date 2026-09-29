import { findSubscriptionId, verifyWebhook } from "@/lib/cashfree";
import { syncSubscription } from "@/lib/billing";
import { accountsEnabled, billingEnabled } from "@/lib/env";

export const runtime = "nodejs";

// Configure in Cashfree Dashboard → Subscriptions → Webhooks: https://<app>/api/billing/webhook
export async function POST(req: Request) {
  if (!billingEnabled() || !accountsEnabled()) return new Response("not configured", { status: 503 });
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-webhook-signature"), req.headers.get("x-webhook-timestamp"))) {
    return new Response("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const id = findSubscriptionId(payload);
  if (!id) return Response.json({ ok: true, ignored: true });
  try {
    // Never trust the payload's status: re-read the subscription from Cashfree.
    await syncSubscription(id);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("webhook sync failed", id, err);
    return new Response("sync failed", { status: 500 }); // Cashfree will retry
  }
}
