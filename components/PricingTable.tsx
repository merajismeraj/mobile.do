"use client";

import { useEffect, useRef, useState } from "react";
import { PLANS, formatInr, type PlanId } from "@/lib/plans";
import { fetchMe, openCashfreeCheckout, type Me } from "@/lib/client";

export default function PricingTable() {
  const [me, setMe] = useState<Me | null>(null);
  const [checkout, setCheckout] = useState<PlanId | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    fetchMe().then((m) => {
      setMe(m);
      const wanted = new URLSearchParams(window.location.search).get("plan");
      if (m.user && (wanted === "pro" || wanted === "scale")) start(wanted, m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (checkout && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!checkout) dialogRef.current?.close();
  }, [checkout]);

  const active = me?.subscription?.status === "ACTIVE";
  const current = me?.plan ?? "free";

  function start(plan: PlanId, who = me) {
    setError("");
    setNotice("");
    if (!who?.user) {
      window.location.href = `/auth/login?next=${encodeURIComponent(`/pricing?plan=${plan}`)}`;
      return;
    }
    if (who.subscription?.status === "ACTIVE") {
      if (confirm(`Switch to ${PLANS[plan].name}? Your app limit changes now; ${formatInr(PLANS[plan].priceInr)}/month applies from your next billing date.`)) submit(plan);
      return;
    }
    setCheckout(plan);
  }

  async function submit(plan: PlanId) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, phone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start checkout.");
      if (json.changed) {
        setNotice(`You're now on ${PLANS[plan].name}.`);
        setMe(await fetchMe());
        return;
      }
      await openCashfreeCheckout(json.sessionId, json.mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setBusy(false);
    }
  }

  function cta(id: PlanId) {
    if (id === "free") {
      return current === "free" && me?.user ? <span className="btn wide ghost" aria-disabled>current plan</span> : <a className="btn wide" href="/">start building</a>;
    }
    if (me && (!me.features.accounts || !me.features.billing)) return <span className="btn wide ghost" aria-disabled>coming soon</span>;
    if (current === id && active) return <span className="btn wide ghost" aria-disabled>current plan</span>;
    return (
      <button className="btn wide primary" disabled={busy} onClick={() => start(id)}>
        {current === id ? `renew ${PLANS[id].name}` : active ? `switch to ${PLANS[id].name}` : `get ${PLANS[id].name}`}
      </button>
    );
  }

  return (
    <>
      {!checkout && (notice || error) && (
        <p className={error ? "banner err" : "banner ok"} role={error ? "alert" : "status"}>{error || notice}</p>
      )}
      <section className="plans">
        {Object.values(PLANS).map((p) => (
          <article key={p.id} className={`plan ${p.id === "pro" ? "featured" : ""}`}>
            {p.id === "pro" && <span className="ribbon">popular</span>}
            <h2>{p.name}</h2>
            <p className="price">
              {p.priceInr ? formatInr(p.priceInr) : "₹0"}
              <small>/month</small>
            </p>
            <p className="plan-apps"><b>{p.apps}</b> hosted app{p.apps > 1 ? "s" : ""}</p>
            <p className="blurb">{p.blurb}</p>
            <ul>
              {p.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
            {cta(p.id)}
          </article>
        ))}
      </section>
      <p className="fine">Prices in INR, taxes as applicable. Billed monthly via Cashfree. Cancel anytime.</p>

      <dialog ref={dialogRef} className="modal" onClose={() => { setCheckout(null); setError(""); }}>
        {checkout && (
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              submit(checkout);
            }}
          >
            <h2>{PLANS[checkout].name} · {formatInr(PLANS[checkout].priceInr)}/month</h2>
            <p className="hint">
              You&apos;ll authorise a monthly mandate with Cashfree (UPI Autopay, card or eNACH). Cancel anytime from your dashboard.
            </p>
            <label className="field">
              <span>Mobile number (for the mandate)</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
            </label>
            {error && <p className="err-text" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setCheckout(null)}>cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? "opening checkout…" : "continue to payment"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
