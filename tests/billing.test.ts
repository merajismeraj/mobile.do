import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  cashfreePlanId, createSubscription, entitlementFor, findSubscriptionId, manageSubscription, planFromId, verifyWebhook,
} from "../lib/cashfree.ts";
import { PLANS } from "../lib/plans.ts";
import { normalizeDomain } from "../lib/domains.ts";
import { safeNext } from "../lib/redirect.ts";

// ---- fake Cashfree -------------------------------------------------------
const calls: Array<{ method: string; path: string; headers: Record<string, unknown>; body: any }> = [];
const plans = new Set<string>();
let server: Server;

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method!, path: req.url!, headers: req.headers, body });
      const send = (code: number, json: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.headers["x-client-secret"] !== "secret") return send(401, { message: "authentication Failed" });
      const planMatch = req.url!.match(/^\/pg\/plans\/(.+)$/);
      if (req.method === "GET" && planMatch) return plans.has(planMatch[1]) ? send(200, { plan_id: planMatch[1] }) : send(404, { message: "plan not found" });
      if (req.method === "POST" && req.url === "/pg/plans") {
        plans.add(body.plan_id);
        return send(200, { plan_id: body.plan_id, plan_status: "ACTIVE" });
      }
      if (req.method === "POST" && req.url === "/pg/subscriptions") {
        return send(200, { subscription_id: body.subscription_id, cf_subscription_id: "cf_1", subscription_status: "INITIALIZED", subscription_session_id: "sub_session_abc" });
      }
      if (req.method === "POST" && /\/manage$/.test(req.url!)) return send(200, { subscription_id: body.subscription_id, subscription_status: "CANCELLED" });
      send(404, { message: "not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.CASHFREE_API_BASE = `http://127.0.0.1:${port}/pg`;
  process.env.CASHFREE_APP_ID = "app";
  process.env.CASHFREE_SECRET_KEY = "secret";
});
after(() => server.close());

test("createSubscription creates the INR monthly plan once, then the subscription", async () => {
  calls.length = 0;
  const opts = {
    subscriptionId: "mdo_abc",
    plan: PLANS.pro,
    customer: { name: "Ada", email: "ada@x.test", phone: "9876543210" },
    returnUrl: "https://mobile.do/billing/return?sid=mdo_abc",
  };
  const sub = await createSubscription(opts);
  assert.equal(sub.subscription_session_id, "sub_session_abc");

  const planCreate = calls.find((c) => c.method === "POST" && c.path === "/pg/plans")!;
  assert.deepEqual(
    {
      id: planCreate.body.plan_id, type: planCreate.body.plan_type, cur: planCreate.body.plan_currency,
      amt: planCreate.body.plan_recurring_amount, max: planCreate.body.plan_max_amount,
      every: planCreate.body.plan_intervals, unit: planCreate.body.plan_interval_type,
    },
    { id: "mobiledo_pro_inr_2499_monthly", type: "PERIODIC", cur: "INR", amt: 2499, max: 2499, every: 1, unit: "MONTH" },
  );
  const subCreate = calls.find((c) => c.path === "/pg/subscriptions")!;
  assert.equal(subCreate.headers["x-api-version"], "2025-01-01");
  assert.equal(subCreate.headers["x-client-id"], "app");
  assert.equal(subCreate.body.plan_details.plan_id, "mobiledo_pro_inr_2499_monthly");
  assert.deepEqual(subCreate.body.customer_details, { customer_name: "Ada", customer_email: "ada@x.test", customer_phone: "9876543210" });
  assert.equal(subCreate.body.subscription_meta.return_url, opts.returnUrl);
  assert.ok(new Date(subCreate.body.subscription_first_charge_time).getTime() > Date.now() + 24 * 3600_000);

  calls.length = 0;
  await createSubscription({ ...opts, subscriptionId: "mdo_def" });
  assert.equal(calls.filter((c) => c.path === "/pg/plans").length, 0, "plan is reused, not recreated");
});

test("cancel uses the manage endpoint", async () => {
  calls.length = 0;
  await manageSubscription("mdo_abc", "CANCEL");
  assert.deepEqual(calls[0].body, { subscription_id: "mdo_abc", action: "CANCEL" });
  assert.equal(calls[0].path, "/pg/subscriptions/mdo_abc/manage");
});

test("provider errors surface Cashfree's message", async () => {
  process.env.CASHFREE_SECRET_KEY = "wrong";
  await assert.rejects(manageSubscription("x", "CANCEL"), /authentication Failed/);
  process.env.CASHFREE_SECRET_KEY = "secret";
});

// ---- webhooks & mapping ---------------------------------------------------
test("webhook signature: base64 HMAC-SHA256 of timestamp + raw body", () => {
  const body = JSON.stringify({ type: "SUBSCRIPTION_STATUS_CHANGED", data: { subscription_details: { subscription_id: "mdo_abc" } } });
  const ts = String(Date.now());
  const sig = createHmac("sha256", "secret").update(ts + body).digest("base64");
  assert.equal(verifyWebhook(body, sig, ts, "secret"), true);
  assert.equal(verifyWebhook(body + " ", sig, ts, "secret"), false, "tampered body");
  assert.equal(verifyWebhook(body, sig, ts, "other"), false, "wrong secret");
  assert.equal(verifyWebhook(body, null, ts, "secret"), false);
  assert.equal(verifyWebhook(body, "short", ts, "secret"), false);
  assert.equal(findSubscriptionId(JSON.parse(body)), "mdo_abc");
  assert.equal(findSubscriptionId({ data: { payment: { x: 1 } } }), null);
});

test("status → entitlement mapping", () => {
  assert.equal(entitlementFor("ACTIVE").kind, "grant");
  assert.equal(entitlementFor("CUSTOMER_CANCELLED").kind, "grace");
  assert.equal(entitlementFor("ON_HOLD").kind, "revoke");
  assert.equal(entitlementFor("BANK_APPROVAL_PENDING").kind, "pending");
  assert.equal(entitlementFor(undefined).kind, "pending");
  assert.equal(planFromId(cashfreePlanId(PLANS.scale))?.id, "scale");
  assert.equal(planFromId("something_else"), undefined);
});

test("TS plan limits match the SQL source of truth", async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  await pg.exec(readFileSync(new URL("../supabase/migrations/0001_billing_and_hosting.sql", import.meta.url), "utf8"));
  for (const p of Object.values(PLANS)) {
    const { rows } = await pg.query<{ n: number }>(`select public.plan_app_limit($1) as n`, [p.id]);
    assert.equal(rows[0].n, p.apps, p.id);
  }
  assert.deepEqual([PLANS.free.apps, PLANS.pro.apps, PLANS.scale.apps], [1, 5, 25]);
  assert.deepEqual([PLANS.pro.priceInr, PLANS.scale.priceInr], [2499, 8499]);
});

// ---- input hardening --------------------------------------------------------
test("custom domain normalisation", () => {
  assert.equal(normalizeDomain("https://App.Example.com/path?x"), "app.example.com");
  assert.equal(normalizeDomain("example.co.in."), "example.co.in");
  for (const bad of ["localhost", "foo", "-a.com", "evil.vercel.app", "a..com", "exa mple.com", ""]) {
    assert.equal(normalizeDomain(bad), null, bad);
  }
});

test("post-login redirect only allows same-site paths", () => {
  assert.equal(safeNext("/pricing?plan=pro"), "/pricing?plan=pro");
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", null, ""]) assert.equal(safeNext(bad), "/dashboard");
});
