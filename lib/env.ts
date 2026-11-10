// Server configuration. Features degrade gracefully when their env vars are missing.

const env = (k: string) => process.env[k]?.trim() || "";

export const config = {
  appUrl: () => env("APP_URL").replace(/\/+$/, "") || "http://localhost:3000",
  appsHost: () => env("APPS_HOST") || "",
  supabaseUrl: () => env("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => env("SUPABASE_SERVICE_ROLE_KEY"),
  cashfreeAppId: () => env("CASHFREE_APP_ID"),
  cashfreeSecret: () => env("CASHFREE_SECRET_KEY"),
  cashfreeEnv: (): "sandbox" | "production" => (env("CASHFREE_ENV") === "production" ? "production" : "sandbox"),
  vercelToken: () => env("VERCEL_TOKEN"),
  vercelProjectId: () => env("VERCEL_PROJECT_ID"),
  vercelTeamId: () => env("VERCEL_TEAM_ID"),
};

export const accountsEnabled = () => !!(config.supabaseUrl() && config.supabaseAnonKey() && config.supabaseServiceKey());
export const billingEnabled = () => !!(config.cashfreeAppId() && config.cashfreeSecret());
export const domainsEnabled = () => !!(config.vercelToken() && config.vercelProjectId());

/** Public URL of a hosted app. */
export function appPublicUrl(slug: string, customDomain?: string | null): string {
  if (customDomain) return `https://${customDomain}/`;
  const host = config.appsHost();
  return host ? `https://${host}/${slug}/` : `${config.appUrl()}/hosted/apps/${slug}/`;
}
