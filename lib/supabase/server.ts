import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { accountsEnabled, config } from "../env";

/** Supabase client bound to the signed-in user's cookies. */
export async function supabaseServer(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(config.supabaseUrl(), config.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/** Service-role client for trusted server writes. Never expose to the browser. */
export function supabaseAdmin(): SupabaseClient {
  return createClient(config.supabaseUrl(), config.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function currentUser(): Promise<User | null> {
  if (!accountsEnabled()) return null;
  const { data } = await (await supabaseServer()).auth.getUser();
  return data.user ?? null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<User> {
  if (!accountsEnabled()) throw new HttpError(503, "Accounts are not configured on this deployment.");
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in to continue.");
  return user;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
