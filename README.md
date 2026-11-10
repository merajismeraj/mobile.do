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

## Plans, accounts and hosting

| Plan | Price | What you get |
|---|---|---|
| Free | ₹0 | Unlimited generation, refinement and live preview. No account needed. |
| Pro | ₹2,499 / month (about $30) | Unlimited apps: downloads (HTML, PWA + iOS/Android zip, Claude Code kit), source-code view, and hosting with a custom domain per app |

- **Accounts:** Google sign-in through Supabase Auth.
- **Billing:** Cashfree Subscriptions, charged monthly in INR by UPI Autopay, card or eNACH. Users can cancel anytime and keep Pro until the end of the paid month. After that, hosted apps pause (they aren't deleted) until the user renews.
- **Enforcement:**
  - Hosting is enforced in Postgres. A trigger allows free accounts 0 published apps and Pro accounts unlimited.
  - Downloads and the code view are gated in the studio UI. The generated app is assembled in the browser, so a determined user could still copy it from devtools.
  - The paywall only turns on once accounts and Cashfree are configured; until then downloads stay open.
- **Isolation:** hosted apps are served from `APPS_HOST` or the app's custom domain, never from the studio origin. Their code therefore can't read the studio session or the API keys in its localStorage.

### Setup

All variables are listed in `.env.example`. Set them in Vercel → Project → Settings → Environment Variables.

1. **Supabase**
   - Create a project.
   - Run `supabase/migrations/0001_billing_and_hosting.sql` in the SQL editor.
   - Copy the project URL, the anon key and the service-role key.
2. **Google sign-in**
   - In Google Cloud, create an OAuth client (type: Web application). Set its authorised redirect URI to `https://<project>.supabase.co/auth/v1/callback`.
   - In Supabase → Authentication → Providers → Google, paste the client ID and secret.
   - In Supabase → Authentication → URL Configuration, set Site URL to `APP_URL` and add `APP_URL/auth/callback` to the redirect URLs.
3. **Cashfree**
   - Enable Subscriptions on your account, then copy the App ID and Secret Key (use sandbox keys first).
   - Add a webhook for subscription events pointing to `APP_URL/api/billing/webhook`.
   - The plan (`mobiledo_pro_inr_2499_monthly`) is created automatically on the first checkout.
4. **Apps host:** add `APPS_HOST` (for example `mobile-do-apps.vercel.app`) as a domain on this Vercel project.
5. **Custom domains:** create a Vercel access token scoped to this team. Users then connect domains from their dashboard and are shown the DNS records to add.

Each feature switches itself off cleanly while its variables are missing: the studio keeps working with downloads open, and pricing shows "coming soon".

## Deployment

Production: https://mobile-do.vercel.app, deployed from `main` on every merge.
Any other branch gets its own preview URL.
