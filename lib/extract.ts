// Dependency-free HTML → structured site summary. Deliberately regex-based: we only
// need a faithful content/brand digest for the LLM, not a spec-compliant DOM.

export interface SiteSummary {
  url: string;
  title: string;
  description: string;
  lang: string;
  themeColor: string;
  favicon: string;
  ogImage: string;
  palette: string[];
  fonts: string[];
  nav: Array<{ text: string; href: string }>;
  headings: Array<{ level: number; text: string }>;
  images: Array<{ src: string; alt: string }>;
  ctas: string[];
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
}

function absolutize(href: string, base: string): string {
  if (!href || href.startsWith("data:") || href.startsWith("javascript:")) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function meta(html: string, key: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = (attr(tag, "name") || attr(tag, "property")).toLowerCase();
    if (k === key) return attr(tag, "content");
  }
  return "";
}

function uniqueBy<T>(items: T[], key: (t: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractSite(rawHtml: string, pageUrl: string, maxText = 12_000): SiteSummary {
  const styles = (rawHtml.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []).join("\n");
  const inlineStyles = (rawHtml.match(/\sstyle\s*=\s*"[^"]*"/gi) ?? []).join("\n");
  const html = rawHtml
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ");

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = clean(titleMatch?.[1] ?? "") || meta(html, "og:title");
  const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang");

  let favicon = "";
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, "rel").toLowerCase();
    if (rel.includes("apple-touch-icon") || (!favicon && rel.includes("icon"))) {
      favicon = absolutize(attr(tag, "href"), pageUrl) || favicon;
    }
  }

  const nav = uniqueBy(
    [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .map((m) => ({ text: clean(m[2]).slice(0, 60), href: absolutize(attr(`<a ${m[1]}>`, "href"), pageUrl) }))
      .filter((l) => l.text && l.href && !l.href.includes("#") && l.text.length > 1),
    (l) => l.text.toLowerCase(),
    30,
  );

  const headings = [...html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => ({ level: Number(m[1]), text: clean(m[2]).slice(0, 160) }))
    .filter((h) => h.text)
    .slice(0, 40);

  const images = uniqueBy(
    [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => {
      const tag = m[0];
      const srcset = attr(tag, "srcset").split(",")[0]?.trim().split(/\s+/)[0] ?? "";
      const src = attr(tag, "src") || attr(tag, "data-src") || srcset;
      return { src: absolutize(src, pageUrl), alt: attr(tag, "alt").slice(0, 120) };
    }).filter((i) => i.src && (i.alt || !/\.(svg|gif)(\?|$)/i.test(i.src))), // skip decorative svg/gif
    (i) => i.src,
    24,
  );

  const ctas = uniqueBy(
    [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => clean(m[1]).slice(0, 50)),
    (t) => t.toLowerCase(),
    15,
  ).filter(Boolean);

  const colorCounts = new Map<string, number>();
  for (const m of `${styles}\n${inlineStyles}`.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let hex = m[1].toLowerCase();
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (["ffffff", "000000"].includes(hex)) continue;
    colorCounts.set(`#${hex}`, (colorCounts.get(`#${hex}`) ?? 0) + 1);
  }
  const palette = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);

  const fonts = uniqueBy(
    [...styles.matchAll(/font-family\s*:\s*([^;}{]+)/gi)].map((m) => m[1].split(",")[0].replace(/["']/g, "").trim()),
    (f) => f.toLowerCase(),
    4,
  ).filter((f) => f && !/^(inherit|initial|var\()/i.test(f));

  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1)
    .filter((l, i, arr) => arr.indexOf(l) === i)
    .join("\n")
    .slice(0, maxText);

  return {
    url: pageUrl,
    title,
    description: meta(html, "description") || meta(html, "og:description"),
    lang,
    themeColor: meta(html, "theme-color"),
    favicon,
    ogImage: absolutize(meta(html, "og:image"), pageUrl),
    palette,
    fonts,
    nav,
    headings,
    images,
    ctas,
    text,
  };
}
