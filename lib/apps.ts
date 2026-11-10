import "server-only";
import { supabaseAdmin, HttpError } from "./supabase/server";
import { slugify } from "./pack";

export interface AppRow {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  html: string;
  theme_color: string | null;
  icon_192: string | null;
  icon_512: string | null;
  source: string | null;
  brief: string | null;
  custom_domain: string | null;
  created_at: string;
  updated_at: string;
}

export const APP_LIST_COLUMNS = "id, slug, name, custom_domain, theme_color, created_at, updated_at";

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const B64_PNG = /^[A-Za-z0-9+/]+={0,2}$/;

export interface AppInput {
  name?: unknown;
  slug?: unknown;
  html?: unknown;
  themeColor?: unknown;
  icon192?: unknown;
  icon512?: unknown;
  brief?: unknown;
  source?: unknown;
}

/** Validates publish/update payloads into DB columns. */
export function appColumns(input: AppInput, { partial = false } = {}) {
  const out: Partial<AppRow> = {};
  if (input.name !== undefined || !partial) {
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!name) throw new HttpError(400, "App name is required.");
    out.name = name;
  }
  if (input.html !== undefined || !partial) {
    const html = String(input.html ?? "");
    if (!/<html[\s>]/i.test(html)) throw new HttpError(400, "App HTML is missing.");
    if (new TextEncoder().encode(html).length > 1_000_000) throw new HttpError(413, "App is larger than 1 MB.");
    out.html = html;
  }
  if (typeof input.themeColor === "string" && HEX.test(input.themeColor)) out.theme_color = input.themeColor;
  for (const [key, col] of [["icon192", "icon_192"], ["icon512", "icon_512"]] as const) {
    const v = input[key];
    if (typeof v === "string" && v.length < 400_000 && B64_PNG.test(v)) out[col] = v;
  }
  if (typeof input.brief === "string") out.brief = input.brief.slice(0, 20_000);
  if (typeof input.source === "string") out.source = input.source.slice(0, 500);
  return out;
}

export async function ownedApp(userId: string, id: string): Promise<AppRow> {
  const { data } = await supabaseAdmin().from("apps").select("*").eq("id", id).eq("user_id", userId).maybeSingle<AppRow>();
  if (!data) throw new HttpError(404, "App not found.");
  return data;
}

/** Picks a free slug: requested (if valid) or derived from the name, suffixed on collision. */
export async function availableSlug(requested: unknown, name: string): Promise<string> {
  const base = slugify(typeof requested === "string" && requested.trim() ? requested : name).slice(0, 34).replace(/-+$/, "") || "app";
  const db = supabaseAdmin();
  for (let i = 0; i < 6; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data } = await db.from("apps").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  throw new HttpError(409, "Could not find a free app URL; try another name.");
}

export function dbError(err: { code?: string; message?: string } | null): HttpError | null {
  if (!err) return null;
  if (err.message?.includes("APP_LIMIT_REACHED")) {
    return new HttpError(402, `${err.message.replace("APP_LIMIT_REACHED: ", "")}. Upgrade or delete an app to publish another.`);
  }
  if (err.code === "23505") return new HttpError(409, "That URL or domain is already taken.");
  return new HttpError(500, "Database error.");
}
