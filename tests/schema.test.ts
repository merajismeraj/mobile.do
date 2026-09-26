import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Minimal stand-in for the parts of Supabase the migration depends on.
const SUPABASE_STUB = `
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
`;

async function db() {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.exec(readFileSync(new URL("../supabase/migrations/0001_billing_and_hosting.sql", import.meta.url), "utf8"));
  return pg;
}

let n = 0;
async function user(pg: PGlite, meta = { full_name: "Ada" }) {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  await pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `u${n}@x.test`, meta]);
  return id;
}

const addApp = (pg: PGlite, uid: string, slug: string) =>
  pg.query(`insert into public.apps (user_id, slug, name, html) values ($1, $2, $2, '<html></html>') returning id`, [uid, slug]);

const scalar = async <T,>(pg: PGlite, sql: string, params: unknown[] = []) =>
  Object.values((await pg.query<Record<string, T>>(sql, params)).rows[0])[0];

test("migration is idempotent and creates profiles on signup", async () => {
  const pg = await db();
  await pg.exec(readFileSync(new URL("../supabase/migrations/0001_billing_and_hosting.sql", import.meta.url), "utf8"));
  const uid = await user(pg);
  assert.equal(await scalar(pg, `select full_name from public.profiles where id = $1`, [uid]), "Ada");
  assert.equal(await scalar(pg, `select plan from public.profiles where id = $1`, [uid]), "free");
});

test("free plan hosts exactly one app", async () => {
  const pg = await db();
  const uid = await user(pg);
  await addApp(pg, uid, "one");
  await assert.rejects(addApp(pg, uid, "two"), /APP_LIMIT_REACHED/);
});

test("active pro allows 5, scale allows 25", async () => {
  const pg = await db();
  const uid = await user(pg);
  await pg.query(`update public.profiles set plan = 'pro', subscription_status = 'ACTIVE' where id = $1`, [uid]);
  for (let i = 0; i < 5; i++) await addApp(pg, uid, `p${i}`);
  await assert.rejects(addApp(pg, uid, "p5"), /APP_LIMIT_REACHED/);
  await pg.query(`update public.profiles set plan = 'scale' where id = $1`, [uid]);
  assert.equal(await scalar(pg, `select public.app_limit($1)`, [uid]), 25);
  await addApp(pg, uid, "p5");
});

test("cancelled plan keeps access until period_end, then drops to free", async () => {
  const pg = await db();
  const uid = await user(pg);
  await pg.query(
    `update public.profiles set plan = 'pro', subscription_status = 'CANCELLED', period_end = now() + interval '10 days' where id = $1`,
    [uid],
  );
  assert.equal(await scalar(pg, `select public.effective_plan($1)`, [uid]), "pro");
  await pg.query(`update public.profiles set period_end = now() - interval '1 minute' where id = $1`, [uid]);
  assert.equal(await scalar(pg, `select public.effective_plan($1)`, [uid]), "free");
});

test("on downgrade only the oldest N apps keep running", async () => {
  const pg = await db();
  const uid = await user(pg);
  await pg.query(`update public.profiles set plan = 'pro', subscription_status = 'ACTIVE' where id = $1`, [uid]);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push(((await addApp(pg, uid, `d${i}`)).rows[0] as { id: string }).id);
    await pg.query(`update public.apps set created_at = now() + ($2 || ' seconds')::interval where id = $1`, [ids[i], String(i)]);
  }
  await pg.query(`update public.profiles set subscription_status = 'ON_HOLD', period_end = null where id = $1`, [uid]);
  const running = await Promise.all(ids.map((id) => scalar(pg, `select public.app_is_running($1)`, [id])));
  assert.deepEqual(running, [true, false, false]);
});

test("slug and size constraints", async () => {
  const pg = await db();
  const uid = await user(pg);
  await assert.rejects(addApp(pg, uid, "Bad Slug"), /check/i);
  await assert.rejects(addApp(pg, uid, "-lead"), /check/i);
});
