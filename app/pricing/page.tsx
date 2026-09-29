import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import PricingTable from "@/components/PricingTable";

export const metadata: Metadata = {
  title: "Pricing — mobile.do",
  description: "Generate and preview free. Pro is ₹2,499/month for unlimited apps, downloads and hosting. Cancel anytime.",
};

export default function PricingPage() {
  return (
    <div className="app">
      <SiteHeader />
      <main className="page">
        <section className="page-head">
          <p className="eyebrow">$ pricing</p>
          <h1>One plan. Unlimited apps. Cancel anytime.</h1>
          <p className="lede">
            Generate and preview as many apps as you like for free with your own AI key. Go Pro to download them as
            PWA, iOS and Android projects, and to host them on your own domains.
          </p>
        </section>
        <PricingTable />
        <section className="faq">
          <div>
            <h3>What&apos;s free?</h3>
            <p>Everything up to the download: generating from a URL or prompt, refining, and the live phone preview. No account needed.</p>
          </div>
          <div>
            <h3>What does Pro unlock?</h3>
            <p>Downloads (single HTML, PWA + iOS/Android project zip, Claude Code kit) and hosting unlimited apps with a custom domain each.</p>
          </div>
          <div>
            <h3>How am I billed?</h3>
            <p>₹2,499 a month in INR through Cashfree using UPI Autopay, card or eNACH. A ₹1 check authorises the mandate and is refunded; the first monthly charge follows within a day.</p>
          </div>
          <div>
            <h3>Can I cancel anytime?</h3>
            <p>Yes, from your dashboard. Pro stays active until the end of the paid month. After that, hosted apps pause until you renew. Nothing you downloaded or published is deleted.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
