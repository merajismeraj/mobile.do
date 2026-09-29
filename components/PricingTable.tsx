"use client";

import { useEffect, useRef, useState } from "react";
import { PLANS, formatInr } from "@/lib/plans";
import { fetchMe, openCashfreeCheckout, type Me } from "@/lib/client";

export default function PricingTable() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    fetchMe().then((m) => {
      setMe(m);
      // Back from sign-in with intent to buy.
      if (m.user && new URLSearchParams(window.location.search).get("plan") === "pro" && m.plan !== "pro") setOpen(true);
    });
  }, []);

  useEffect(() => {
    if (open && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!open) dialogRef.current?.close();
  }, [open]);

  const isPro = me?.plan === "pro";
  const renewing = isPro && me?.subscription?.status !== "ACTIVE";

  function start() {
    setError("");
    if (!me?.user) {
      window.location.href = `/auth/login?next=${encodeURIComponent("/pricing?plan=pro")}`;
      return;
    }
    setOpen(true);
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro", phone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start checkout.");
      await openCashfreeCheckout(json.sessionId, json.mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = me && (!me.features.accounts || !me.features.billing);
  const pro = PLANS.pro;

  return (
    <>
      {!open && error && <p className="banner err" role="alert">{error}</p>}
      <section className="plans two">
        {Object.values(PLANS).map((p) => (
          <article key={p.id} className={`plan ${p.id === "pro" ? "featured" : ""}`}>
            <h2>{p.name}</h2>
            <p className="price">
              {formatInr(p.priceInr)}
              <small>/month</small>
            </p>
            <p className="blurb">{p.blurb}</p>
            <ul>
              {p.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
            {p.id === "free" ? (
              <a className="btn wide" href="/">start building</a>
            ) : unavailable ? (
              <span className="btn wide ghost" aria-disabled>coming soon</span>
            ) : isPro && !renewing ? (
              <a className="btn wide ghost" href="/dashboard">you&apos;re on Pro · manage</a>
            ) : (
              <button className="btn wide primary" onClick={start}>{renewing ? "renew Pro" : `get Pro · ${formatInr(pro.priceInr)}/mo`}</button>
            )}
          </article>
        ))}
      </section>
      <p className="fine">Price in INR (about $30), taxes as applicable. Billed monthly via Cashfree. Cancel anytime.</p>

      <dialog ref={dialogRef} className="modal" onClose={() => { setOpen(false); setError(""); }}>
        {open && (
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <h2>Pro · {formatInr(pro.priceInr)}/month</h2>
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
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? "opening checkout…" : "continue to payment"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
