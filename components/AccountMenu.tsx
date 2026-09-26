"use client";

import { useEffect, useRef, useState } from "react";
import { fetchMe, type Me } from "@/lib/client";

export default function AccountMenu({ onMe }: { onMe?: (me: Me) => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMe().then((m) => {
      setMe(m);
      onMe?.(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const next = typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;

  return (
    <nav className="nav" aria-label="Account">
      <a href="/pricing" className="nav-link">pricing</a>
      {me?.user ? (
        <div className="acct" ref={ref}>
          <button className="acct-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {me.user.avatar ? <img src={me.user.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{(me.user.name ?? me.user.email)[0]?.toUpperCase()}</span>}
            <span className="plan-pill">{me.plan}</span>
          </button>
          {open && (
            <div className="menu" role="menu">
              <div className="menu-head">
                <strong>{me.user.name ?? me.user.email}</strong>
                <small>{me.user.email}</small>
                <small>{me.used}/{me.limit} hosted apps</small>
              </div>
              <a role="menuitem" href="/dashboard">dashboard</a>
              <a role="menuitem" href="/pricing">plans &amp; billing</a>
              <form action="/auth/logout" method="post">
                <button role="menuitem" type="submit">sign out</button>
              </form>
            </div>
          )}
        </div>
      ) : me?.features.accounts ? (
        <a className="btn sm" href={`/auth/login?next=${encodeURIComponent(next)}`}>sign in</a>
      ) : null}
    </nav>
  );
}
