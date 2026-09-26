import { listModels, ProviderError } from "@/lib/llm.ts";
import { UnsafeUrlError } from "@/lib/net.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { providerId, apiKey, baseUrl } = await req.json();
    const models = await listModels(String(providerId ?? ""), String(apiKey ?? ""), baseUrl);
    return Response.json({ models });
  } catch (err) {
    if (err instanceof ProviderError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof UnsafeUrlError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: "Could not list models" }, { status: 502 });
  }
}
