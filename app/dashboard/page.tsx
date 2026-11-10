import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import Dashboard from "@/components/Dashboard";
import { currentUser } from "@/lib/supabase/server";
import { accountsEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Dashboard — mobile.do" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!accountsEnabled()) {
    return (
      <div className="app">
        <SiteHeader />
        <main className="page"><p className="banner err">Accounts aren&apos;t configured on this deployment yet.</p></main>
      </div>
    );
  }
  if (!(await currentUser())) redirect("/auth/login?next=/dashboard");
  return (
    <div className="app">
      <SiteHeader />
      <main className="page">
        <Dashboard />
      </main>
    </div>
  );
}
