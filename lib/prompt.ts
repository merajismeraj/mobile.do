// Prompt construction for generation and refinement.

import type { SiteSummary } from "./extract.ts";

export interface BuildBrief {
  source: "url" | "prompt";
  prompt: string;
  site?: SiteSummary | null;
  appName?: string;
  style: "faithful" | "reimagined";
  extra?: string;
}

export const SYSTEM_PROMPT = `You are mobile.do, a senior mobile product designer and front-end engineer.
You turn websites and product ideas into production-quality, installable mobile web apps.

OUTPUT CONTRACT
- Reply with exactly ONE complete HTML document inside a single \`\`\`html code block. No prose before or after.
- Self-contained: all CSS in <style>, all JS in <script>. No build step, no frameworks, no external JS/CSS.
  External images are fine only when they are absolute https URLs taken from the provided source site.
  Otherwise use inline SVG, emoji, CSS gradients or shapes.
- Do NOT add a web manifest, service worker or icons; mobile.do injects those.

MOBILE APP QUALITY BAR
- <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"> and <meta name="theme-color">.
- App shell: sticky top app bar + bottom tab bar (3–5 tabs) with hash-based routing (#/home, #/…) between real screens.
  Every screen must have real, specific content — never lorem ipsum, never "coming soon".
- Respect safe areas with env(safe-area-inset-*). Touch targets ≥ 44px. Base font 16px. No horizontal scroll at 320px.
- Native feel: system font stack, smooth transitions between screens, active/pressed states, pull-down-friendly layout,
  cards and lists over dense tables, sheets/drawers for secondary navigation, sticky primary CTA where useful.
- Light + dark themes via prefers-color-scheme using CSS custom properties.
- Accessible: semantic landmarks, aria-current on the active tab, labels on icon buttons, visible focus, contrast ≥ 4.5:1.
- Interactive where it matters: working search/filter, forms with validation, toggles, carts or favorites stored in
  localStorage (always wrap storage access in try/catch).
- Performance: no layout shift, lazy-load images (loading="lazy"), keep the document under ~60KB.`;

function siteBlock(site: SiteSummary): string {
  const lines = [
    `URL: ${site.url}`,
    `Title: ${site.title}`,
    site.description && `Description: ${site.description}`,
    site.lang && `Language: ${site.lang}`,
    site.themeColor && `Theme color: ${site.themeColor}`,
    site.palette.length && `Brand palette (by frequency): ${site.palette.join(", ")}`,
    site.fonts.length && `Fonts: ${site.fonts.join(", ")}`,
    site.favicon && `Logo/icon: ${site.favicon}`,
    site.ogImage && `Hero/share image: ${site.ogImage}`,
    site.nav.length && `Navigation:\n${site.nav.map((n) => `- ${n.text} → ${n.href}`).join("\n")}`,
    site.headings.length && `Headings:\n${site.headings.map((h) => `${"  ".repeat(h.level - 1)}- ${h.text}`).join("\n")}`,
    site.images.length && `Images:\n${site.images.map((i) => `- ${i.src}${i.alt ? ` (${i.alt})` : ""}`).join("\n")}`,
    site.ctas.length && `Calls to action: ${site.ctas.join(" | ")}`,
    `Page text:\n${site.text}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildUserPrompt(brief: BuildBrief): string {
  const parts: string[] = [];
  if (brief.source === "url" && brief.site) {
    parts.push(
      brief.style === "faithful"
        ? "Convert this website into a mobile app. Preserve its brand (colors, logo, tone), its information architecture and its real content — rewritten for small screens, not invented."
        : "Reimagine this website as a best-in-class native-feeling mobile app. Keep the brand and real content, but freely redesign flows and navigation for mobile.",
      `<source_site>\n${siteBlock(brief.site)}\n</source_site>`,
    );
    if (brief.prompt.trim()) parts.push(`Additional direction: ${brief.prompt.trim()}`);
  } else {
    parts.push(`Build this mobile app: ${brief.prompt.trim()}`);
  }
  if (brief.appName?.trim()) parts.push(`App name: ${brief.appName.trim()}`);
  if (brief.extra?.trim()) parts.push(`Constraints: ${brief.extra.trim()}`);
  return parts.join("\n\n");
}

export function buildRefinePrompt(currentHtml: string, instruction: string): string {
  return `Here is the current app:\n\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nApply this change and return the COMPLETE updated HTML document (same output contract):\n${instruction.trim()}`;
}
