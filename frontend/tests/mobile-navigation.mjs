import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const card = {
  id: "card",
  italian: "abbinare",
  greek: "συνδυάζω",
  word_type: "verb",
  pronunciation: "αμπ-μπι-νά-ρε",
  greek_pronunciation: "sin-dhi-à-zo",
  unit: { id: "u", code: "00", title: "Benvenuti" },
  tags: [],
};
const report = {
  counts: { valid: 245, duplicate: 0, error: 0, imported: 0 },
  destination_unit: card.unit,
  proposed_tags: [],
  rows: Array.from({ length: 245 }, (_, i) => ({
    row: i + 2,
    italian: `parola ${i}`,
    greek: `λέξη ${i}`,
    status: "valid",
    entry: { ...card, italian: `parola ${i}`, greek: `λέξη ${i}` },
    errors: [],
    tags: [],
  })),
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  res.setHeader("Cache-Control", "no-store");
  if (path.startsWith("/api/")) {
    let body = [];
    if (path === "/api/auth/session")
      body = { authenticated: true, csrf_token: "test" };
    if (path === "/api/units") body = [card.unit];
    if (path === "/api/vocabulary")
      body = { items: [card], total: 1, page: 1, page_size: 12 };
    if (path === "/api/imports/preview") body = report;
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
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const width of [320, 390, 760]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/vocabulary`);
    const nav = page.getByRole("navigation", { name: "Κύρια πλοήγηση" });
    await nav.waitFor();
    assert.deepEqual(await nav.getByRole("link").allTextContents(), [
      "Αρχική",
      "Εξάσκηση",
      "Λέξεις",
      "Πρόοδος",
      "Προφίλ",
    ]);
    assert.equal(await page.locator(".main-navigation").isVisible(), false);
    assert.equal(
      await page.getByRole("link", { name: "Lexi", exact: true }).isVisible(),
      true,
    );
    assert.equal(await page.locator(".mobile-lock").isVisible(), true);
    const geometry = await nav.getByRole("link").evaluateAll((links) =>
      links.map((link) => {
        const rect = link.getBoundingClientRect();
        const label = link.querySelector("span");
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          wraps:
            label.getBoundingClientRect().height >
            parseFloat(getComputedStyle(label).lineHeight) + 1,
        };
      }),
    );
    assert(geometry.every((r) => r.width >= 44 && r.height >= 44 && !r.wraps));
    assert(
      geometry.every(
        (r) =>
          r.y === geometry[0].y && Math.abs(r.width - geometry[0].width) < 1,
      ),
    );
    await nav.getByRole("link").first().focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await nav
        .getByRole("link")
        .nth(1)
        .evaluate(
          (el) =>
            el === document.activeElement &&
            getComputedStyle(el).outlineStyle !== "none",
        ),
      true,
    );
    if (process.env.MOBILE_SCREENSHOT_DIR) {
      await mkdir(process.env.MOBILE_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: resolve(
          process.env.MOBILE_SCREENSHOT_DIR,
          `lexi-mobile-nav-${width}.png`,
        ),
      });
    }
    for (const [label, path] of [
      ["Αρχική", "/"],
      ["Εξάσκηση", "/practice"],
      ["Λέξεις", "/vocabulary"],
      ["Πρόοδος", "/progress"],
      ["Προφίλ", "/settings"],
    ]) {
      const link = nav.getByRole("link", { name: label, exact: true });
      await link.click();
      await page.waitForURL(`${origin}${path}`);
      await page.waitForFunction(
        (path) =>
          document
            .querySelector(`.mobile-navigation a[href="${path}"]`)
            ?.getAttribute("aria-current") === "page",
        path,
      );
      assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
      assert.equal(await link.getAttribute("aria-current"), "page");
    }
    await nav.getByRole("link", { name: "Λέξεις", exact: true }).click();
    await page.getByText("abbinare", { exact: true }).waitFor();
    // A fixed card menu stays inside the usable area, above the bottom bar.
    const trigger = page.getByRole("button", {
      name: "Ενέργειες κάρτας: abbinare",
      exact: true,
    });
    await trigger.evaluate((el) => {
      const bottom = document
        .querySelector(".mobile-navigation")
        .getBoundingClientRect().top;
      // Position the trigger where a menu fits in the viewport but would cover navigation.
      window.scrollBy(0, el.getBoundingClientRect().bottom - (bottom - 90));
    });
    await trigger.click();
    const menu = page.getByRole("menu");
    const menuRect = await menu.boundingBox();
    const navRect = await nav.boundingBox();
    assert(menuRect.y + menuRect.height <= navRect.y);
    await menu
      .getByRole("menuitem", {
        name: "Κάρτα προεπισκόπησης: abbinare",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.evaluate((el) => el.matches(":modal")), true);
    await page.keyboard.press("Tab");
    assert.equal(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0);
    // CSS shares the complete safe-area-aware bar height with sticky import actions.
    await page
      .getByRole("button", { name: "Εισαγωγή CSV", exact: true })
      .click();
    await page.getByLabel("Ενότητα *", { exact: true }).selectOption("u");
    await page.getByLabel("Αρχείο CSV").setInputFiles({
      name: "245.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "italian,greek,word_type\n" +
          report.rows
            .map((r) => `${r.italian},${r.greek},expression`)
            .join("\n"),
      ),
    });
    await page
      .getByRole("button", { name: "Προεπισκόπηση", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Προεπισκόπηση εισαγωγής",
      exact: true,
    });
    await panel.waitFor();
    const bar = panel.locator(".csv-action-bar");
    await panel.locator("h3").scrollIntoViewIfNeeded();
    const assertActionsClear = async () => {
      const actionRect = await bar.boundingBox();
      const bottomRect = await nav.boundingBox();
      assert(actionRect.y + actionRect.height <= bottomRect.y + 1);
      assert.equal(
        await bar
          .getByRole("button", { name: "Εισαγωγή 245 καρτών", exact: true })
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
        true,
      );
    };
    await assertActionsClear();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    // Chromium emulates a device home-indicator inset, exercising actual env() values.
    const cdp = await context.newCDPSession(page);
    const before = (await nav.boundingBox()).height;
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 0, left: 0, bottom: 34, right: 0 },
    });
    await page.waitForFunction(
      () =>
        parseFloat(
          getComputedStyle(document.querySelector(".mobile-navigation"))
            .paddingBottom,
        ) >= 40,
    );
    assert(Math.abs((await nav.boundingBox()).height - before - 34) < 1);
    await assertActionsClear();
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const footer = await page.locator(".install-note").boundingBox();
    assert(footer.y + footer.height <= (await nav.boundingBox()).y);
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: five routes including Home, active links, touch targets, modal focus, menu/sticky clearance and 34px safe area passed`,
    );
    // Moving to desktop removes the mobile bar and restores the original header menu.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator(".main-navigation").waitFor({ state: "visible" });
    assert.equal(await nav.count(), 0);
    assert.equal(await page.locator(".main-navigation a").count(), 5);
    assert.equal(await page.locator(".main-navigation button").count(), 1);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
