// Provider registry shared by the client (settings UI) and the server (LLM proxy).
// Every provider is "bring your own key": keys live in the user's browser and are
// forwarded per request, never stored server-side.

export type ProviderKind = "openai" | "anthropic" | "gemini" | "handoff";

export interface ProviderDef {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  keyUrl: string;
  keyLabel: string;
  note?: string;
  /** Endpoint listing models, when it differs from `${baseUrl}/models`. */
  modelsUrl?: string;
  /** Users may point this provider at another host (region, proxy, local server). */
  baseUrlEditable?: boolean;
  /** Use `max_completion_tokens` instead of `max_tokens` (OpenAI reasoning models). */
  maxCompletionTokens?: boolean;
  extraHeaders?: Record<string, string>;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "o4-mini"],
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "OpenAI API key (sk-…)",
    maxCompletionTokens: true,
    baseUrlEditable: true,
  },
  {
    id: "anthropic",
    name: "Claude",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    models: ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "Anthropic API key (sk-ant-…)",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "handoff",
    baseUrl: "",
    defaultModel: "",
    models: [],
    keyUrl: "https://docs.anthropic.com/en/docs/claude-code",
    keyLabel: "No key needed — runs on your machine with your Claude subscription",
    note: "Generates a build kit (brief, scraped site data, scaffold) and a one-line command for Claude Code to build and iterate locally.",
  },
  {
    id: "gemini",
    name: "Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-pro",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    keyUrl: "https://aistudio.google.com/apikey",
    keyLabel: "Google AI Studio API key",
  },
  {
    id: "xai",
    name: "SuperGrok (xAI)",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    models: ["grok-4", "grok-code-fast-1", "grok-3-mini"],
    keyUrl: "https://console.x.ai",
    keyLabel: "xAI API key (xai-…)",
    note: "SuperGrok chat subscriptions don't include API access — create an API key at console.x.ai.",
  },
  {
    id: "llama",
    name: "Llama",
    kind: "openai",
    baseUrl: "https://api.llama.com/compat/v1",
    defaultModel: "Llama-4-Maverick-17B-128E-Instruct-FP8",
    models: ["Llama-4-Maverick-17B-128E-Instruct-FP8", "Llama-4-Scout-17B-16E-Instruct-FP8", "Llama-3.3-70B-Instruct"],
    keyUrl: "https://llama.developer.meta.com",
    keyLabel: "Meta Llama API key",
    baseUrlEditable: true,
    note: "Any OpenAI-compatible Llama host works — change the base URL for Groq, Together, Fireworks or a self-hosted Ollama.",
  },
  {
    id: "copilot",
    name: "Copilot (GitHub Models)",
    kind: "openai",
    baseUrl: "https://models.github.ai/inference",
    modelsUrl: "https://models.github.ai/catalog/models",
    defaultModel: "openai/gpt-4.1",
    models: ["openai/gpt-4.1", "openai/gpt-5", "openai/gpt-4o", "meta/Llama-4-Maverick-17B-128E-Instruct-FP8"],
    keyUrl: "https://github.com/settings/personal-access-tokens/new",
    keyLabel: "GitHub token with models:read",
    note: "Uses GitHub Models, billed against your Copilot / GitHub plan.",
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)",
    kind: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2-0905-preview",
    models: ["kimi-k2-0905-preview", "kimi-k2-turbo-preview", "kimi-latest"],
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    keyLabel: "Moonshot API key",
    baseUrlEditable: true,
  },
  {
    id: "minimax",
    name: "MiniMax",
    kind: "openai",
    baseUrl: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M2",
    models: ["MiniMax-M2", "MiniMax-M1"],
    keyUrl: "https://www.minimax.io/platform/user-center/basic-information/interface-key",
    keyLabel: "MiniMax API key",
    baseUrlEditable: true,
  },
  {
    id: "zai",
    name: "Z.AI (GLM)",
    kind: "openai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-4.6",
    models: ["glm-4.6", "glm-4.5", "glm-4.5-air"],
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    keyLabel: "Z.AI API key",
    baseUrlEditable: true,
  },
  {
    id: "qwen",
    name: "Qwen Cloud",
    kind: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3-coder-plus",
    models: ["qwen3-coder-plus", "qwen3-max", "qwen-plus"],
    keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
    keyLabel: "Alibaba Model Studio (DashScope) API key",
    baseUrlEditable: true,
    note: "Mainland China accounts: use https://dashscope.aliyuncs.com/compatible-mode/v1.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/auto",
    models: ["openrouter/auto"],
    keyUrl: "https://openrouter.ai/keys",
    keyLabel: "OpenRouter API key (sk-or-…)",
    extraHeaders: { "HTTP-Referer": "https://mobile.do", "X-Title": "mobile.do" },
    note: "One key, hundreds of models — hit ↻ to load the full catalog.",
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.3",
    models: [],
    keyUrl: "",
    keyLabel: "API key (optional for local servers)",
    baseUrlEditable: true,
    note: "Ollama, LM Studio, vLLM, LiteLLM, DeepSeek… Private/local hosts only work when you self-host mobile.do.",
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const MAX_TOKENS_DEFAULT = 16000;
