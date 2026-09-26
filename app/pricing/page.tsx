import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import PricingTable from "@/components/PricingTable";

export const metadata: Metadata = {
  title: "Pricing — mobile.do",
  description: "Free for one hosted app. Pro ₹2,499/mo for 5 apps, Scale ₹8,499/mo for 25. Cancel anytime.",
};

export default function PricingPage() {
  return (
    <div className="app">
      <SiteHeader />
      <main className="page">
        <section className="page-head">
          <p className="eyebrow">$ pricing</p>
          <h1>Simple monthly plans. Cancel anytime.</h1>
          <p className="lede">
            Generating apps is always free with your own AI key. Plans set how many apps you can keep live on
            mobile.do, each with its own custom domain.
          </p>
        </section>
        <PricingTable />
        <section className="faq">
          <div>
            <h3>What counts as an app?</h3>
            <p>An app you publish from the studio and keep hosted. Drafts, previews and downloads don&apos;t count. Delete an app to free its slot.</p>
          </div>
          <div>
            <h3>How am I billed?</h3>
            <p>Monthly in INR through Cashfree using UPI Autopay, card or eNACH. A ₹1 check authorises the mandate and is refunded; the first monthly charge follows within a day.</p>
          </div>
          <div>
            <h3>Can I cancel anytime?</h3>
            <p>Yes, from your dashboard. You keep your plan until the end of the paid month. After that, apps beyond the free limit pause until you upgrade again. Nothing is deleted.</p>
          </div>
          <div>
            <h3>Do I pay for AI usage?</h3>
            <p>No. You bring your own key (OpenAI, Claude, Gemini, Grok and more) and pay your provider directly.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
