# mobile.do

Turn **any URL or any idea** into a full-fledged mobile app: live device preview, an installable offline-ready **PWA**, and a **Capacitor** project that builds to iOS and Android. Bring your own AI: keys stay in your browser.

## Supported AI providers (BYOK)

| Provider | API | Notes |
|---|---|---|
| OpenAI | `api.openai.com/v1` | GPT-5 family and others |
| Claude | Anthropic Messages API | Opus / Sonnet / Haiku |
| Claude Code | local handoff | Downloads a build kit plus a one-line `claude` command. No API key, uses your Claude plan |
| Gemini | Google Generative Language API | Thinking parts filtered from output |
| SuperGrok (xAI) | `api.x.ai/v1` | Needs an API key from console.x.ai |
| Llama | Meta Llama API (OpenAI-compatible) | Base URL is editable, so Groq, Together, Fireworks and Ollama also work |
| Copilot | GitHub Models | GitHub token with `models:read` |
| Kimi | Moonshot | |
| MiniMax | `api.minimax.io/v1` | |
| Z.AI | GLM `api.z.ai/api/paas/v4` | |
| Qwen Cloud | DashScope compatible mode | Intl endpoint by default; editable for CN |
| OpenRouter | `openrouter.ai/api/v1` | Hundreds of models behind one key |
| Custom | any OpenAI-compatible endpoint | vLLM, LM Studio, LiteLLM, DeepSeek… |

The **↻** button next to the model field loads the live model catalog from the provider, so new models work without a code change.

## How it works

1. **Read.** For URL input, the server fetches the page (SSRF-guarded, with every redirect hop re-validated) and pulls out a digest: title, brand palette, fonts, nav, headings, images, CTAs and text.
2. **Generate.** `/api/generate` streams from your chosen provider through one normalized gateway (`lib/llm.ts`) that speaks OpenAI-compatible, Anthropic and Gemini SSE. The preview renders progressively while tokens arrive.
3. **Refine.** Ask for changes in plain language. Every version is kept, with undo. You can also edit the code directly.
4. **Ship.** *Download app* gives you:
   ```
   <slug>/www/index.html          # the app, PWA-wired
   <slug>/www/manifest.webmanifest
   <slug>/www/sw.js               # offline cache
   <slug>/www/icons/*.png|svg     # brand-colored icons
   <slug>/capacitor.config.json   # iOS/Android shell
   <slug>/package.json            # npm run android / npm run ios
   <slug>/CLAUDE.md               # keep iterating with Claude Code
   <slug>/site.json               # source-site digest (URL mode)
   ```

## Security model

- API keys live only in the browser's `localStorage`. They are sent per request and never stored or logged on the server.
- The generated app runs in an `iframe` sandbox **without** `allow-same-origin`, so its code can't read mobile.do's storage (your keys). An in-memory `localStorage` shim keeps generated apps working inside the preview.
- Outbound fetches (the sites you convert, custom base URLs) are blocked from reaching private, loopback, link-local and metadata addresses. Set `ALLOW_PRIVATE_NETWORK=true` only when self-hosting and you want local models such as Ollama. It is on automatically in `next dev`.
- Built-in providers keep a fixed base URL unless the provider is explicitly marked editable.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (zip, extraction, SSE, SSRF guard, packaging)
npm run build && npm start
```

Deploys to Vercel as-is. `/api/generate` sets `maxDuration = 300` for long generations.

## Layout

```
app/api/scrape     URL → site digest
app/api/generate   streaming LLM proxy
app/api/models     live model catalog per provider
lib/providers.ts   provider registry
lib/llm.ts         unified streaming gateway
lib/extract.ts     HTML → site digest (no deps)
lib/pack.ts        PWA/Capacitor packaging
lib/zip.ts         dependency-free zip writer
components/        Studio UI + BYOK settings
```
