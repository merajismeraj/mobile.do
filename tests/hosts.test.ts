import { test } from "node:test";
import assert from "node:assert/strict";
import { isStudioHost } from "../lib/hosts.ts";

test("without APP_URL every host is the studio (fail safe)", () => {
  for (const h of ["www.mobile.do", "mobile.do", "shop.example.com", "mobile-do.vercel.app"]) {
    assert.equal(isStudioHost(h, undefined, undefined), true, h);
  }
});

test("APP_URL apex and www are both the studio; other domains are hosted apps", () => {
  const app = "https://www.mobile.do";
  assert.equal(isStudioHost("www.mobile.do", app, undefined), true);
  assert.equal(isStudioHost("mobile.do", app, undefined), true);
  assert.equal(isStudioHost("WWW.MOBILE.DO", "https://mobile.do", undefined), true);
  assert.equal(isStudioHost("mobile-do.vercel.app", app, "mobile-do-apps.vercel.app"), true);
  assert.equal(isStudioHost("localhost:3000", app, undefined), true);
  assert.equal(isStudioHost("shop.example.com", app, undefined), false);
  assert.equal(isStudioHost("mobile-do-apps.vercel.app", app, "mobile-do-apps.vercel.app"), false);
  assert.equal(isStudioHost("evilmobile.do", app, undefined), false);
});
