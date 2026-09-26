"use client";

import { useEffect, useRef, useState } from "react";
import { PROVIDERS } from "@/lib/providers";
import type { Settings } from "@/lib/client";

export default function SettingsModal({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reveal, setReveal] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  const setKey = (id: string, value: string) => onChange({ keys: { ...settings.keys, [id]: value.trim() } });
  const setBase = (id: string, value: string) => onChange({ baseUrls: { ...settings.baseUrls, [id]: value.trim() } });

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose} onClick={(e) => e.target === dialogRef.current && onClose()}>
      <div className="modal-body">
        <header>
          <h2>Bring your own AI</h2>
          <button className="x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <p className="hint">
          Keys are saved only in this browser (localStorage) and sent with each request straight through to the provider.
          mobile.do never stores or logs them. Pick the provider you want to build with.
        </p>
        <ul className="providers">
          {PROVIDERS.map((p) => {
            const active = settings.providerId === p.id;
            const hasKey = !!settings.keys[p.id];
            return (
              <li key={p.id} className={active ? "active" : ""}>
                <div className="prov-head">
                  <label className="radio">
                    <input
                      type="radio"
                      name="provider"
                      checked={active}
                      onChange={() => onChange({ providerId: p.id })}
                    />
                    <strong>{p.name}</strong>
                    {p.kind === "handoff" ? <span className="pill">local</span> : hasKey && <span className="pill ok">key saved</span>}
                  </label>
                  {p.keyUrl && (
                    <a href={p.keyUrl} target="_blank" rel="noreferrer noopener">
                      {p.kind === "handoff" ? "Docs ↗" : "Get key ↗"}
                    </a>
                  )}
                </div>
                {p.kind !== "handoff" ? (
                  <div className="row">
                    <input
                      type={reveal === p.id ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={p.keyLabel}
                      value={settings.keys[p.id] ?? ""}
                      onChange={(e) => setKey(p.id, e.target.value)}
                      aria-label={`${p.name} API key`}
                    />
                    <button className="btn icon" type="button" onClick={() => setReveal(reveal === p.id ? null : p.id)} aria-label="Show key">
                      {reveal === p.id ? "🙈" : "👁"}
                    </button>
                  </div>
                ) : (
                  <p className="hint">{p.keyLabel}</p>
                )}
                {p.baseUrlEditable && (
                  <input
                    className="base"
                    placeholder={`Base URL · ${p.baseUrl}`}
                    value={settings.baseUrls[p.id] ?? ""}
                    onChange={(e) => setBase(p.id, e.target.value)}
                    aria-label={`${p.name} base URL`}
                  />
                )}
                {p.note && <p className="hint">{p.note}</p>}
              </li>
            );
          })}
        </ul>
        <footer>
          <button className="btn ghost" onClick={() => onChange({ keys: {} })}>Clear all keys</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </dialog>
  );
}
