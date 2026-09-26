// Minimal Server-Sent Events parser plus per-provider delta extractors.

/** Marker appended to the /api/generate text stream when a provider fails mid-stream. */
export const STREAM_ERROR = "\u0000MOBILEDO_ERROR:";

export interface SseEvent {
  event: string;
  data: string;
}

/** Incrementally parses an SSE byte stream; call push() per chunk, flush() at end. */
export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const out: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.search(/\r?\n/)) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + (this.buffer[idx] === "\r" ? 2 : 1));
      this.line(line, out);
    }
    return out;
  }

  flush(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buffer) this.line(this.buffer, out);
    this.buffer = "";
    this.line("", out);
    return out;
  }

  private line(line: string, out: SseEvent[]) {
    if (line === "") {
      if (this.data.length) out.push({ event: this.event || "message", data: this.data.join("\n") });
      this.event = "";
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
  }
}

export type DeltaResult = { text?: string; error?: string; done?: boolean };

export function openAiDelta(data: string): DeltaResult {
  if (data === "[DONE]") return { done: true };
  const json = JSON.parse(data);
  if (json.error) return { error: json.error.message ?? JSON.stringify(json.error) };
  const content = json.choices?.[0]?.delta?.content;
  return { text: typeof content === "string" ? content : "" };
}

export function anthropicDelta(ev: SseEvent): DeltaResult {
  const json = JSON.parse(ev.data);
  if (json.type === "error") return { error: json.error?.message ?? "Anthropic stream error" };
  if (json.type === "content_block_delta" && json.delta?.type === "text_delta") return { text: json.delta.text };
  if (json.type === "message_stop") return { done: true };
  return {};
}

export function geminiDelta(data: string): DeltaResult {
  const json = JSON.parse(data);
  if (json.error) return { error: json.error.message ?? "Gemini stream error" };
  const parts: Array<{ text?: string; thought?: boolean }> = json.candidates?.[0]?.content?.parts ?? [];
  return { text: parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("") };
}
