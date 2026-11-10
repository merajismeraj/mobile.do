"use client";

import { useEffect, useRef, useState } from "react";

// Shown once per browser session: greets every visit without nagging on each page.
const SEEN_KEY = "mobiledo.welcomed";
export const WELCOME_COPY =
  "Paste any URL or describe an idea. mobile.do builds a real mobile app you can preview, install as a PWA, ship to iOS/Android and host.";

export default function WelcomeModal() {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
    } catch {
      /* storage blocked: still show it */
    }
    setShow(true);
  }, []);

  useEffect(() => {
    if (show && !ref.current?.open) {
      ref.current?.showModal();
      ctaRef.current?.focus();
    }
  }, [show]);

  function close() {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    ref.current?.close();
    setShow(false);
  }

  if (!show) return null;
  return (
    <dialog
      ref={ref}
      className="modal welcome"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-copy"
      onClose={close}
      onClick={(e) => e.target === ref.current && close()}
    >
      <div className="modal-body">
        <div className="welcome-brand" id="welcome-title">
          <span className="logo" aria-hidden>&gt;_</span>
          <span>mobile<b>.do</b></span>
        </div>
        <p id="welcome-copy">{WELCOME_COPY}</p>
        <div className="modal-actions">
          <a className="btn ghost" href="/pricing" onClick={close}>pricing</a>
          <button ref={ctaRef} className="btn primary" onClick={close}>start building →</button>
        </div>
      </div>
    </dialog>
  );
}
