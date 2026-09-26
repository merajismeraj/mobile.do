import { streamChat, ProviderError, type ChatMessage } from "@/lib/llm.ts";
import { SYSTEM_PROMPT } from "@/lib/prompt.ts";
import { UnsafeUrlError } from "@/lib/net.ts";
import { STREAM_ERROR } from "@/lib/sse.ts";

export const runtime = "nodejs";
export const maxDuration = 300;


export async function POST(req: Request) {
  let body: {
    providerId?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    maxTokens?: number;
    messages?: ChatMessage[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const messages = (body.messages ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );
  if (!body.providerId || messages.length === 0) {
    return Response.json({ error: "providerId and messages are required" }, { status: 400 });
  }
  if (JSON.stringify(messages).length > 600_000) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }

  let stream: AsyncGenerator<string>;
  try {
    stream = await streamChat(
      {
        providerId: body.providerId,
        apiKey: body.apiKey ?? "",
        model: body.model ?? "",
        baseUrl: body.baseUrl,
        maxTokens: body.maxTokens,
        system: SYSTEM_PROMPT,
        messages,
      },
      req.signal,
    );
  } catch (err) {
    if (err instanceof ProviderError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof UnsafeUrlError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: "Could not reach the AI provider" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await stream.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (err) {
        if (!req.signal.aborted) {
          const msg = err instanceof Error ? err.message : "Stream interrupted";
          controller.enqueue(encoder.encode(`${STREAM_ERROR}${msg}`));
        }
        controller.close();
      }
    },
    async cancel() {
      await stream.return(undefined);
    },
  });

  return new Response(readable, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
