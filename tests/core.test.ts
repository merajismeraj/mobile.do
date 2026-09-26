import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip, crc32 } from "../lib/zip.ts";
import { extractSite } from "../lib/extract.ts";
import { SseParser, openAiDelta, anthropicDelta, geminiDelta } from "../lib/sse.ts";
import { isPrivateIp } from "../lib/net.ts";
import { extractHtml, injectPwa, deriveMeta, isCompleteHtml, manifest } from "../lib/pack.ts";
import { buildUserPrompt } from "../lib/prompt.ts";
import { PROVIDERS } from "../lib/providers.ts";

test("crc32 matches known vector", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zip opens with a standard unzip implementation", () => {
  const zip = createZip([
    { path: "app/www/index.html", data: "<h1>hé</h1>" },
    { path: "app/icon.bin", data: new Uint8Array([0, 1, 2, 255]) },
  ]);
  const dir = mkdtempSync(join(tmpdir(), "mdo-"));
  const file = join(dir, "t.zip");
  writeFileSync(file, zip);
  const out = execFileSync("python3", [
    "-c",
    "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.read('app/www/index.html').decode());print(list(z.read('app/icon.bin')))",
    file,
  ]).toString();
  assert.match(out, /<h1>hé<\/h1>/);
  assert.match(out, /\[0, 1, 2, 255\]/);
});

test("extractSite pulls brand, nav, content and absolutizes URLs", () => {
  const html = `<!doctype html><html lang="en"><head><title>Acme &amp; Co | Home</title>
    <meta name="description" content="Rockets for everyone"><meta name="theme-color" content="#ff5500">
    <link rel="icon" href="/fav.png"><style>body{color:#123456} .a{color:#123456} .b{background:#abc}</style>
    <script>var secret = "nope";</script></head><body>
    <nav><a href="/shop">Shop</a><a href="/about">About us</a><a href="#top">Top</a></nav>
    <h1>Launch today</h1><p>Fast &mdash; reliable rockets.</p><img src="/hero.jpg" alt="Rocket">
    <button>Buy now</button></body></html>`;
  const s = extractSite(html, "https://acme.test/");
  assert.equal(s.title, "Acme & Co | Home");
  assert.equal(s.description, "Rockets for everyone");
  assert.equal(s.themeColor, "#ff5500");
  assert.equal(s.favicon, "https://acme.test/fav.png");
  assert.deepEqual(s.nav.map((n) => n.href), ["https://acme.test/shop", "https://acme.test/about"]);
  assert.equal(s.headings[0].text, "Launch today");
  assert.equal(s.images[0].src, "https://acme.test/hero.jpg");
  assert.deepEqual(s.ctas, ["Buy now"]);
  assert.equal(s.palette[0], "#123456");
  assert.ok(s.text.includes("Fast — reliable rockets."));
  assert.ok(!s.text.includes("secret"));
});

test("SSE parser handles split chunks and CRLF", () => {
  const p = new SseParser();
  const events = [
    ...p.push('event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel'),
    ...p.push('lo"}}\r\n\r\ndata: [DONE]\n\n'),
    ...p.flush(),
  ];
  assert.equal(events.length, 2);
  assert.equal(anthropicDelta(events[0]).text, "Hello");
  assert.equal(openAiDelta(events[1].data).done, true);
});

test("delta extractors per provider format", () => {
  assert.equal(openAiDelta('{"choices":[{"delta":{"content":"<html>"}}]}').text, "<html>");
  assert.equal(openAiDelta('{"error":{"message":"bad key"}}').error, "bad key");
  assert.equal(
    geminiDelta('{"candidates":[{"content":{"parts":[{"text":"think","thought":true},{"text":"<div>"}]}}]}').text,
    "<div>",
  );
  assert.equal(anthropicDelta({ event: "error", data: '{"type":"error","error":{"message":"overloaded"}}' }).error, "overloaded");
});

test("private IP detection", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0", "100.64.1.1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111", "1.1.1.1"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("extractHtml handles fenced, partial and prose-wrapped output", () => {
  assert.equal(extractHtml("Sure!\n```html\n<!DOCTYPE html><html><body>x</body></html>\n```\nEnjoy"), "<!DOCTYPE html><html><body>x</body></html>");
  assert.equal(extractHtml("```html\n<!doctype html><html><body>partial"), "<!doctype html><html><body>partial");
  assert.equal(extractHtml("Here: <!doctype html><html></html> trailing"), "<!doctype html><html></html>");
  assert.equal(isCompleteHtml("<html></html>"), true);
  assert.equal(isCompleteHtml("<html><body>"), false);
});

test("injectPwa wires manifest, icons and service worker once", () => {
  const html = `<!doctype html><html><head><title>Trail Buddy – Run more</title><meta name="theme-color" content="#0a7f5a"></head><body><p>hi</p></body></html>`;
  const meta = deriveMeta(html);
  assert.equal(meta.name, "Trail Buddy");
  assert.equal(meta.themeColor, "#0a7f5a");
  assert.equal(meta.slug, "trail-buddy");
  const out = injectPwa(html, meta);
  assert.equal(out.match(/rel="manifest"/g)?.length, 1);
  assert.equal(out.match(/theme-color/g)?.length, 1);
  assert.match(out, /serviceWorker\.register\("sw\.js"\)[\s\S]*<\/body>/);
  assert.equal(JSON.parse(manifest(meta)).display, "standalone");
});

test("prompt includes source site digest", () => {
  const site = extractSite("<title>Shop</title><h1>Sale</h1><p>Everything 50% off this week.</p>", "https://shop.test/");
  const p = buildUserPrompt({ source: "url", prompt: "", site, style: "faithful" });
  assert.match(p, /<source_site>[\s\S]*Everything 50% off/);
});

test("all requested providers are registered", () => {
  const names = PROVIDERS.map((p) => p.name).join(" ");
  for (const n of ["OpenAI", "Claude", "Claude Code", "Gemini", "SuperGrok", "Llama", "Copilot", "Kimi", "MiniMax", "Z.AI", "Qwen", "OpenRouter"]) {
    assert.ok(names.includes(n), n);
  }
});
