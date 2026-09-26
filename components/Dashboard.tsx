"use client";

import { useCallback, useEffect, useState } from "react";
import { PLANS, formatInr } from "@/lib/plans";
import { fetchMe, type Me } from "@/lib/client";

interface HostedApp {
  id: string;
  slug: string;
  name: string;
  url: string;
  custom_domain: string | null;
  domainUrl: string | null;
  running: boolean;
  created_at: string;
  updated_at: string;
}

interface DomainStatus {
  domain: string;
  verified: boolean;
  configured: boolean;
  records: Array<{ type: string; name: string; value: string }>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [apps, setApps] = useState<HostedApp[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([fetchMe(), api<{ apps: HostedApp[] }>("/api/apps")]);
      setMe(m);
      setApps(a.apps);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your apps.");
    }
  }, []);

  useEffect(() => {
    load();
    const billing = new URLSearchParams(window.location.search).get("billing");
    if (billing === "active") setNotice("Subscription active. Your new app limit is live.");
    if (billing === "pending") setNotice("Mandate submitted. We'll activate your plan as soon as Cashfree confirms (usually a few minutes).");
  }, [load]);

  async function cancelPlan() {
    if (!confirm("Cancel your subscription? You keep your plan until the end of this billing period.")) return;
    try {
      await api("/api/billing/cancel", { method: "POST" });
      setNotice("Subscription cancelled. No further charges.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel.");
    }
  }

  async function deleteApp(app: HostedApp) {
    if (!confirm(`Delete “${app.name}”? Its URL${app.custom_domain ? " and custom domain" : ""} will stop working.`)) return;
    try {
      await api(`/api/apps/${app.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    }
  }

  if (!me || !apps) return <p className="hint">{error || "loading…"}</p>;

  const plan = PLANS[me.plan ?? "free"];
  const sub = me.subscription;
  const pct = Math.min(100, ((me.used ?? 0) / (me.limit ?? 1)) * 100);
  const cancelled = sub?.status === "CANCELLED" || sub?.status === "CUSTOMER_CANCELLED";

  return (
    <>
      <section className="page-head">
        <p className="eyebrow">$ dashboard</p>
        <h1>Your apps</h1>
      </section>
      {(notice || error) && <p className={error ? "banner err" : "banner ok"} role={error ? "alert" : "status"}>{error || notice}</p>}

      <section className="card plan-card">
        <div>
          <h2>
            {plan.name} plan {plan.priceInr > 0 && <small>{formatInr(plan.priceInr)}/month</small>}
          </h2>
          <div className="usage" aria-label={`${me.used} of ${me.limit} hosted apps used`}>
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
            <span>{me.used}/{me.limit} hosted apps</span>
          </div>
          {sub?.status === "ACTIVE" && <p className="hint">Renews monthly · next charge by {fmtDate(sub.periodEnd && new Date(new Date(sub.periodEnd).getTime() - 3 * 864e5).toISOString())}</p>}
          {cancelled && plan.id !== "free" && <p className="hint">Cancelled · access until {fmtDate(sub?.periodEnd)}</p>}
          {sub?.status && !["ACTIVE", "CANCELLED", "CUSTOMER_CANCELLED"].includes(sub.status) && plan.id === "free" && (
            <p className="hint">Last subscription status: {sub.status.toLowerCase().replace(/_/g, " ")}</p>
          )}
        </div>
        <div className="plan-actions">
          <a className="btn primary sm" href="/pricing">{plan.id === "scale" ? "change plan" : "upgrade"}</a>
          {sub?.status === "ACTIVE" && <button className="btn ghost sm" onClick={cancelPlan}>cancel subscription</button>}
        </div>
      </section>

      {apps.length === 0 ? (
        <section className="card empty-card">
          <p>No hosted apps yet. Generate one in the studio and hit <b>publish</b>.</p>
          <a className="btn primary sm" href="/">open studio</a>
        </section>
      ) : (
        <ul className="app-list">
          {apps.map((a) => (
            <AppItem key={a.id} app={a} domainsEnabled={me.features.domains} onDelete={() => deleteApp(a)} onChange={load} />
          ))}
        </ul>
      )}
    </>
  );
}

function AppItem({ app, domainsEnabled, onDelete, onChange }: { app: HostedApp; domainsEnabled: boolean; onDelete: () => void; onChange: () => void }) {
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!app.custom_domain || !domainsEnabled) return;
    try {
      setStatus((await api<{ status: DomainStatus | null }>(`/api/apps/${app.id}/domain`)).status);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not check domain.");
    }
  }, [app.id, app.custom_domain, domainsEnabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await api<{ status: DomainStatus }>(`/api/apps/${app.id}/domain`, { method: "POST", body: JSON.stringify({ domain }) });
      setStatus(res.status);
      setDomain("");
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not connect domain.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${app.custom_domain}?`)) return;
    try {
      await api(`/api/apps/${app.id}/domain`, { method: "DELETE" });
      setStatus(null);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not disconnect.");
    }
  }

  const live = status ? status.verified && status.configured : false;

  return (
    <li className="card app-item">
      <div className="app-row">
        <div className="app-main">
          <h3>
            {app.name} <span className={`badge ${app.running ? "on" : "off"}`}>{app.running ? "live" : "paused"}</span>
          </h3>
          <a href={app.url} target="_blank" rel="noreferrer">{app.url.replace(/^https?:\/\//, "")}</a>
          <small>published {fmtDate(app.created_at)} · updated {fmtDate(app.updated_at)}</small>
          {!app.running && <small className="warn-text">Over your plan limit. Upgrade or delete another app to bring it back.</small>}
        </div>
        <button className="btn ghost sm danger" onClick={onDelete}>delete</button>
      </div>

      {domainsEnabled && (
        <div className="domain">
          {app.custom_domain ? (
            <>
              <div className="domain-head">
                <span>
                  <span className={`dot ${live ? "on" : ""}`} aria-hidden />{" "}
                  <a href={`https://${app.custom_domain}`} target="_blank" rel="noreferrer">{app.custom_domain}</a>{" "}
                  <small>{status ? (live ? "connected" : "waiting for DNS") : "checking…"}</small>
                </span>
                <span className="links">
                  <button className="link" onClick={refresh}>refresh</button>
                  <button className="link" onClick={disconnect}>remove</button>
                </span>
              </div>
              {status && !live && (
                <table className="dns">
                  <thead><tr><th>type</th><th>name</th><th>value</th></tr></thead>
                  <tbody>
                    {status.records.map((r) => (
                      <tr key={r.type + r.name}><td>{r.type}</td><td>{r.name}</td><td><code>{r.value}</code></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <form className="row" onSubmit={connect}>
              <input placeholder="custom domain, e.g. app.yourbrand.com" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label={`Custom domain for ${app.name}`} />
              <button className="btn sm" disabled={busy || !domain.trim()}>{busy ? "adding…" : "connect"}</button>
            </form>
          )}
          {err && <p className="err-text" role="alert">{err}</p>}
        </div>
      )}
    </li>
  );
}
