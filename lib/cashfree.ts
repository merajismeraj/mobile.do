// Cashfree Subscriptions (PG API). Request/response shapes follow the official
// cashfree-pg SDK models. Plans are monthly, INR, created on first use.

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./env.ts";
import { PLANS, type Plan } from "./plans.ts";

export const CASHFREE_API_VERSION = "2025-01-01";

export class CashfreeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const baseUrl = () =>
  process.env.CASHFREE_API_BASE ||
  (config.cashfreeEnv() === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg");

async function cf<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-api-version": CASHFREE_API_VERSION,
      "x-client-id": config.cashfreeAppId(),
      "x-client-secret": config.cashfreeSecret(),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new CashfreeError(String(json.message ?? `Cashfree ${res.status}`), res.status);
  return json as T;
}

export interface CfSubscription {
  subscription_id: string;
  cf_subscription_id?: string;
  subscription_status?: string;
  subscription_session_id?: string;
  next_schedule_date?: string;
  plan_details?: { plan_id?: string };
}

/** Stable plan id per price, so a price change creates a new Cashfree plan. */
export const cashfreePlanId = (plan: Plan) => `mobiledo_${plan.id}_inr_${plan.priceInr}_monthly`;

export async function ensurePlan(plan: Plan): Promise<string> {
  const planId = cashfreePlanId(plan);
  try {
    await cf(`/plans/${planId}`);
    return planId;
  } catch (err) {
    if (!(err instanceof CashfreeError) || err.status !== 404) throw err;
  }
  await cf("/plans", {
    method: "POST",
    body: {
      plan_id: planId,
      plan_name: `mobile.do ${plan.name}`,
      plan_type: "PERIODIC",
      plan_currency: "INR",
      plan_recurring_amount: plan.priceInr,
      plan_max_amount: plan.priceInr,
      plan_max_cycles: 120,
      plan_intervals: 1,
      plan_interval_type: "MONTH",
      plan_note: "Unlimited apps, downloads and hosting",
    },
  });
  return planId;
}

export async function createSubscription(opts: {
  subscriptionId: string;
  plan: Plan;
  customer: { name: string; email: string; phone: string };
  returnUrl: string;
}): Promise<CfSubscription> {
  const planId = await ensurePlan(opts.plan);
  const now = Date.now();
  return cf<CfSubscription>("/subscriptions", {
    method: "POST",
    body: {
      subscription_id: opts.subscriptionId,
      customer_details: {
        customer_name: opts.customer.name.slice(0, 100),
        customer_email: opts.customer.email,
        customer_phone: opts.customer.phone,
      },
      plan_details: { plan_id: planId },
      authorization_details: {
        // ₹1 verifies the mandate and is refunded; eNACH always authorises at ₹0.
        authorization_amount: 1,
        authorization_amount_refund: true,
        payment_methods: ["upi", "card", "enach"],
      },
      subscription_meta: { return_url: opts.returnUrl },
      // First monthly charge the day after authorisation (UPI Autopay needs a pre-debit notice).
      subscription_first_charge_time: new Date(now + 26 * 3600_000).toISOString(),
      subscription_expiry_time: new Date(now + 10 * 365 * 86400_000).toISOString(),
      subscription_tags: { psp_note: `mobile.do ${opts.plan.name}` },
    },
  });
}

export const getSubscription = (id: string) => cf<CfSubscription>(`/subscriptions/${encodeURIComponent(id)}`);

export async function manageSubscription(id: string, action: "CANCEL") {
  return cf<CfSubscription>(`/subscriptions/${encodeURIComponent(id)}/manage`, {
    method: "POST",
    body: { subscription_id: id, action },
  });
}

/** Verifies `x-webhook-signature` = base64(HMAC-SHA256(timestamp + rawBody, client secret)). */
export function verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null, secret = config.cashfreeSecret()): boolean {
  // No freshness window: Cashfree retries for hours, and handlers re-fetch state from the API,
  // so a replayed delivery can't grant anything the live subscription doesn't have.
  if (!signature || !timestamp || !secret) return false;
  const expected = createHmac("sha256", secret).update(timestamp + rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Finds the first `subscription_id` anywhere in a webhook payload. */
export function findSubscriptionId(payload: unknown, depth = 0): string | null {
  if (!payload || typeof payload !== "object" || depth > 6) return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.subscription_id === "string") return obj.subscription_id;
  for (const v of Object.values(obj)) {
    const found = findSubscriptionId(v, depth + 1);
    if (found) return found;
  }
  return null;
}

export type Entitlement =
  | { kind: "grant" } // plan active now
  | { kind: "grace" } // cancelled: keep until period_end
  | { kind: "revoke" } // payment failed / expired: drop to free now
  | { kind: "pending" }; // awaiting authorisation: no change

/** Maps Cashfree subscription_status to what it means for access. */
export function entitlementFor(status: string | undefined): Entitlement {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return { kind: "grant" };
    case "CANCELLED":
    case "CUSTOMER_CANCELLED":
      return { kind: "grace" };
    case "ON_HOLD":
    case "PAUSED":
    case "CUSTOMER_PAUSED":
    case "EXPIRED":
    case "COMPLETED":
    case "CARD_EXPIRED":
      return { kind: "revoke" };
    default:
      // INITIALIZED, BANK_APPROVAL_PENDING, LINK_EXPIRED, unknown
      return { kind: "pending" };
  }
}

export const planFromId = (planId: string | undefined) =>
  Object.values(PLANS).find((p) => p.id !== "free" && planId === cashfreePlanId(p));
