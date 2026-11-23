import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { REGISTRY_PAYLOAD } from "../src/language-fixtures.js";

const collection = {
  id: "one",
  name: "Greetings",
  source_language: "el",
  target_language: "it",
  visibility: "private",
  can_edit: true,
  card_count: 1,
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  res.setHeader("Cache-Control", "no-store");
  if (path.startsWith("/api/")) {
    let body = {};
    if (path === "/api/languages") body = REGISTRY_PAYLOAD;
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/collections`);
    const first = page.getByRole("combobox", { name: "Language pair 1" });
    await first.waitFor();

    // The learning-language picker fills the row and keeps a 44px touch target.
    const geometry = await first.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, x: rect.x };
    });
    assert(geometry.height >= 44, `${width}px: picker height ${geometry.height}`);
    assert(geometry.width > 100, `${width}px: picker width ${geometry.width}`);

    // The popup stays inside the viewport and offers curated API options.
    await first.click();
    const list = page.locator(".language-combobox").first().getByRole("listbox");
    await list.waitFor();
    const optionNames = await list.getByRole("option").allTextContents();
    assert(
      optionNames.some((name) => name.includes("Danish")),
      `${width}px: Danish option missing`,
    );
    const listRect = await list.boundingBox();
    assert(
      listRect.x >= 0 && listRect.x + listRect.width <= width + 1,
      `${width}px: popup overflows horizontally`,
    );

    // Keyboard navigation moves the active option and focus ring stays visible.
    await page.keyboard.press("ArrowDown");
    const active = await list.locator('[aria-selected="false"].is-active').allTextContents();
    assert(active.length === 1, `${width}px: expected one active option`);
    await first.focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await first.evaluate((el) => getComputedStyle(el).outlineStyle !== "none"),
      true,
      `${width}px: focus outline missing`,
    );

    await page.keyboard.press("Escape");
    assert.equal(await list.isVisible(), false);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `${width}px: page overflows horizontally`,
    );

    if (process.env.MOBILE_SCREENSHOT_DIR) {
      await mkdir(process.env.MOBILE_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: resolve(
          process.env.MOBILE_SCREENSHOT_DIR,
          `lexi-language-picker-${width}.png`,
        ),
      });
    }
    assert.deepEqual(errors, []);
    console.log(`${width}px: picker size, popup fit, keyboard focus and no overflow passed`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
