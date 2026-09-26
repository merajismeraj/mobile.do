// Pricing. App limits must match public.plan_app_limit() in the SQL migration.

export type PlanId = "free" | "pro" | "scale";

export interface Plan {
  id: PlanId;
  name: string;
  priceInr: number;
  apps: number;
  blurb: string;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceInr: 0,
    apps: 1,
    blurb: "Try it on one real app.",
    features: ["1 hosted app", "Unlimited generations (your AI key)", "Custom domain", "PWA + iOS/Android export"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceInr: 2499,
    apps: 5,
    blurb: "For makers shipping a handful of apps.",
    features: ["5 hosted apps", "Custom domain per app", "Everything in Free"],
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceInr: 8499,
    apps: 25,
    blurb: "For agencies and portfolios.",
    features: ["25 hosted apps", "Custom domain per app", "Everything in Pro"],
  },
};

export const PAID_PLANS = [PLANS.pro, PLANS.scale];

export const isPaidPlan = (p: string): p is "pro" | "scale" => p === "pro" || p === "scale";

export const formatInr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
