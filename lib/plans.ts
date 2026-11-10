// Pricing. Keep in sync with public.plan_app_limit() in the SQL migration.

export type PlanId = "free" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  priceInr: number;
  /** Hosted apps allowed; Infinity for unlimited. */
  apps: number;
  downloads: boolean;
  blurb: string;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceInr: 0,
    apps: 0,
    downloads: false,
    blurb: "Generate and preview as much as you like.",
    features: ["Unlimited generations (your AI key)", "Live phone, Android and tablet preview", "Refine with plain-language edits"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceInr: 2499,
    apps: Infinity,
    downloads: true,
    blurb: "Ship everything you build.",
    features: [
      "Unlimited apps",
      "Download HTML, PWA and iOS/Android projects",
      "Claude Code build kits",
      "Host apps at a live URL",
      "Custom domain per app",
    ],
  },
};

/** SQL has no Infinity; plan_app_limit() returns this for unlimited plans. */
export const UNLIMITED_SQL = 2147483647;

export const isPaidPlan = (p: string): p is "pro" => p === "pro";

export const formatInr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export const formatLimit = (n: number) => (Number.isFinite(n) && n < UNLIMITED_SQL ? String(n) : "unlimited");
