// Decides whether a request host is the studio or a hosted app (pure, testable).

const bare = (h: string) => h.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");

export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host.toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Studio hosts: APP_URL's host (with or without www.), localhost, and *.vercel.app
 * deployment URLs other than APPS_HOST. Without APP_URL we cannot tell the studio
 * from a customer's custom domain, so every host is treated as the studio.
 */
export function isStudioHost(host: string, appUrl: string | undefined, appsHost: string | undefined): boolean {
  const h = host.toLowerCase();
  const app = hostOf(appUrl);
  if (!app) return true;
  if (appsHost && h === appsHost.toLowerCase()) return false;
  return (
    bare(h) === bare(app) ||
    h.startsWith("localhost") ||
    h.startsWith("127.0.0.1") ||
    bare(h).endsWith(".vercel.app")
  );
}
