import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve("dist");
let authenticated = false;
let updated = false;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  res.setHeader("Cache-Control", "no-store");
  if (path.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    if (path === "/api/auth/login") authenticated = true;
    if (path === "/api/auth/logout") authenticated = false;
    const body = path.startsWith("/api/auth/")
      ? { authenticated, csrf_token: "test" }
      : path === "/api/vocabulary"
        ? {
            items: [
              {
                id: "1",
                italian: "PRIVATE CASA",
                greek: "σπίτι",
                word_type: "noun",
              },
            ],
            total: 1,
            page: 1,
            page_size: 6,
          }
        : path === "/api/profiles"
          ? [
              {
                id: "1",
                display_name: "Learner",

                preferred_direction: "greek_to_italian",
                default_session_size: 10,
              },
            ]
          : path === "/api/sessions"
            ? {
                id: "1",
                requested_size: 10,
                cards: [
                  {
                    position: 0,
                    snapshot: { italian: "casa", greek: "σπίτι" },
                  },
                ],
              }
            : path.endsWith("/summary")
              ? {
                  total: 1,
                  counts: { again: 0, hard: 0, easy: 1 },
                  remembered: 100,
                  needs_practice: [],
                }
              : path.includes("/cards/")
                ? {}
                : [];
    res.end(JSON.stringify(body));
    return;
  }
  const file =
    path === "/" || !path.split("/").at(-1).includes(".")
      ? "/index.html"
      : path;
  try {
    let bytes = await readFile(resolve(root, `.${file}`));
    if (file === "/sw.js" && updated)
      bytes = Buffer.from(
        bytes
          .toString()
          .replace(
            /notebook-static-[a-f0-9]+/,
            "notebook-static-browser-update",
          ),
      );
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".png")
            ? "image/png"
            : file.endsWith(".webmanifest")
              ? "application/manifest+json"
              : "text/html",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 320, height: 720 },
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.active,
  );
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator(".language-picker select").selectOption("en");
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  assert.equal(manifest.errors.length, 0);
  assert.equal(JSON.parse(manifest.data).display, "standalone");
  assert.deepEqual(
    (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors,
    [],
  );
  for (const size of [192, 512]) {
    assert.deepEqual(
      await page.evaluate(async (size) => {
        const image = new Image();
        image.src = `/icon-${size}.png`;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, size),
      [size, size],
    );
  }
  const noOverflow = async () =>
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  await noOverflow();
  await page.getByLabel("Shared password").fill("password");
  await page.getByRole("button", { name: "Open my notebook" }).click();
  await page.getByRole("link", { name: "Words", exact: true }).click();
  await page.getByText("PRIVATE CASA").waitFor();
  await page.getByRole("link", { name: "Practice", exact: true }).click();
  await page.getByLabel("Learner profile", { exact: true }).selectOption("1");
  await noOverflow();
  await page.getByRole("button", { name: "Start practice", exact: true }).tap();
  const reveal = page.getByRole("button", { name: "Reveal answer" });
  await reveal.waitFor();
  await reveal.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "casa", exact: true }).waitFor();
  assert.ok(
    await page
      .getByRole("heading", { name: "casa", exact: true })
      .evaluate((el) => el.parentElement === document.activeElement),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(
    await page
      .getByRole("button", { name: "Easy", exact: true })
      .evaluate((el) => el.getBoundingClientRect().height >= 44),
  );
  assert.ok(
    await page
      .getByRole("heading", { name: "casa", exact: true })
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return (
          style.animationName === "none" && style.transitionDuration === "0s"
        );
      }),
  );
  await context.setOffline(true);
  await page.getByRole("button", { name: "Easy", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("alert")
    .filter({ hasText: "Check your connection" })
    .waitFor();
  await page.getByRole("heading", { name: "casa", exact: true }).waitFor();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Retry", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("heading", { name: "Session summary" }).waitFor();
  await noOverflow();
  await page.getByRole("button", { name: "Lock notebook" }).click();
  await page.getByLabel("Shared password").waitFor();
  const cached = await page.evaluate(async () => {
    const cache = await caches.open((await caches.keys())[0]);
    return Promise.all(
      (await cache.keys()).map(async (req) => ({
        url: req.url,
        body: await (await cache.match(req)).text(),
      })),
    );
  });
  assert.ok(cached.length >= 6);
  assert.ok(
    cached.every(
      (entry) =>
        !entry.url.includes("/api/") && !entry.body.includes("PRIVATE CASA"),
    ),
  );
  await context.setOffline(true);
  await page.goto(`${origin}/practice`);
  await page.getByRole("heading", { name: "You’re offline" }).waitFor();
  assert.equal(await page.getByLabel("Shared password").count(), 0);
  assert.equal(await page.getByText("PRIVATE CASA").count(), 0);
  assert.ok(
    await page.evaluate(async () => {
      try {
        await fetch("/api/vocabulary", { cache: "no-store" });
        return false;
      } catch {
        return true;
      }
    }),
  );
  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByLabel("Shared password").waitFor();
  updated = true;
  await page.evaluate(async () =>
    (await navigator.serviceWorker.ready).update(),
  );
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration()).waiting,
  );
  await page.close();
  const next = await context.newPage();
  await next.goto(origin);
  await next.waitForFunction(
    async () =>
      JSON.stringify(await caches.keys()) ===
      '["notebook-static-browser-update"]',
  );
  await context.close();
  console.log(
    "PASS: manifest, static-only cache, offline gate, keyboard/touch practice retry, mobile overflow, logout, and cache update",
  );
} finally {
  await browser.close();
  server.close();
}
