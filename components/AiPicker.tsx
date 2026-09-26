"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { PROVIDERS, type ProviderDef } from "@/lib/providers";
import type { Settings } from "@/lib/client";

export interface AiPickerHandle {
  focusKey: () => void;
}

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  model: string;
  modelOptions: string[];
  modelsBusy: boolean;
  onFetchModels: () => void;
}

const needsKey = (p: ProviderDef) => p.kind !== "handoff" && p.id !== "custom";

/** Compact provider dropdown; the key field appears only for the selected provider. */
const AiPicker = forwardRef<AiPickerHandle, Props>(function AiPicker(
  { settings, onChange, model, modelOptions, modelsBusy, onFetchModels },
  ref,
) {
  const provider = PROVIDERS.find((p) => p.id === settings.providerId) ?? PROVIDERS[0];
  const savedKey = settings.keys[provider.id] ?? "";
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [editingKey, setEditingKey] = useState(false);
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const focusKeyNext = useRef(false);

  const showKeyInput = provider.kind !== "handoff" && (editingKey || !savedKey);

  useImperativeHandle(ref, () => ({
    focusKey: () => {
      setEditingKey(true);
      requestAnimationFrame(() => keyRef.current?.focus());
    },
  }));

  // Reset key editing state whenever the provider changes, then focus the key field if asked.
  useEffect(() => {
    setEditingKey(false);
    setDraft("");
    setReveal(false);
    if (focusKeyNext.current) {
      focusKeyNext.current = false;
      requestAnimationFrame(() => keyRef.current?.focus());
    }
  }, [provider.id]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    listRef.current?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function openList() {
    setActive(Math.max(0, PROVIDERS.findIndex((p) => p.id === provider.id)));
    setOpen(true);
  }

  function choose(p: ProviderDef) {
    const wantsKey = needsKey(p) && !settings.keys[p.id];
    setOpen(false);
    if (p.id === provider.id) {
      if (wantsKey) keyRef.current?.focus();
      else buttonRef.current?.focus();
      return;
    }
    focusKeyNext.current = wantsKey;
    if (!wantsKey) buttonRef.current?.focus();
    onChange({ providerId: p.id });
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") setActive((i) => Math.min(PROVIDERS.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(PROVIDERS.length - 1);
    else if (e.key === "Enter" || e.key === " ") choose(PROVIDERS[active]);
    else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") buttonRef.current?.focus();
      return;
    } else return;
    e.preventDefault();
  }

  function saveKey() {
    const k = draft.trim();
    if (!k) return;
    onChange({ keys: { ...settings.keys, [provider.id]: k } });
    setEditingKey(false);
    setDraft("");
    setReveal(false);
  }

  function forgetKey() {
    const keys = { ...settings.keys };
    delete keys[provider.id];
    onChange({ keys });
    setEditingKey(true);
  }

  const masked = savedKey ? `${savedKey.slice(0, 3)}…${savedKey.slice(-4)}` : "";

  return (
    <div className="ai" ref={rootRef}>
      <div className="ai-label">
        <span>AI</span>
        <small>bring your own key</small>
      </div>

      <div className="dd">
        <button
          ref={buttonRef}
          type="button"
          className="dd-btn"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`AI provider: ${provider.name}`}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={(e) => (e.key === "ArrowDown" || e.key === "ArrowUp") && (e.preventDefault(), openList())}
        >
          <span className={`dot ${provider.kind === "handoff" || savedKey || provider.id === "custom" ? "on" : ""}`} aria-hidden />
          <span className="dd-name">{provider.name}</span>
          {provider.kind !== "handoff" && <span className="dd-model">{model}</span>}
          <span className="caret" aria-hidden>▾</span>
        </button>

        {open && (
          <ul
            ref={listRef}
            className="dd-list"
            role="listbox"
            tabIndex={-1}
            aria-label="AI providers"
            aria-activedescendant={`prov-${PROVIDERS[active].id}`}
            onKeyDown={onListKey}
          >
            {PROVIDERS.map((p, i) => {
              const ready = p.kind === "handoff" || !!settings.keys[p.id] || p.id === "custom";
              return (
                <li
                  key={p.id}
                  id={`prov-${p.id}`}
                  role="option"
                  aria-selected={p.id === provider.id}
                  className={i === active ? "active" : ""}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                >
                  <span className={`dot ${ready ? "on" : ""}`} aria-hidden />
                  <span>{p.name}</span>
                  <small>{p.kind === "handoff" ? "local" : settings.keys[p.id] ? "key saved" : ""}</small>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showKeyInput && (
        <form
          className="key-row"
          onSubmit={(e) => {
            e.preventDefault();
            saveKey();
          }}
        >
          <div className="key-input">
            <input
              ref={keyRef}
              type={reveal ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={provider.keyLabel}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`${provider.name} API key`}
            />
            <button type="button" className="ghost-icon" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Hide key" : "Show key"}>
              {reveal ? "hide" : "show"}
            </button>
          </div>
          <button className="btn primary sm" disabled={!draft.trim()}>Save</button>
          {savedKey && (
            <button type="button" className="btn ghost sm" onClick={() => setEditingKey(false)}>Cancel</button>
          )}
        </form>
      )}

      {provider.kind !== "handoff" && savedKey && !editingKey && (
        <div className="key-saved">
          <span>key <code>{masked}</code></span>
          <span className="links">
            <button type="button" className="link" onClick={() => { setEditingKey(true); requestAnimationFrame(() => keyRef.current?.focus()); }}>change</button>
            <button type="button" className="link" onClick={forgetKey}>forget</button>
          </span>
        </div>
      )}

      {showKeyInput && (
        <p className="hint">
          Stored only in this browser.{" "}
          {provider.keyUrl && (
            <a href={provider.keyUrl} target="_blank" rel="noreferrer noopener">Get a {provider.name} key ↗</a>
          )}
        </p>
      )}

      {provider.kind === "handoff" && (
        <p className="hint">
          {provider.note}{" "}
          <a href={provider.keyUrl} target="_blank" rel="noreferrer noopener">Docs ↗</a>
        </p>
      )}

      {provider.kind !== "handoff" && (
        <details className="ai-more">
          <summary>model &amp; endpoint</summary>
          <div className="row">
            <input
              list="model-options"
              value={model}
              onChange={(e) => onChange({ models: { ...settings.models, [provider.id]: e.target.value } })}
              aria-label="Model"
            />
            <datalist id="model-options">
              {modelOptions.map((m) => <option key={m} value={m} />)}
            </datalist>
            <button type="button" className="btn icon" title="Fetch available models" aria-label="Fetch available models" onClick={onFetchModels} disabled={modelsBusy}>
              {modelsBusy ? "…" : "↻"}
            </button>
          </div>
          {provider.baseUrlEditable && (
            <input
              placeholder={provider.baseUrl}
              value={settings.baseUrls[provider.id] ?? ""}
              onChange={(e) => onChange({ baseUrls: { ...settings.baseUrls, [provider.id]: e.target.value.trim() } })}
              aria-label={`${provider.name} base URL`}
            />
          )}
          {provider.note && <p className="hint">{provider.note}</p>}
        </details>
      )}
    </div>
  );
});

export default AiPicker;
