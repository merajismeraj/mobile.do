"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS, getProvider } from "@/lib/providers";
import type { SiteSummary } from "@/lib/extract";
import { buildRefinePrompt, buildUserPrompt, type BuildBrief } from "@/lib/prompt";
import { extractHtml, isCompleteHtml, slugify } from "@/lib/pack";
import {
  CLAUDE_CODE_COMMAND, DEFAULT_SETTINGS, buildClaudeCodeKit, buildProjectZip, deleteProject, download,
  loadProjects, loadSettings, previewDoc, saveProject, saveSettings, type Project, type Settings,
} from "@/lib/client";
import { STREAM_ERROR } from "@/lib/sse";
import SettingsModal from "./SettingsModal";

type Phase = "idle" | "scraping" | "generating" | "done" | "error";
type Device = "iphone" | "android" | "tablet";
const DEVICES: Record<Device, { w: number; h: number; label: string }> = {
  iphone: { w: 393, h: 852, label: "iPhone" },
  android: { w: 412, h: 915, label: "Android" },
  tablet: { w: 820, h: 1180, label: "Tablet" },
};

const EXAMPLES = [
  "A habit tracker with streaks, reminders and a weekly heatmap",
  "Menu + online ordering app for a neighborhood coffee shop",
  "Personal finance app: budgets, recurring bills, spending insights",
  "Trail-running companion: routes, elevation, run log",
];

export default function Studio() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<"url" | "prompt">("url");
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [appName, setAppName] = useState("");
  const [style, setStyle] = useState<BuildBrief["style"]>("faithful");
  const [extra, setExtra] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [html, setHtml] = useState("");
  const [streamHtml, setStreamHtml] = useState("");
  const [versions, setVersions] = useState<string[]>([]);
  const [brief, setBrief] = useState("");
  const [source, setSource] = useState("");
  const [site, setSite] = useState<SiteSummary | null>(null);
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [refine, setRefine] = useState("");
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<Device>("iphone");
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
  const [modelsBusy, setModelsBusy] = useState(false);
  const [kitReady, setKitReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setProjects(loadProjects());
    if (!Object.values(s.keys).some(Boolean) && s.providerId !== "claude-code") setSettingsOpen(true);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const provider = getProvider(settings.providerId) ?? PROVIDERS[0];
  const isHandoff = provider.kind === "handoff";
  const model = settings.models[provider.id] ?? provider.defaultModel;
  const apiKey = settings.keys[provider.id] ?? "";
  const baseUrl = settings.baseUrls[provider.id] ?? "";
  const modelOptions = useMemo(
    () => [...new Set([...(fetchedModels[provider.id] ?? []), ...provider.models])],
    [fetchedModels, provider],
  );
  const busy = phase === "scraping" || phase === "generating";
  const shownHtml = phase === "generating" ? streamHtml : html;
  const dev = DEVICES[device];

  // Fit the device frame into the stage.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      setScale(Math.min(1, (width - 32) / (dev.w + 24), (height - 32) / (dev.h + 24)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dev]);

  async function fetchModels() {
    setModelsBusy(true);
    setError("");
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, apiKey, baseUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setFetchedModels((m) => ({ ...m, [provider.id]: json.models }));
      setStatus(`Loaded ${json.models.length} models from ${provider.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list models");
    } finally {
      setModelsBusy(false);
    }
  }

  async function scrape(): Promise<SiteSummary> {
    setPhase("scraping");
    setStatus(`Reading ${url}…`);
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not read that site");
    if (json.warning) setWarning(json.warning);
    return json.site as SiteSummary;
  }

  /** Streams a completion into the preview; resolves with the final HTML. */
  async function stream(userContent: string, label: string): Promise<string> {
    setPhase("generating");
    setStreamHtml("");
    setStatus(`${label} with ${provider.name} · ${model}`);
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await fetch("/api/generate", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: provider.id,
        apiKey,
        model,
        baseUrl,
        maxTokens: settings.maxTokens,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? `Generation failed (${res.status})`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let raw = "";
    let last = 0;
    const started = performance.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += value;
      const errAt = raw.indexOf(STREAM_ERROR);
      if (errAt !== -1) throw new Error(raw.slice(errAt + STREAM_ERROR.length));
      const now = performance.now();
      if (now - last > 700) {
        last = now;
        setStreamHtml(extractHtml(raw));
        setStatus(`${label} · ${(raw.length / 1024).toFixed(1)} KB · ${((now - started) / 1000).toFixed(0)}s`);
      }
    }
    const final = extractHtml(raw);
    if (!/<(html|body|div|main)\b/i.test(final)) {
      throw new Error("The model didn't return an HTML document. Try again or pick a stronger model.");
    }
    if (!isCompleteHtml(final)) {
      setWarning("Output looks truncated — raise “Max output tokens” in Settings, or ask the refine box to finish it.");
    }
    return final;
  }

  function commit(next: string, meta: { brief?: string; source?: string; name?: string }) {
    setHtml(next);
    setVersions((v) => [...v, next].slice(-20));
    setPhase("done");
    const id = projectId || crypto.randomUUID();
    setProjectId(id);
    const name =
      meta.name || appName || next.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "Untitled app";
    setProjects(
      saveProject({ id, name, html: next, brief: meta.brief ?? brief, source: meta.source ?? source, createdAt: Date.now() }),
    );
  }

  async function generate() {
    setError("");
    setWarning("");
    setKitReady(false);
    if (mode === "url" && !url.trim()) return setError("Enter a website URL to convert.");
    if (mode === "prompt" && !prompt.trim()) return setError("Describe the app you want.");
    if (!isHandoff && !apiKey && provider.id !== "custom") {
      setSettingsOpen(true);
      return setError(`Add your ${provider.name} API key to continue.`);
    }
    try {
      const scraped = mode === "url" ? await scrape() : null;
      setSite(scraped);
      const b: BuildBrief = { source: mode, prompt, site: scraped, appName, style, extra };
      const userPrompt = buildUserPrompt(b);
      const src = mode === "url" ? url.trim() : "a prompt";
      setBrief(userPrompt);
      setSource(src);

      if (isHandoff) {
        const { zip, meta } = await buildClaudeCodeKit({ appName, brief: userPrompt, source: src, site: scraped });
        download(`${meta.slug}-claude-code-kit.zip`, zip, "application/zip");
        setKitReady(true);
        setPhase("done");
        setStatus("Claude Code kit downloaded — unzip it and run the command below.");
        return;
      }

      setProjectId("");
      setVersions([]);
      const out = await stream(userPrompt, "Generating");
      commit(out, { brief: userPrompt, source: src, name: appName });
      setStatus("Ready — preview, refine, or download.");
    } catch (e) {
      fail(e);
    }
  }

  async function applyRefine(instruction = refine) {
    if (!html || !instruction.trim()) return;
    setError("");
    setWarning("");
    try {
      const out = await stream(buildRefinePrompt(html, instruction), "Refining");
      commit(out, {});
      setRefine("");
      setStatus("Updated.");
    } catch (e) {
      fail(e);
    }
  }

  function fail(e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      setPhase(html ? "done" : "idle");
      setStatus("Stopped.");
      return;
    }
    setPhase("error");
    setError(e instanceof Error ? e.message : String(e));
    setStatus("");
  }

  function undo() {
    if (versions.length < 2) return;
    const prev = versions.slice(0, -1);
    setVersions(prev);
    setHtml(prev[prev.length - 1]);
  }

  async function downloadZip() {
    const { zip, meta } = await buildProjectZip({ html, appName, brief, source, site });
    download(`${meta.slug}.zip`, zip, "application/zip");
  }

  function openProject(p: Project) {
    setProjectId(p.id);
    setHtml(p.html);
    setVersions([p.html]);
    setBrief(p.brief);
    setSource(p.source);
    setSite(null);
    setAppName(p.name);
    setPhase("done");
    setError("");
    setWarning("");
    setStatus(`Opened “${p.name}”.`);
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(CLAUDE_CODE_COMMAND).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>▱</span>
          <span>mobile<b>.do</b></span>
          <span className="tag">URL or idea → mobile app</span>
        </div>
        <button className="btn ghost" onClick={() => setSettingsOpen(true)}>
          <span aria-hidden>🔑</span> API keys
        </button>
      </header>

      <main className="workspace">
        <section className="panel" aria-label="Build settings">
          <div className="seg" role="tablist" aria-label="Source">
            <button role="tab" aria-selected={mode === "url"} onClick={() => setMode("url")}>From URL</button>
            <button role="tab" aria-selected={mode === "prompt"} onClick={() => setMode("prompt")}>From prompt</button>
          </div>

          {mode === "url" ? (
            <>
              <label className="field">
                <span>Website to convert</span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && generate()}
                />
              </label>
              <div className="seg small" role="radiogroup" aria-label="Conversion style">
                <button role="radio" aria-checked={style === "faithful"} onClick={() => setStyle("faithful")}>Faithful</button>
                <button role="radio" aria-checked={style === "reimagined"} onClick={() => setStyle("reimagined")}>Reimagined</button>
              </div>
              <label className="field">
                <span>Direction <em>(optional)</em></span>
                <textarea rows={2} placeholder="e.g. Focus on booking; add a loyalty tab" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Describe your app</span>
                <textarea rows={5} placeholder="What should it do, for whom, and how should it feel?" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </label>
              <div className="chips">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip" onClick={() => setPrompt(ex)}>{ex}</button>
                ))}
              </div>
            </>
          )}

          <label className="field">
            <span>App name <em>(optional)</em></span>
            <input value={appName} placeholder="Auto" onChange={(e) => setAppName(e.target.value)} />
          </label>

          <div className="field">
            <span>AI provider</span>
            <div className="row">
              <select
                value={provider.id}
                onChange={(e) => updateSettings({ providerId: e.target.value })}
                aria-label="AI provider"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.kind !== "handoff" && !settings.keys[p.id] && p.id !== "custom" ? " — no key" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isHandoff && (
            <div className="field">
              <span>Model</span>
              <div className="row">
                <input
                  list="model-options"
                  value={model}
                  onChange={(e) => updateSettings({ models: { ...settings.models, [provider.id]: e.target.value } })}
                  aria-label="Model"
                />
                <datalist id="model-options">
                  {modelOptions.map((m) => <option key={m} value={m} />)}
                </datalist>
                <button className="btn icon" title="Fetch available models" aria-label="Fetch available models" onClick={fetchModels} disabled={modelsBusy}>
                  {modelsBusy ? "…" : "↻"}
                </button>
              </div>
            </div>
          )}
          {provider.note && <p className="hint">{provider.note}</p>}

          <details className="advanced">
            <summary>Advanced</summary>
            <label className="field">
              <span>Extra constraints</span>
              <textarea rows={2} placeholder="e.g. Arabic RTL, brand color #0a7, no images" value={extra} onChange={(e) => setExtra(e.target.value)} />
            </label>
            <label className="field">
              <span>Max output tokens</span>
              <input
                type="number"
                min={2000}
                max={128000}
                step={1000}
                value={settings.maxTokens}
                onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) || DEFAULT_SETTINGS.maxTokens })}
              />
            </label>
          </details>

          <div className="actions">
            {busy ? (
              <button className="btn primary" onClick={() => abortRef.current?.abort()} disabled={phase === "scraping"}>
                <span className="spinner" aria-hidden /> {phase === "scraping" ? "Reading site…" : "Stop"}
              </button>
            ) : (
              <button className="btn primary" onClick={generate}>
                {isHandoff ? "Build Claude Code kit" : html ? "Generate new app" : "Generate mobile app"}
              </button>
            )}
          </div>

          <div className="status" aria-live="polite">
            {status && <p>{status}</p>}
            {warning && <p className="warn">{warning}</p>}
            {error && <p className="err" role="alert">{error}</p>}
          </div>

          {kitReady && (
            <div className="kit">
              <p>Unzip, <code>cd</code> into the folder, then run:</p>
              <pre>{CLAUDE_CODE_COMMAND}</pre>
              <button className="btn ghost" onClick={copyCommand}>{copied ? "Copied ✓" : "Copy command"}</button>
            </div>
          )}

          {projects.length > 0 && (
            <div className="recent">
              <h3>Recent apps</h3>
              <ul>
                {projects.map((p) => (
                  <li key={p.id} className={p.id === projectId ? "active" : ""}>
                    <button className="linkish" onClick={() => openProject(p)}>
                      {p.name}
                      <small>{new Date(p.createdAt).toLocaleDateString()}</small>
                    </button>
                    <button className="x" aria-label={`Delete ${p.name}`} onClick={() => setProjects(deleteProject(p.id))}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="output" aria-label="Output">
          <div className="toolbar">
            <div className="seg small" role="tablist" aria-label="View">
              <button role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>Preview</button>
              <button role="tab" aria-selected={tab === "code"} onClick={() => setTab("code")}>Code</button>
            </div>
            {tab === "preview" && (
              <div className="seg small" role="radiogroup" aria-label="Device">
                {(Object.keys(DEVICES) as Device[]).map((d) => (
                  <button key={d} role="radio" aria-checked={device === d} onClick={() => setDevice(d)}>{DEVICES[d].label}</button>
                ))}
              </div>
            )}
            <div className="spacer" />
            <button className="btn ghost" onClick={undo} disabled={busy || versions.length < 2}>Undo</button>
            <button
              className="btn ghost"
              disabled={!html || busy}
              onClick={() => download(`${slugify(appName || "index")}.html`, html, "text/html")}
            >
              HTML
            </button>
            <button className="btn accent" disabled={!html || busy} onClick={downloadZip} title="PWA + iOS/Android (Capacitor) project">
              Download app ↓
            </button>
          </div>

          {tab === "preview" ? (
            <div className="stage" ref={stageRef}>
              {shownHtml ? (
                <div
                  className={`device ${device}`}
                  style={{ width: dev.w + 24, height: dev.h + 24, transform: `scale(${scale})` }}
                >
                  <iframe
                    title="App preview"
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    srcDoc={previewDoc(shownHtml)}
                    style={{ width: dev.w, height: dev.h }}
                  />
                </div>
              ) : (
                <Empty busy={busy} />
              )}
            </div>
          ) : (
            <textarea
              className="code"
              spellCheck={false}
              value={shownHtml}
              readOnly={busy}
              onChange={(e) => setHtml(e.target.value)}
              onBlur={() => html && versions[versions.length - 1] !== html && setVersions((v) => [...v, html].slice(-20))}
              placeholder="Generated code appears here. You can edit it directly."
              aria-label="Generated HTML"
            />
          )}

          <form
            className="refine"
            onSubmit={(e) => {
              e.preventDefault();
              applyRefine();
            }}
          >
            <input
              value={refine}
              onChange={(e) => setRefine(e.target.value)}
              placeholder={html ? "Refine: “make the header sticky and add a search tab”" : "Generate an app first, then refine it here"}
              disabled={!html || busy || isHandoff}
              aria-label="Refinement instruction"
            />
            <button className="btn primary" disabled={!html || busy || !refine.trim() || isHandoff}>Apply</button>
          </form>
        </section>
      </main>

      {settingsOpen && (
        <SettingsModal settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

function Empty({ busy }: { busy: boolean }) {
  return (
    <div className="empty">
      <div className="ghost-phone" aria-hidden>
        <div className={busy ? "shimmer" : ""} />
      </div>
      <h2>{busy ? "Warming up…" : "Your mobile app shows up here"}</h2>
      <p>
        Paste a URL or describe an idea. You get a live preview, an installable PWA, and a Capacitor project ready for the
        App Store and Google Play.
      </p>
    </div>
  );
}
