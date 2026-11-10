/** Only allow same-site relative redirect targets (blocks open redirects like //evil.com). */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}
