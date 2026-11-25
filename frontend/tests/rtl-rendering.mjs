/** RTL/script acceptance at mobile widths using a registry-supplied language. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { REGISTRY_PAYLOAD } from "../src/language-fixtures.js";

const registry = {
  languages: [
    ...REGISTRY_PAYLOAD.languages,
    {
      id: "ar",
      label: "Arabic",
      script: "Arab",
      text_direction: "rtl",
      enhanced: false,
    },
  ],
  directions: [
    ...REGISTRY_PAYLOAD.directions,
    {
      key: "en_to_ar",
      prompt_language: "en",
      answer_language: "ar",
      legacy: false,
    },
    {
      key: "ar_to_en",
      prompt_language: "ar",
      answer_language: "en",
      legacy: false,
    },
  ],
};
const collection = {
  id: "one",
  name: "Home",
  source_language: "en",
  target_language: "ar",
  visibility: "private",
  can_edit: true,
  card_count: 1,
};
const entry = {
  id: "card-one",
  source_language: "en",
  target_language: "ar",
  source_text: "house",
  target_text: "بيت",
  italian: "house",
  greek: "بيت",
  word_type: "expression",
  visibility: "private",
  can_edit: true,
  archived_at: null,
  tags: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  res.setHeader("Cache-Control", "no-store");
  if (path.startsWith("/api/")) {
    let body = {};
    if (path === "/api/languages") body = registry;
    if (path === "/api/auth/session")
      body = {
        authenticated: true,
        csrf_token: "test",
        account: {
          id: "account",
          role: "learner",
          legacy_access: false,
          interface_language: "en",
          profile_id: "learner",
          display_name: "Learner",
        },
      };
    if (path === "/api/collections") body = [collection];
    if (path === "/api/vocabulary")
      body = { items: [entry], total: 1, page: 1, page_size: 20 };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
    return;
  }
  const file =
    path === "/" || !path.split("/").at(-1).includes(".")
      ? "/index.html"
      : path;
  try {
    const bytes = await readFile(resolve("dist", `.${file}`));
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
});
try {
  for (const width of [320, 390, 760]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: width < 540,
      hasTouch: width < 540,
      serviceWorkers: "block",
    });
    await context.addInitScript(() =>
      localStorage.setItem("notebook-language", "en"),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/vocabulary`);
    const arabic = page.locator('.entry-card p[lang="ar"][dir="rtl"]');
    await arabic.waitFor();
    assert.equal(await arabic.innerText(), "بيت");
    assert.equal(
      await arabic.evaluate((el) => getComputedStyle(el).direction),
      "rtl",
      `${width}px: Arabic text is not rendered right-to-left`,
    );
    assert.equal(
      await arabic.evaluate((el) => getComputedStyle(el).textAlign),
      "start",
      `${width}px: Arabic text alignment does not mirror`,
    );
    const english = page.locator('.entry-card h2[lang="en"][dir="ltr"]');
    assert.equal(await english.innerText(), "house");
    assert.equal(
      await english.evaluate((el) => getComputedStyle(el).direction),
      "ltr",
      `${width}px: English text direction changed in a mixed pair`,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `${width}px: RTL card overflows horizontally`,
    );
    if (process.env.MOBILE_SCREENSHOT_DIR) {
      await mkdir(process.env.MOBILE_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: resolve(
          process.env.MOBILE_SCREENSHOT_DIR,
          `lexi-rtl-${width}.png`,
        ),
      });
    }
    assert.deepEqual(errors, []);
    console.log(`${width}px: RTL/ltr metadata, mirrored alignment and no overflow passed`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
