// Server-side LLM gateway: one streaming interface over OpenAI-compatible,
// Anthropic and Gemini APIs. Keys arrive per request and are never persisted or logged.

import { getProvider, MAX_TOKENS_DEFAULT, type ProviderDef } from "./providers.ts";
import { SseParser, openAiDelta, anthropicDelta, geminiDelta, type DeltaResult, type SseEvent } from "./sse.ts";
import { assertPublicUrl } from "./net.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  system: string;
  messages: ChatMessage[];
}

export class ProviderError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

async function resolveProvider(providerId: string, baseUrl?: string): Promise<{ def: ProviderDef; base: string }> {
  const def = getProvider(providerId);
  if (!def || def.kind === "handoff") throw new ProviderError(`Unknown provider "${providerId}"`, 400);
  let base = def.baseUrl;
  if (baseUrl && baseUrl.trim() && baseUrl.trim() !== def.baseUrl) {
    if (!def.baseUrlEditable) throw new ProviderError(`${def.name} does not allow a custom base URL`, 400);
    base = (await assertPublicUrl(baseUrl.trim())).toString();
  }
  return { def, base: base.replace(/\/+$/, "") };
}

async function upstreamError(res: Response, def: ProviderDef): Promise<ProviderError> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const err = Array.isArray(json) ? json[0]?.error : json.error;
      detail = err?.message ?? json.message ?? (typeof err === "string" ? err : "") ?? text;
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? " — check your API key in Settings."
      : res.status === 404
        ? " — the model name may be wrong; hit ↻ to list available models."
        : res.status === 429
          ? " — rate limited or out of credits."
          : "";
  return new ProviderError(`${def.name} ${res.status}: ${String(detail).slice(0, 400)}${hint}`, res.status >= 500 ? 502 : res.status);
}

/** Streams plain text deltas. Throws ProviderError before the first byte on HTTP errors. */
export async function streamChat(req: ChatRequest, signal?: AbortSignal): Promise<AsyncGenerator<string>> {
  const { def, base } = await resolveProvider(req.providerId, req.baseUrl);
  const maxTokens = Math.min(Math.max(req.maxTokens || MAX_TOKENS_DEFAULT, 1024), 128_000);
  const model = req.model.trim() || def.defaultModel;
  if (!req.apiKey && def.id !== "custom") throw new ProviderError(`Add your ${def.name} API key in Settings.`, 401);

  let res: Response;
  let parse: (ev: SseEvent) => DeltaResult;

  if (def.kind === "anthropic") {
    res = await fetch(`${base}/messages`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system: req.system, messages: req.messages }),
    });
    parse = anthropicDelta;
  } else if (def.kind === "gemini") {
    res = await fetch(`${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    parse = (ev) => geminiDelta(ev.data);
  } else {
    const headers: Record<string, string> = { "content-type": "application/json", ...def.extraHeaders };
    if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        [def.maxCompletionTokens ? "max_completion_tokens" : "max_tokens"]: maxTokens,
        messages: [{ role: "system", content: req.system }, ...req.messages],
      }),
    });
    parse = (ev) => openAiDelta(ev.data);
  }

  if (!res.ok || !res.body) throw await upstreamError(res, def);
  const body = res.body;

  return (async function* () {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    const parser = new SseParser();
    try {
      while (true) {
        const { done, value } = await reader.read();
        const events = done ? parser.flush() : parser.push(value);
        for (const ev of events) {
          let delta: DeltaResult;
          try {
            delta = parse(ev);
          } catch {
            continue; // keep-alives or non-JSON frames
          }
          if (delta.error) throw new ProviderError(`${def.name}: ${delta.error}`);
          if (delta.text) yield delta.text;
          if (delta.done) return;
        }
        if (done) return;
      }
    } finally {
      reader.releaseLock();
    }
  })();
}

export async function listModels(providerId: string, apiKey: string, baseUrl?: string): Promise<string[]> {
  const { def, base } = await resolveProvider(providerId, baseUrl);
  let res: Response;
  const signal = AbortSignal.timeout(15_000);
  if (def.kind === "anthropic") {
    res = await fetch(`${base}/models?limit=100`, {
      signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
  } else if (def.kind === "gemini") {
    res = await fetch(`${base}/models?pageSize=200`, { signal, headers: { "x-goog-api-key": apiKey } });
  } else {
    const headers: Record<string, string> = { ...def.extraHeaders };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const url = def.modelsUrl && base === def.baseUrl.replace(/\/+$/, "") ? def.modelsUrl : `${base}/models`;
    res = await fetch(url, { signal, headers });
  }
  if (!res.ok) throw await upstreamError(res, def);
  const json = await res.json();

  if (def.kind === "gemini") {
    return (json.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""));
  }
  const list: Array<{ id?: string; name?: string }> = Array.isArray(json) ? json : (json.data ?? json.models ?? []);
  return list.map((m) => m.id ?? m.name ?? "").filter(Boolean).sort();
}
